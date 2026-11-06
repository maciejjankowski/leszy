"""python3 test_leszy.py - simulator and real-recording checks for leszy.py (no hardware needed)."""
import os, sys, tempfile, types
import numpy as np
import yaml
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import leszy as L

fails = 0
def check(name, ok, info=''):
    global fails
    print(('PASS ' if ok else 'FAIL ') + name + ('  ' + info if info else ''), flush=True)
    fails += 0 if ok else 1

SR = L.P['audio']['sample_rate']
TMP = tempfile.mkdtemp(prefix='leszy_')

def cfg_from(text):
    fn = os.path.join(TMP, 'cfg%d.yaml' % abs(hash(text)))
    open(fn, 'w').write(text)
    return L.load_config(fn), fn

def args(**kw):
    a = dict(calib=None, wav=None, post='', log=None, at=None, clap_height=None, claps=5, pts=None, point_s=None, out=TMP)
    a.update(kw); return types.SimpleNamespace(**a)

def wavs_for(cfg, sig, tag):
    out = []
    for name, x in sig.items():
        fn = os.path.join(TMP, '%s_%s.wav' % (tag, name.replace(' ', '_')))
        L.write_wav(fn, x, SR); out.append('%s=%s' % (name, fn))
    return out

ROOM = '''height: 1.0
room: {xmin: -1, xmax: 4, ymin: -1, ymax: 4}
devices:
  - {name: U44, label: U44, channels: [1, 2, 3, 4], positions: [[0, 0], [3, 0], [3, 3], [0, 3]], sync: true}
  - {name: DJI, label: DJI, channels: [1, 2], positions: [[1.5, -0.5], [1.5, 3.5]], sync: true}
'''

# 1. GCC-PHAT sign and accuracy on a rotor comb
t = np.arange(8192) / SR
x = sum(np.sin(2 * np.pi * k * 150 * t + k) / k for k in range(1, 13))
d = 37
y = np.r_[np.zeros(d), x[:-d]]
tau, conf = L.gcc_phat(x + 0.01 * np.random.default_rng(0).standard_normal(8192), y, SR, 0.005, 100, 2000)
check('gcc_phat: later mic gives positive tau', abs(tau * SR - d) < 1, 'tau %.2f samples, conf %.1f' % (tau * SR, conf))

# 2. comb pitch
f, pw = L.spectrum(x + 0.001 * np.random.default_rng(1).standard_normal(8192), SR)
f0, sc = L.comb_f0(f, pw)
check('comb_f0: finds 150 Hz rotor', abs(f0 - 150) < 4, 'f0 %.0f score %.1f' % (f0, sc))

# 3. live-like run on a simulated flight: 4 U44 mics + DJI pair, no calibration needed (offsets 0)
cfg, cfn = cfg_from(ROOM)
path = [(0, 0.5, 1.5, 0), (3, 0.5, 1.5, 0), (3.01, 0.5, 1.5, 1), (11, 2.5, 2.5, 1), (19, 1.5, 0.5, 1)]
sig = L.simulate(cfg, path, 19, SR)
fixes = L.cmd_run(cfg, args(config=cfn, wav=wavs_for(cfg, sig, 'run'), calib=os.path.join(TMP, 'none.json')))
pt = np.array(path)
errs = [np.hypot(x_ - np.interp(t_, pt[:, 0], pt[:, 1]), y_ - np.interp(t_, pt[:, 0], pt[:, 2])) for t_, x_, y_ in fixes if t_ > 5]
check('run: fixes during the flight', len(errs) > 50, '%d fixes' % len(errs))
check('run: median position error < 0.25 m', len(errs) and np.median(errs) < 0.25, 'median %.2f m, 90%% %.2f m' % (np.median(errs), np.percentile(errs, 90)))
quiet = [f_ for f_ in fixes if f_[0] < 2.5]
check('run: no fix before the drone starts', not quiet, '%d early fixes' % len(quiet))

# 4. clap calibration recovers a DJI radio delay and a U44 wiring delay
off_true = {'DJI:2': 0.0004, 'U44:3': 0.0002}
claps = [(1.0 + 1.5 * k, 1.5, 1.5) for k in range(5)]
sig = L.simulate(cfg, [(0, 1.5, 1.5, 0), (10, 1.5, 1.5, 0)], 10, SR, offsets=off_true, claps=claps)
cal = os.path.join(TMP, 'clap.json')
L.cmd_clap(cfg, args(config=cfn, wav=wavs_for(cfg, sig, 'clap'), calib=cal, at='1.5,1.5', claps=5))
got = yaml.safe_load(open(cal))['offset']
errs_ms = [abs(got.get(k, 0) - v) * 1000 for k, v in off_true.items()] + [abs(got.get('U44:2', 0)) * 1000]
check('clap: channel delays within 0.05 ms', max(errs_ms) < 0.05, 'fitted ms: ' + ', '.join('%s %.3f' % (k, v * 1000) for k, v in got.items()))

