#!/usr/bin/env python3
"""Wielki Leszy, native: drone detection and location from raw multichannel mic input (no browser).

  python3 leszy.py devices                       list audio inputs
  python3 leszy.py run      -c config.yaml       live detection + location, POSTs fixes to the web app
  python3 leszy.py noise    -c config.yaml       learn each mic's background (silence)
  python3 leszy.py clap     -c config.yaml --at 1.5,1.0      channel delays from claps at a known point
  python3 leszy.py points   -c config.yaml       drone hovers at known points -> fit delays + sensitivities, report error
  python3 leszy.py sim      -c config.yaml --out DIR         synthetic recording (one WAV per device) for tests
  any command: --wav DEV=FILE.wav [--wav DEV2=FILE2.wav]     replay files instead of live devices

Devices with sync: true (one clock: Zoom U44, one DJI receiver) give time differences between their own mics.
Mics on different devices only share loudness. Every number lives in ssot/params.yaml, every printed line in ssot/ui.yaml.
"""
import argparse, json, os, sys, threading, time, urllib.request, wave
from collections import deque
import numpy as np
import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
P = yaml.safe_load(open(os.path.join(HERE, 'ssot', 'params.yaml')))
UI = yaml.safe_load(open(os.path.join(HERE, 'ssot', 'ui.yaml')))


def say(key, **kw):
    print(UI[key].format(**kw), flush=True)


# ---------------------------------------------------------------- config
class Mic:
    def __init__(self, dev, ch, pos, mid):
        self.dev, self.ch, self.pos, self.id = dev, ch, np.array(pos, float), mid


def load_config(path):
    cfg = yaml.safe_load(open(path))
    mics = []
    for d in cfg['devices']:
        d.setdefault('sync', True)
        d['mics'] = [Mic(d['name'], ch, pos, '%s:%d' % (d.get('label', d['name']), ch)) for ch, pos in zip(d['channels'], d['positions'])]
        mics += d['mics']
    cfg['all_mics'] = mics
    cfg.setdefault('height', 1.0)
    return cfg


def calib_path(cfg, args):
    return args.calib or os.path.join(os.path.dirname(os.path.abspath(args.config)), 'calib.json')


def load_calib(path):
    c = json.load(open(path)) if os.path.exists(path) else {}
    for k in ('floor', 'offset', 'gain'):
        c.setdefault(k, {})
    return c


def save_calib(path, c):
    json.dump(c, open(path, 'w'), indent=1)


# ---------------------------------------------------------------- DSP
def spectrum(x, sr):
    n = len(x)
    w = np.hanning(n)
    X = np.fft.rfft(x * w)
    return np.fft.rfftfreq(n, 1 / sr), (np.abs(X) ** 2) / (np.sum(w ** 2) * sr)


def band_db(freqs, pw, lo, hi):
    m = (freqs >= lo) & (freqs < hi)
    return 10 * np.log10(np.sum(pw[m]) + 1e-20)


