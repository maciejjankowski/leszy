// node tests/bearing.test.js - GCC-PHAT recovers a known delay for noise, a rotor comb and a clap, with noise and clutter
const B = require('../bearing.js');
let fails = 0; const check = (name, ok, info) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails++; };
let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
const SR = 48000, N = 8192;
// source signal s(t); right channel = s delayed by lagR samples (fractional via linear interp), each channel with its own noise
function pair(src, lagR, snr) {
  const l = new Float32Array(N), r = new Float32Array(N), g = Math.pow(10, -snr / 20);
  for (let i = 0; i < N; i++) {
    l[i] = src(i) + g * gauss();
    const t = i - lagR, i0 = Math.floor(t), f = t - i0; r[i] = (src(i0) * (1 - f) + src(i0 + 1) * f) + g * gauss();
  }
  return [l, r];
}
const comb = (f0, ph) => i => { let v = 0; for (let k = 1; k <= 12; k++) v += Math.sin(2 * Math.PI * k * f0 * i / SR + ph[k]) / k; return v; };
const ph = Array.from({ length: 13 }, () => rnd() * 6.28);
const wn = Float64Array.from({ length: N + 2 }, gauss);
for (const [name, src, snr] of [['white noise', i => wn[Math.max(0, i)] || 0, 10], ['rotor comb 320 Hz', comb(320, ph), 6], ['rotor comb 540 Hz + hum', i => comb(540, ph)(i) + 0.8 * Math.sin(2 * Math.PI * 50 * i / SR), 3]]) {
  for (const lag of [-40, -17.5, 0, 9, 33]) { // d = 0.3 m -> |lag| <= 42 samples at 48 kHz
    const [l, r] = pair(src, lag, snr);
    const g = B.gccPhat(l, r, SR, { maxLag: B.maxLagFor(0.3, SR), fmin: 100, fmax: 2000 });
    check(`${name} lag ${lag}`, Math.abs(g.lag - lag) <= (snr >= 6 ? 1.5 : 3.5), `got ${g.lag.toFixed(1)} conf ${g.conf.toFixed(1)}`); // 3.5 samples at 0.3 m = about 4 degrees
  }
}
// a clap: short burst at sample 3000, wideband
const burst = Float64Array.from({ length: 200 }, (_, j) => Math.exp(-j / 40) * gauss());
const clap = i => (i >= 3000 && i < 3200 ? burst[i - 3000] : 0);
const [cl, cr] = pair(clap, 40, 20);
const gc = B.gccPhat(cl, cr, SR, { maxLag: 46, fmin: 300, fmax: 8000 });
check('clap lag 40', Math.abs(gc.lag - 40) <= 1 && gc.conf > 3, `got ${gc.lag.toFixed(1)} conf ${gc.conf.toFixed(1)}`);
check('spacing rule: 0.3 m unambiguous to 570 Hz', B.C / (2 * 0.3) > 570);
// geometry: d = 1 m, tau for 30 degrees
const tau = -Math.sin(30 * Math.PI / 180) * 0.3 / B.C; // right mic first = negative tR - tL
check('angle 30 deg from tau', Math.abs(B.angleOf(tau, 0.3) - 30) < 0.01);
check('angle clips at 90', Math.abs(B.angleOf(1, 0.3)) === 90);
check('median', B.median([3, 1, 2]) === 2 && B.median([4, 1, 3, 2]) === 2.5);
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