# 5. calibration at known points: unknown delays and sensitivities, error before vs after
gains = {'U44:1': 4.0, 'U44:4': -5.0, 'DJI:1': 6.0}
pts = [(1.5, 1.5), (0.5, 0.5), (2.5, 0.5), (2.5, 2.5), (0.5, 2.5)]
seg = 6.0
path = []
for k, (px, py) in enumerate(pts):
    path += [(k * seg, px, py, 1), (k * seg + seg - 0.01, px, py, 1)]
sig = L.simulate(cfg, path, seg * len(pts) + 1, SR, offsets=off_true, gains=gains)
cal = os.path.join(TMP, 'points.json')
quiet = L.simulate(cfg, [(0, 1.5, 1.5, 0), (12, 1.5, 1.5, 0)], 12, SR, offsets=off_true, gains=gains)  # real procedure: noise first
L.cmd_noise(cfg, args(config=cfn, wav=wavs_for(cfg, quiet, 'quiet'), calib=cal))
before, after = L.cmd_points(cfg, args(config=cfn, wav=wavs_for(cfg, sig, 'pts'), calib=cal, pts=['%s,%s' % p for p in pts], point_s=seg))
check('points: every point measured', len(after) == len(pts), '%d of %d' % (len(after), len(pts)))
check('points: error after calibration < 0.15 m', after and np.mean(after) < 0.15, 'before %.2f m, after %.2f m' % (np.mean(before), np.mean(after)))
check('points: calibration does not make it worse', after and np.mean(after) <= np.mean(before) + 0.02)
# held-out flight with the same hidden delays and sensitivities: run without and with the fitted calibration
fl = [(0, 0.5, 1.5, 0), (3, 0.5, 1.5, 0), (3.01, 0.5, 1.5, 1), (11, 2.5, 2.5, 1), (19, 1.5, 0.5, 1)]
sig = L.simulate(cfg, fl, 19, SR, offsets=off_true, gains=gains, seed=7)
w = wavs_for(cfg, sig, 'held')
nocal = os.path.join(TMP, 'nocal.json'); open(nocal, 'w').write(open(cal).read().replace('"offset"', '"offset_unused"').replace('"gain"', '"gain_unused"'))
ptf = np.array(fl)
def flight_err(calfile):
    fx = L.cmd_run(cfg, args(config=cfn, wav=w, calib=calfile))
    e = [np.hypot(x_ - np.interp(t_, ptf[:, 0], ptf[:, 1]), y_ - np.interp(t_, ptf[:, 0], ptf[:, 2])) for t_, x_, y_ in fx if t_ > 5]
    return np.median(e) if e else 9.9
e0 = flight_err(nocal); e1 = flight_err(cal)
check('points: on a new flight the calibration helps', e1 < e0 and e1 < 0.15, 'median error without %.2f m, with %.2f m' % (e0, e1))

# 6. real recording 2026-10-20 (DJI pair 2.5 m apart): the fix must sit on the right mic's side in each hover
rec = '/Users/mj/code/the-template/runtime/p094/recordings/dji-pair-20261020-122920.wav'
if os.path.exists(rec):
    rcfg = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'configs', 'dji-2026-10-20.yaml')
    c2 = L.load_config(rcfg)
    fx = L.cmd_run(c2, args(config=rcfg, wav=['Wireless Mic Rx=' + rec], calib=os.path.join(TMP, 'none2.json')))
    near = lambda a, b: [x_ for t_, x_, y_ in fx if a <= t_ < b]
    nearP, nearL, nearP2, nearL2 = near(11, 17), near(19, 26), near(27, 34), near(43, 51)
    m = lambda v: np.median(v) if v else float('nan')
    check('recording: drone found in all four hovers', all([nearP, nearL, nearP2, nearL2]), 'fixes per hover %d %d %d %d' % tuple(map(len, (nearP, nearL, nearP2, nearL2))))
    check('recording: hovers land on the right side (P at x=2.5, L at x=0)', m(nearP) > 1.5 and m(nearP2) > 1.5 and m(nearL) < 1.0 and m(nearL2) < 1.0,
          'median x: P %.2f, L %.2f, P %.2f, L %.2f' % (m(nearP), m(nearL), m(nearP2), m(nearL2)))
else:
    print('SKIP recording test: %s not found' % rec)

print('ALL PASS' if not fails else '%d FAILED' % fails)
sys.exit(1 if fails else 0)
