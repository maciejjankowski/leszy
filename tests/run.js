// node tests/run.js  - detector on synthetic audio, fusion on a simulated flight
const { CombDetector } = require('../detector.js');
const F = require('../fusion.js');
let fails = 0;
const check = (name, ok, info) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails++; };

// seeded RNG so results are repeatable
let seed = +(process.env.SEED || 42); const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };

// ---------- DSP: Hann + radix-2 FFT -> dB like AnalyserNode.getFloatFrequencyData
const SR = 48000, N = 8192, HOP = 2048;
function fftDb(x) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  for (let i = 1, j = 0; i < N; i++) { let b = N >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= N; len <<= 1) {
    const a = -2 * Math.PI / len;
    for (let i = 0; i < N; i += len) for (let k = 0; k < len / 2; k++) {
      const c = Math.cos(a * k), s = Math.sin(a * k), p = i + k, q = p + len / 2;
      const tr = re[q] * c - im[q] * s, ti = re[q] * s + im[q] * c;
      re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
    }
  }
  const out = new Float32Array(N / 2);
  for (let i = 0; i < N / 2; i++) out[i] = 20 * Math.log10(Math.hypot(re[i], im[i]) / N + 1e-12);
  return out;
}
function signal(len, { f0 = 0, amp = 0, tone = 0, noise = 0.02 }) {
  const x = new Float64Array(len), ph = Array.from({ length: 200 }, () => rnd() * 6.28);
  for (let i = 0; i < len; i++) {
    const t = i / SR; let v = noise * gauss();
    if (f0) { const am = 1 + 0.2 * Math.sin(2 * Math.PI * 7 * t); for (let k = 1; k * f0 < 9000; k++) v += amp * am * Math.sin(2 * Math.PI * k * f0 * t + ph[k]) / Math.pow(k, 0.7); }
    if (tone) v += 0.3 * Math.sin(2 * Math.PI * tone * t);
    x[i] = v;
  }
  return x;
}
function runDetector(segments) {
  const det = new CombDetector({ binHz: SR / N });
  let t = 0, out = [];
  for (const seg of segments) {
    const x = signal(N + HOP * seg.frames, seg);
    for (let f = 0; f < seg.frames; f++) { out.push({ ...det.process(fftDb(x.subarray(f * HOP, f * HOP + N)), t), phase: seg.name }); t += HOP / SR; }
  }
  return out;
}

{ // quiet room, then a 2-blade toy quad at f0 = 430 Hz
  const r = runDetector([{ name: 'quiet', frames: 60 }, { name: 'drone', frames: 20, f0: 430, amp: 0.01 }]);
  const quietFalse = r.filter(o => o.phase === 'quiet' && o.detected).length;
  const drone = r.filter(o => o.phase === 'drone');
  const firstHit = drone.findIndex(o => o.detected);
  const f0s = drone.filter(o => o.detected).map(o => o.f0);
  check('detector: no alarm on quiet room', quietFalse === 0, `false=${quietFalse} maxScore=${Math.max(...r.filter(o => o.phase === 'quiet').map(o => o.score)).toFixed(2)}`);
  check('detector: alarms on rotor comb', firstHit >= 0 && firstHit <= 10, `first hit frame ${firstHit} (${(firstHit * HOP / SR).toFixed(2)} s), score ${drone[drone.length - 1].score.toFixed(1)}`);
  check('detector: f0 within 2%', f0s.length && f0s.every(f => Math.abs(f - 430) / 430 < 0.02), `f0=${[...new Set(f0s)].join(',')}`);
}
{ // a quieter drone (half amplitude, -6 dB) is still caught
  const r = runDetector([{ name: 'quiet', frames: 60 }, { name: 'drone', frames: 20, f0: 250, amp: 0.005 }]);
  check('detector: catches a quieter drone', r.some(o => o.phase === 'drone' && o.detected), 'last score ' + r[r.length - 1].score.toFixed(1));
}
{ // long quiet room: zero false alarms over 600 frames (~26 s)
  const r = runDetector([{ name: 'quiet', frames: 600 }]);
  check('detector: no false alarm in 26 s of noise', !r.some(o => o.detected), 'longest chain ' + Math.max(...r.map(o => o.chain)));
}
{ // a single loud whistle must not fire
  const r = runDetector([{ name: 'quiet', frames: 60 }, { name: 'tone', frames: 20, tone: 1000 }]);
  check('detector: ignores a single tone', !r.some(o => o.detected), `max score ${Math.max(...r.map(o => o.score)).toFixed(2)}`);
}
{ // received level falls ~6 dB per distance doubling
  const lv = amp => { const r = runDetector([{ name: 'q', frames: 60 }, { name: 'd', frames: 8, f0: 300, amp }]); return r[r.length - 1].level; };
  const d = lv(0.02) - lv(0.01);
  check('detector: level tracks amplitude (6 dB per x2)', Math.abs(d - 6.02) < 1.5, `delta ${d.toFixed(2)} dB`);
}

// ---------- fusion: 5 phones in an 8 x 6 m room, drone crosses it at 0.9 m/s
{
  const nodes = F.roomLayout(8, 6, 5);
  const tr = new F.Tracker(1);
  const errs = []; let last;
  for (let i = 0; i <= 32; i++) { // 4 Hz for 8 s, stays inside the room
    const t = i / 4, truth = { x: -3 + 0.8 * t, y: -2 + 0.4 * t };
    const fix = F.localize(F.simulateLevels(nodes, truth, 70, 1.5, rnd));
    last = tr.update(t, fix);
    if (i > 8) errs.push(Math.hypot(last.x - truth.x, last.y - truth.y));
  }
  const vx = 0.8, vy = 0.4, sp = Math.hypot(vx, vy), hd = Math.atan2(vx, vy) * 180 / Math.PI;
  errs.sort((a, b) => a - b);
  check('fusion: median track error < 1 m', errs[errs.length >> 1] < 1, `median ${errs[errs.length >> 1].toFixed(2)} m, worst ${errs[errs.length - 1].toFixed(2)} m`);
  check('fusion: speed within 25%', Math.abs(last.speed - sp) / sp < 0.25, `est ${last.speed.toFixed(2)} vs ${sp.toFixed(2)} m/s`);
  check('fusion: heading within 20 deg', Math.abs(((last.heading - hd + 540) % 360) - 180) < 20, `est ${last.heading.toFixed(0)} vs ${hd.toFixed(0)} deg`);
  check('fusion: needs 3 phones', F.localize(nodes.slice(0, 2).map(n => ({ ...n, level: 50 }))) === null);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