def comb_f0(freqs, pw):
    """Rotor comb: whiten by the median of neighbouring bins, score each f0 by teeth minus gaps (VolAnti tier 1).
    The spectral baseline keeps a drone visible that was already flying when listening started (field 2026-10-20)."""
    db = 10 * np.log10(pw + 1e-20)
    df = freqs[1] - freqs[0]
    top = int(4000 / df) + 12
    W = 8
    pad = np.pad(db[:top], W, mode='edge')
    win = np.lib.stride_tricks.sliding_window_view(pad, 2 * W + 1)
    r = np.clip(db[:top] - np.median(win, axis=1), 0, 25)
    lo, hi = P['detect']['f0_range_hz']
    f0s = np.arange(lo, hi, 1.0)
    kk = np.arange(1, 21)
    K = np.minimum(20, (3900 // f0s)).astype(int)
    valid = kk[None, :] <= K[:, None]                                  # (f0, k) teeth that exist below 3.9 kHz
    teeth = np.clip(np.round(kk[None, :] * f0s[:, None] / df).astype(int), 1, top - 2)
    gaps = np.clip(np.round((kk[None, :] + 0.5) * f0s[:, None] / df).astype(int), 0, top - 1)
    t = np.maximum(r[teeth - 1], np.maximum(r[teeth], r[teeth + 1])) * valid
    g = r[gaps] * valid
    lit = np.sum((t > 10) & valid, axis=1)
    score = (np.sum(t, axis=1) - np.sum(g, axis=1)) / np.sqrt(np.maximum(K, 1))
    score[(K < 3) | (lit < np.maximum(3, K // 4))] = -1e9
    i = int(np.argmax(score))
    if score[i] <= -1e8:
        return 0.0, 0.0
    best_f, best_s = float(f0s[i]), float(score[i])
    up = int(np.searchsorted(f0s, 2 * best_f))  # octave check: half the true f0 hits every other tooth
    if up < len(f0s) and score[up] > 0.7 * best_s:
        best_f, best_s = float(f0s[up]), float(score[up])
    return best_f, best_s


def gcc_phat(x, y, sr, max_lag_s, lo, hi, gate=3.0, curve=False):
    """Time difference tau = t_y - t_x (s) and confidence (peak over window mean). Positive = y heard it later."""
    n = len(x)
    w = np.hanning(n)
    X, Y = np.fft.rfft(x * w, 2 * n), np.fft.rfft(y * w, 2 * n)
    f = np.fft.rfftfreq(2 * n, 1 / sr)
    R = np.conj(X) * Y
    mag = np.abs(R)
    band = (f >= lo) & (f < hi)
    keep = band & (mag > gate * np.median(mag[band]))  # plain PHAT lets hundreds of empty bins outvote a dozen rotor lines
    G = np.zeros_like(R)
    G[keep] = R[keep] / (mag[keep] + 1e-30)
    cc = np.fft.irfft(G, 2 * n)
    L = int(max_lag_s * sr) + 2
    idx = np.r_[np.arange(2 * n - L, 2 * n), np.arange(0, L + 1)]
    lags = np.r_[np.arange(-L, 0), np.arange(0, L + 1)]
    v = cc[idx]
    i = int(np.argmax(v))
    peak, mean = v[i], np.mean(np.abs(v)) + 1e-30
    frac = 0.0
    if 0 < i < len(v) - 1:
        den = v[i - 1] - 2 * v[i] + v[i + 1]
        if den != 0:
            frac = 0.5 * (v[i - 1] - v[i + 1]) / den
    if curve:  # the whole correlation over the allowed lags, peak = 1: the locator reads it at every grid point (SRP-PHAT)
        return (lags[i] + frac) / sr, peak / mean, (lags / sr, v / (peak + 1e-30))
    return (lags[i] + frac) / sr, peak / mean


# ---------------------------------------------------------------- sources
class LiveSource:
    """One sounddevice stream per configured device, each filling its own ring buffer."""
    def __init__(self, cfg):
        import sounddevice as sd
        self.sd, self.sr = sd, P['audio']['sample_rate']
        self.n = int(P['audio']['ring_s'] * self.sr)
        self.rings, self.pos, self.streams, self.lock = {}, {}, [], threading.Lock()
        devs = [d for d in sd.query_devices() if d['max_input_channels'] > 0]
        for d in cfg['devices']:
            match = [i for i, dd in enumerate(sd.query_devices()) if dd['max_input_channels'] > 0 and d['name'].lower() in dd['name'].lower()]
            if len(match) <= d.get('index', 0):  # index: 0, 1 ... picks among identical names (two DJI receivers)
                say('device_missing', name=d['name'], have=', '.join(x['name'] for x in devs)); sys.exit(2)
            match = [match[d.get('index', 0)]]
            info = sd.query_devices(match[0])
            nch = max(d['channels'])
            if nch > info['max_input_channels']:
                say('channel_missing', name=info['name'], ch=info['max_input_channels'], want=nch); sys.exit(2)
            self.rings[d['name']] = np.zeros((nch, self.n), np.float32)
            self.pos[d['name']] = 0
            st = sd.InputStream(device=match[0], channels=nch, samplerate=self.sr, blocksize=1024, dtype='float32', callback=self._cb(d['name']))
            self.streams.append(st)
        self.cfg = cfg
        for st in self.streams:
            st.start()
        say('listening', devs=', '.join(d['name'] for d in cfg['devices']))

    def _cb(self, name):
        def cb(indata, frames, t, status):
            with self.lock:
                ring, p = self.rings[name], self.pos[name] % self.n
                k = min(frames, self.n - p)
                ring[:, p:p + k] = indata[:k].T
                if k < frames:
                    ring[:, :frames - k] = indata[k:].T
                self.pos[name] += frames
        return cb

    def frame(self, name, length):
        with self.lock:
            ring, p = self.rings[name], self.pos[name]
            if p < length:
                return None
            idx = (np.arange(p - length, p)) % self.n
            return ring[:, idx].copy()

    def step(self):
        time.sleep(P['audio']['hop_s'])
        return time.time()


class WavSource:
    """Replay: each device reads its own WAV (channel k of the file = channel k of the device), one hop per step, no waiting."""
    def __init__(self, cfg, wavs):
        self.data, self.sr = {}, None
        for d in cfg['devices']:
            key = d.get('label', d['name'])
            fn = wavs.get(key) or wavs.get(d['name'])
            x, sr = read_wav(fn)
            self.sr = sr
            self.data[d['name']] = x
        self.t = 0.0
        self.end = min(x.shape[1] for x in self.data.values()) / self.sr

    def frame(self, name, length):
        i = int(self.t * self.sr)
        x = self.data[name]
        if i < length:
            return None
        return x[:, i - length:i]

    def step(self):
        self.t += P['audio']['hop_s']
        if self.t > self.end:
            say('wav_end'); raise StopIteration
        return self.t


def read_wav(fn):
    """PCM WAV, 16/24/32-bit, plain or WAVE_FORMAT_EXTENSIBLE (what ffmpeg writes for 24-bit)."""
    import struct
    buf = open(fn, 'rb').read()
    p, fmt, data = 12, None, None
    while p + 8 <= len(buf):
        cid, sz = buf[p:p + 4], struct.unpack('<I', buf[p + 4:p + 8])[0]
        if cid == b'fmt ':
            tag, ch, sr = struct.unpack('<HHI', buf[p + 8:p + 16])
            bits = struct.unpack('<H', buf[p + 22:p + 24])[0]
            fmt = (ch, sr, bits)
        elif cid == b'data':
            data = buf[p + 8:p + 8 + sz]
        p += 8 + sz + (sz & 1)
    ch, sr, bits = fmt
    sw = bits // 8
    n = len(data) // (sw * ch)
    raw = data[:n * sw * ch]
    if sw == 3:
        b = np.frombuffer(raw, np.uint8).reshape(-1, 3).astype(np.int32)
        v = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
        v = np.where(v >= 1 << 23, v - (1 << 24), v) / float(1 << 23)
    elif sw == 2:
        v = np.frombuffer(raw, '<i2') / 32768.0
    else:
        v = np.frombuffer(raw, '<i4') / float(1 << 31)
    return v.reshape(-1, ch).T.astype(np.float32), sr


def write_wav(fn, x, sr):
    x = np.clip(x, -1, 1)
    with wave.open(fn, 'wb') as w:
        w.setnchannels(x.shape[0]); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((x.T * 32767).astype(np.int16).tobytes())


# ---------------------------------------------------------------- one analysis step
class Analyser:
    def __init__(self, cfg, calib, sr):
        self.cfg, self.calib, self.sr = cfg, calib, sr
        self.mics = cfg['all_mics']
        self.hist = {m.id: deque(maxlen=int(P['floor']['window_s'] / P['audio']['hop_s'])) for m in self.mics}
        self.hits, self.on, self.last_hit = 0, False, -1e9

    def floor(self, m):
        if m.id in self.calib['floor']:
            return self.calib['floor'][m.id]
        h = self.hist[m.id]
        return np.percentile(h, P['floor']['percentile']) if len(h) >= 10 else (max(h) if h else 0.0)

    def measure(self, src):
        """Per mic: band level, SNR, pitch. Per sync device: the raw audio frame, for time differences."""
        lo, hi = P['band_hz']
        out, frames = {}, {}
        for d in self.cfg['devices']:
            x = src.frame(d['name'], P['audio']['frame'])
            if x is None:
                return None, None
            frames[d['name']] = x
            for m in d['mics']:
                f, pw = spectrum(x[m.ch - 1], self.sr)
                lvl = band_db(f, pw, lo, hi)
                f0, sc = comb_f0(f, pw)
                out[m.id] = {'level': lvl, 'f0': f0, 'score': sc}
        return out, frames

    def detect(self, t, meas):
        d = P['detect']
        for m in self.mics:
            meas[m.id]['snr'] = meas[m.id]['level'] - self.floor(m)
        hearing = [m.id for m in self.mics if meas[m.id]['snr'] > d['on_db']]
        f0s = sorted(meas[i]['f0'] for i in hearing if meas[i]['f0'] > 0)
        agree, f0, best = False, 0.0, 1
        for a in f0s:  # largest group of pitches within f0_agree of each other: noise never makes two mics agree
            grp = [b for b in f0s if abs(b - a) / max(a, b) < d['f0_agree']]
            if len(grp) > best:
                agree, f0, best = True, float(np.median(grp)), len(grp)
        strong = any(meas[i]['snr'] > d['strong_db'] for i in hearing)
        hit = len(hearing) >= d['min_mics'] and (agree or strong)
        self.hits = self.hits + 1 if hit else 0
        if self.hits >= d['need_frames']:
            self.on, self.last_hit = True, t
        elif hit and self.on:
            self.last_hit = t
        if self.on and t - self.last_hit > d['hold_s']:
            self.on = False
        if not self.on:  # the floor learns only while nothing flies
            for m in self.mics:
                self.hist[m.id].append(meas[m.id]['level'])
        return {'on': self.on, 'hearing': hearing, 'f0': f0, 'agree': agree}

    def pairs(self, frames):
        """Raw time differences within each sync device (no calibration applied): list of (mic_i, mic_j, tau, conf)."""
        lo, hi = P['band_hz']
        res = []
        for d in self.cfg['devices']:
            if not d['sync'] or len(d['mics']) < 2:
                continue
            x = frames[d['name']]
            for a in range(len(d['mics'])):
                for b in range(a + 1, len(d['mics'])):
                    mi, mj = d['mics'][a], d['mics'][b]
                    span = np.linalg.norm(mi.pos - mj.pos) / P['sound_speed']
                    tau, conf, cur = gcc_phat(x[mi.ch - 1], x[mj.ch - 1], self.sr, span * 1.2 + 0.0005, lo, hi, curve=True)
                    res.append((mi.id, mj.id, tau, conf, cur))
        return res


class Locator:
    """Grid search over the room: time differences (sync pairs) and loudness (all mics), each weighted by its noise."""
    def __init__(self, cfg):
        r, s = cfg['room'], P['locate']['step_m']
        xs, ys = np.arange(r['xmin'], r['xmax'] + s / 2, s), np.arange(r['ymin'], r['ymax'] + s / 2, s)
        self.X, self.Y = np.meshgrid(xs, ys)
        h = cfg['height']
        self.d = {m.id: np.sqrt((self.X - m.pos[0]) ** 2 + (self.Y - m.pos[1]) ** 2 + h ** 2) for m in cfg['all_mics']}
        self.c = P['sound_speed']

    def solve(self, pairs, levels, offset, gain):
        L = P['locate']
        cost = np.zeros_like(self.X)
        used_p = used_l = 0
        for pr in pairs:
            i, j, tau, conf = pr[:4]
            if conf < L['min_conf']:
                continue
            o = offset.get(j, 0.0) - offset.get(i, 0.0)
            pred = (self.d[j] - self.d[i]) / self.c
            if len(pr) > 4:  # steered response: read the whole correlation at each grid point, so a rotor's periodic
                lags, v = pr[4]  # side peaks cannot pull the fix as a single wrong lag would
                cost += L['srp_weight'] * (1 - np.interp(pred + o, lags, v, left=0, right=0))
            else:
                cost += ((tau - o - pred) / L['sigma_tdoa_s']) ** 2
            used_p += 1
        if len(levels) >= L['level_min_mics']:
            ids = list(levels)
            Lm = np.array([levels[k] - gain.get(k, 0.0) for k in ids])
            att = np.stack([20 * np.log10(self.d[k]) for k in ids])  # level = S - 20 log10(d)
            S = np.mean(Lm[:, None, None] + att, axis=0)
            cost += np.sum(((Lm[:, None, None] - (S - att)) / L['sigma_level_db']) ** 2, axis=0)
            used_l = len(ids)
        if not used_p and not used_l:
            return None
        k = np.unravel_index(np.argmin(cost), cost.shape)
        cmin = cost[k]
        area = np.sum(cost < cmin + 2.3) * P['locate']['step_m'] ** 2  # 1 sigma region of a 2-D fit
        return {'x': float(self.X[k]), 'y': float(self.Y[k]), 'err': float(np.sqrt(area / np.pi)), 'pairs': used_p, 'level_mics': used_l, 'cost': float(cmin)}


class Tracker:
    def __init__(self):
        self.s = None

    def update(self, t, x, y):
        a, b = P['track']['alpha'], P['track']['beta']
        if self.s is None or t - self.s['t'] > 3:
            self.s = {'t': t, 'x': x, 'y': y, 'vx': 0.0, 'vy': 0.0}
            return self.s
        dt = max(t - self.s['t'], 1e-3)
        px, py = self.s['x'] + self.s['vx'] * dt, self.s['y'] + self.s['vy'] * dt
        rx, ry = x - px, y - py
        self.s = {'t': t, 'x': px + a * rx, 'y': py + a * ry, 'vx': self.s['vx'] + b * rx / dt, 'vy': self.s['vy'] + b * ry / dt}
        return self.s


# ---------------------------------------------------------------- output
class Poster:
    def __init__(self, url):
        self.url, self.busy, self.warned = url, False, False

    def send(self, obj):
        if not self.url or self.busy:
            return
        self.busy = True

        def go():
            try:
                req = urllib.request.Request(self.url, data=json.dumps(obj).encode(), headers={'Content-Type': 'application/json'})
                urllib.request.urlopen(req, timeout=P['output']['post_timeout_s']).read()
            except Exception as e:
                if not self.warned:
                    say('post_fail', url=self.url, err=e); self.warned = True
            finally:
                self.busy = False
        threading.Thread(target=go, daemon=True).start()


def fmt_floors(an):
    return ', '.join('%s %.0f' % (m.id, an.floor(m)) for m in an.mics)


def clock(src, t):
    return time.strftime('%H:%M:%S') if isinstance(src, LiveSource) else '%6.1fs' % t


# ---------------------------------------------------------------- commands
def open_source(cfg, args):
    if args.wav:
        return WavSource(cfg, dict(w.split('=', 1) for w in args.wav))
    return LiveSource(cfg)


def cmd_run(cfg, args):
    cpath = calib_path(cfg, args)
    calib = load_calib(cpath)
    if os.path.exists(cpath):
        say('calib_loaded', file=cpath, floors=calib['floor'], offs={k: round(v * 1000, 2) for k, v in calib['offset'].items()}, gains={k: round(v, 1) for k, v in calib['gain'].items()})
    else:
        say('calib_none')
    src = open_source(cfg, args)
    an, loc, tr = Analyser(cfg, calib, src.sr), Locator(cfg), Tracker()
    post = Poster(args.post if args.post is not None else cfg.get('post_url'))
    logf = open(args.log, 'a') if args.log else None
    last_print = last_post = -1e9
    fixes = []
    try:
        while True:
            t = src.step()
            meas, frames = an.measure(src)
            if meas is None:
                continue
            det = an.detect(t, meas)
            fix = None
            if det['on']:
                levels = {i: meas[i]['level'] for i in det['hearing']}
                fx = loc.solve(an.pairs(frames), levels, calib['offset'], calib['gain'])
                if fx:
                    s = tr.update(t, fx['x'], fx['y'])
                    fix = dict(fx, x=s['x'], y=s['y'], vx=s['vx'], vy=s['vy'], speed=float(np.hypot(s['vx'], s['vy'])))
                    fixes.append((t, fix['x'], fix['y']))
            rec = {'t': t, 'on': det['on'], 'f0': det['f0'], 'hearing': det['hearing'],
                   'mics': {i: {'snr': round(meas[i]['snr'], 1), 'f0': meas[i]['f0']} for i in meas},
                   'fix': fix, 'mic_pos': {m.id: list(m.pos) for m in an.mics}}
            if logf:
                logf.write(json.dumps(rec) + '\n')
            if (det['on'] and fix) or t - last_post > P['output']['heartbeat_s']:
                post.send(rec); last_post = t
            if t - last_print >= P['output']['print_every_s']:
                last_print = t
                ts, f0 = clock(src, t), ('%.0f Hz' % det['f0'] if det['f0'] else '-')
                if det['on'] and fix:
                    say('status_fix', t=ts, f0=f0, x='%.2f' % fix['x'], y='%.2f' % fix['y'], err='%.2f' % fix['err'], v='%.1f' % fix['speed'], n=len(det['hearing']), all=len(an.mics))
                elif det['on']:
                    say('status_nofix', t=ts, f0=f0, why=UI['why_pairs'])
                elif det['hearing']:
                    loud = max(det['hearing'], key=lambda i: meas[i]['snr'])
                    say('status_hear', t=ts, n=len(det['hearing']), f0=f0, loud=loud, snr='%.0f' % meas[loud]['snr'])
                else:
                    say('status_quiet', t=ts, floors=fmt_floors(an))
    except (KeyboardInterrupt, StopIteration):
        pass
    return fixes


def cmd_noise(cfg, args):
    cpath = calib_path(cfg, args)
    calib = load_calib(cpath)
    src = open_source(cfg, args)
    say('noise_start', s=P['calibrate']['noise_s'])
    lv = {m.id: [] for m in cfg['all_mics']}
    an = Analyser(cfg, {'floor': {}, 'offset': {}, 'gain': {}}, src.sr)
    t0 = None
    try:
        while True:
            t = src.step()
            t0 = t if t0 is None else t0
            meas, _ = an.measure(src)
            if meas:
                for k in meas:
                    lv[k].append(meas[k]['level'])
            if t - t0 >= P['calibrate']['noise_s']:
                break
    except StopIteration:
        pass
    calib['floor'] = {k: round(float(np.median(v)), 1) for k, v in lv.items() if v}
    save_calib(cpath, calib)
    say('noise_done', floors=calib['floor'])


def fit_offsets(cfg, rows):
    """rows: (mic_i, mic_j, measured tau, predicted tau). Per sync device, delay o_k with the first mic as zero:
    measured = predicted + o_j - o_i. Least squares."""
    off = {}
    for d in cfg['devices']:
        ids = [m.id for m in d['mics']]
        rr = [r for r in rows if r[0] in ids and r[1] in ids]
        if not rr or len(ids) < 2:
            continue
        A = np.zeros((len(rr), len(ids) - 1))
        bvec = np.zeros(len(rr))
        for k, (i, j, meas, pred) in enumerate(rr):
            if ids.index(j) > 0: A[k, ids.index(j) - 1] += 1
            if ids.index(i) > 0: A[k, ids.index(i) - 1] -= 1
            bvec[k] = meas - pred
        sol = np.linalg.lstsq(A, bvec, rcond=None)[0]
        off[ids[0]] = 0.0
        for n, mid in enumerate(ids[1:]):
            off[mid] = float(sol[n])
    return off


def cmd_clap(cfg, args):
    cpath = calib_path(cfg, args)
    calib = load_calib(cpath)
    at = np.array([float(v) for v in args.at.split(',')])
    h, c = cfg['height'] if args.clap_height is None else args.clap_height, P['sound_speed']
    src = open_source(cfg, args)
    say('clap_start', x=at[0], y=at[1], n=args.claps)
    lo, hi = P['clap_band_hz']
    win = int(P['calibrate']['clap_window_s'] * src.sr)
    an = Analyser(cfg, calib, src.sr)
    rows, got, last = [], {d['name']: 0 for d in cfg['devices']}, {d['name']: -1e9 for d in cfg['devices']}
    try:
        while min(got.values()) < args.claps:
            t = src.step()
            for d in cfg['devices']:
                hop = int(P['audio']['hop_s'] * src.sr)
                x = src.frame(d['name'], hop + 3 * win)  # each hop's slice is searched once, with room on both sides
                if x is None:
                    continue
                ref = d['mics'][0]
                env = np.abs(np.diff(x[ref.ch - 1]))
                k = int(np.argmax(env[win:win + hop])) + win
                ratio = 20 * np.log10(env[k] / (np.median(env) + 1e-12))
                if ratio > P['calibrate']['clap_jump_db'] and t - last[d['name']] > 0.8:
                    last[d['name']] = t
                    got[d['name']] += 1
                    seg = x[:, k - win:k + 2 * win]
                    msg = []
                    for a in range(len(d['mics'])):
                        for b in range(a + 1, len(d['mics'])):
                            mi, mj = d['mics'][a], d['mics'][b]
                            tau, conf = gcc_phat(seg[mi.ch - 1], seg[mj.ch - 1], src.sr, np.linalg.norm(mi.pos - mj.pos) / c * 1.2 + 0.05, lo, hi, gate=0)
                            di, dj = np.sqrt(np.sum((mi.pos - at) ** 2) + h * h), np.sqrt(np.sum((mj.pos - at) ** 2) + h * h)
                            rows.append((mi.id, mj.id, tau, (dj - di) / c))
                            msg.append('%s-%s %.2f ms' % (mi.id, mj.id, (tau - (dj - di) / c) * 1000))
                    say('clap_heard', k='%s %d' % (d.get('label', d['name']), got[d['name']]), pairs=', '.join(msg))
    except (StopIteration, KeyboardInterrupt):
        pass
    if not rows:
        say('clap_none'); return
    calib['offset'].update(fit_offsets(cfg, rows))
    save_calib(cpath, calib)
    say('clap_done', offs={k: round(v * 1000, 3) for k, v in calib['offset'].items()})


def collect_point(cfg, src, an, secs):
    """Frames with a drone heard: raw pair taus and mic levels, medians over the window."""
    t0, taus, lvls, n = None, {}, {}, 0
    while True:
        t = src.step()
        t0 = t if t0 is None else t0
        meas, frames = an.measure(src)
        if meas is not None:
            det = an.detect(t, meas)
            if det['on'] or len(det['hearing']) >= 2:
                n += 1
                for i, j, tau, conf, _ in an.pairs(frames):
                    if conf >= P['locate']['min_conf']:
                        taus.setdefault((i, j), []).append(tau)
                for i in det['hearing']:
                    lvls.setdefault(i, []).append(meas[i]['level'])
        if t - t0 >= secs:
            break
    return n, {k: float(np.median(v)) for k, v in taus.items()}, {k: float(np.median(v)) for k, v in lvls.items()}


def cmd_points(cfg, args):
    cpath = calib_path(cfg, args)
    calib = load_calib(cpath)
    pts = [[float(v) for v in p.split(',')] for p in (args.pts or cfg.get('calib_points', []))]
    secs = args.point_s or P['calibrate']['point_s']
    src = open_source(cfg, args)
    an, loc = Analyser(cfg, calib, src.sr), Locator(cfg)
    h, c = cfg['height'], P['sound_speed']
    say('points_intro', n=len(pts), s=secs)
    got = []
    try:
        for k, p in enumerate(pts):
            if not args.wav:
                input(UI['point_prompt'].format(k=k + 1, n=len(pts), x=p[0], y=p[1]))
            n, taus, lvls = collect_point(cfg, src, an, secs)
            say('point_heard', frames=n, pairs=len(taus), mics=len(lvls))
            if n == 0:
                say('point_empty'); continue
            got.append((np.array(p), taus, lvls))
    except StopIteration:
        pass
    mic = {m.id: m for m in cfg['all_mics']}
    dist = lambda mid, p: float(np.sqrt(np.sum((mic[mid].pos - p) ** 2) + h * h))
    rows = [(i, j, tau, (dist(j, p) - dist(i, p)) / c) for p, taus, _ in got for (i, j), tau in taus.items()]
    if rows:
        calib['offset'].update(fit_offsets(cfg, rows))
    # sensitivities: level_k = S_p - 20 log10 d + g_k; per point remove the mean, then g_k = mean residual (sum of g = 0)
    res = {}
    for p, _, lv in got:
        if len(lv) < 2:
            continue
        r = {k: v + 20 * np.log10(dist(k, p)) for k, v in lv.items()}
        m = np.mean(list(r.values()))
        for k, v in r.items():
            res.setdefault(k, []).append(v - m)
    if res:
        calib['gain'] = {k: round(float(np.mean(v)), 2) for k, v in res.items()}
    before, after = [], []
    empty = {'floor': {}, 'offset': {}, 'gain': {}}
    for p, taus, lv in got:
        pr = [(i, j, tau, 99.0) for (i, j), tau in taus.items()]
        b = loc.solve(pr, lv, empty['offset'], empty['gain'])
        a = loc.solve(pr, lv, calib['offset'], calib['gain'])
        if not a or not b:
            continue
        be, ae = float(np.hypot(b['x'] - p[0], b['y'] - p[1])), float(np.hypot(a['x'] - p[0], a['y'] - p[1]))
        before.append(be); after.append(ae)
        say('points_result', x=p[0], y=p[1], bx='%.2f' % b['x'], by='%.2f' % b['y'], be='%.2f' % be, ax='%.2f' % a['x'], ay='%.2f' % a['y'], ae='%.2f' % ae)
    save_calib(cpath, calib)
    say('points_done', file=cpath, before='%.2f' % (np.mean(before) if before else float('nan')), after='%.2f' % (np.mean(after) if after else float('nan')))
    return before, after


# ---------------------------------------------------------------- simulator
def simulate(cfg, path, secs, sr, offsets=None, gains=None, noise=0.002, seed=1, f0=150.0, claps=()):
    """Rotor comb (12 harmonics, slowly wandering f0) flying along `path` [(t, x, y)], heard by every configured mic with
    true delay d/c + channel offset and level 1/d + gain. Returns {device name: array (channels x samples)}."""
    rng = np.random.default_rng(seed)
    n = int(secs * sr)
    t = np.arange(n) / sr
    pt = np.array(path, float)
    px, py = np.interp(t, pt[:, 0], pt[:, 1]), np.interp(t, pt[:, 0], pt[:, 2])
    rot = [f0 * (1 + dv) * (1 + 0.04 * np.sin(2 * np.pi * (0.3 + 0.05 * k) * t)) for k, dv in enumerate([-0.03, -0.01, 0.012, 0.028])]
    phases = [2 * np.pi * np.cumsum(fi) / sr for fi in rot]   # four rotors, each its own speed: not a perfect comb
    amps = 1 / np.arange(1, 13)
    ph0 = rng.uniform(0, 2 * np.pi, (4, 12))
    turb = rng.standard_normal(n)                            # broadband prop wash, low-passed
    for _ in range(2):
        turb = np.convolve(turb, np.ones(6) / 6, mode='same')
    h, c = cfg['height'], P['sound_speed']
    on = np.interp(t, pt[:, 0], pt[:, 3]) if pt.shape[1] > 3 else np.ones(n)
    bursts = [rng.standard_normal(int(0.003 * sr)) for _ in claps]
    out = {}
    for dv in cfg['devices']:
        x = np.zeros((max(dv['channels']), n), np.float32)
        for m in dv['mics']:
            d = np.sqrt((px - m.pos[0]) ** 2 + (py - m.pos[1]) ** 2 + h * h)
            delay = d / c + (offsets or {}).get(m.id, 0.0)
            sig = np.zeros(n)
            for r, phase in enumerate(phases):
                ph = np.interp(t - delay, t, phase)
                sig += sum(a * np.sin(k * ph + p0) for k, a, p0 in zip(range(1, 13), amps, ph0[r])) * 0.25
            sig += 0.6 * np.interp(t - delay, t, turb)
            sig *= 0.05 / d * on
            g = 10 ** ((gains or {}).get(m.id, 0.0) / 20)
            y = sig * g + noise * rng.standard_normal(n)
            for (tc, cx, cy), b0 in zip(claps, bursts):  # a clap: one 3 ms noise burst, heard by every mic
                dc = np.sqrt((cx - m.pos[0]) ** 2 + (cy - m.pos[1]) ** 2 + h * h)
                i0 = int((tc + dc / c + (offsets or {}).get(m.id, 0.0)) * sr)
                burst = b0 * 0.5 / dc * g
                y[i0:i0 + len(burst)] += burst
            x[m.ch - 1] = y
        out[dv['name']] = x
    return out


def cmd_sim(cfg, args):
    os.makedirs(args.out, exist_ok=True)
    r = cfg['room']
    cx, cy = (r['xmin'] + r['xmax']) / 2, (r['ymin'] + r['ymax']) / 2
    path = [(0, cx - 1.5, cy, 0), (3, cx - 1.5, cy, 0), (3.01, cx - 1.5, cy, 1), (13, cx + 1.5, cy + 1, 1), (23, cx, cy - 1.5, 1)]
    sig = simulate(cfg, path, 23, P['audio']['sample_rate'])
    files = []
    for name, x in sig.items():
        fn = os.path.join(args.out, '%s.wav' % name.replace(' ', '_'))
        write_wav(fn, x, P['audio']['sample_rate'])
        files.append('%s=%s' % (name, fn))
    say('sim_done', files=' '.join('--wav "%s"' % f for f in files))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('cmd', choices=['devices', 'run', 'noise', 'clap', 'points', 'sim'])
    ap.add_argument('-c', '--config', default=os.path.join(HERE, 'config.yaml'))
    ap.add_argument('--calib')
    ap.add_argument('--wav', action='append', help='DEVICE=file.wav (replay instead of live)')
    ap.add_argument('--post', help='URL for fixes (default: post_url in the config; empty string = off)')
    ap.add_argument('--log', help='JSONL log of every analysis step')
    ap.add_argument('--at', help='clap: x,y of the clap')
    ap.add_argument('--clap-height', type=float, dest='clap_height')
    ap.add_argument('--claps', type=int, default=5)
    ap.add_argument('--pts', nargs='*', help='points: x,y x,y ... (default: calib_points in the config)')
    ap.add_argument('--point-s', type=float, dest='point_s')
    ap.add_argument('--out', default='sim_out')
    args = ap.parse_args()
    if args.cmd == 'devices':
        import sounddevice as sd
        say('devices_title')
        for i, d in enumerate(sd.query_devices()):
            if d['max_input_channels'] > 0:
                say('device_line', i=i, name=d['name'], ch=d['max_input_channels'], sr=int(d['default_samplerate']))
        return
    cfg = load_config(args.config)
    {'run': cmd_run, 'noise': cmd_noise, 'clap': cmd_clap, 'points': cmd_points, 'sim': cmd_sim}[args.cmd](cfg, args)


if __name__ == '__main__':
    main()
