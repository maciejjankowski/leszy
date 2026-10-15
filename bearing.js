// Two-microphone bearing (one node = two DJI transmitters on one receiver, or any stereo input).
// GCC-PHAT (Knapp & Carter 1976): whiten the cross-spectrum so the correlation peak is sharp
// even for a tonal rotor sound, keep only the band of interest, then the lag of the peak is the
// time difference of arrival tau. With mic spacing d: sin(angle) = c * tau / d, angle measured
// from "straight ahead" (perpendicular to the mic line); positive = towards the right mic.
// A front/back mirror is unavoidable with two mics: the operator says which side.
// Spacing: a rotor is periodic, so the correlation repeats every 1/f0. Keep d < c/(2*f0): 0.3 m is safe up to ~570 Hz.
(function (root) {
  const C = 343;
  const median = a => { const s = Array.from(a).sort((x, y) => x - y); return s.length ? (s.length & 1 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
  function fft(re, im, inv) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= n; len <<= 1) {
      const a = (inv ? 2 : -2) * Math.PI / len;
      for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(a * k), s = Math.sin(a * k), p = i + k, q = p + len / 2;
        const tr = re[q] * c - im[q] * s, ti = re[q] * s + im[q] * c;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
      }
    }
    if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
  // l, r: Float32Array of equal power-of-two length. Returns {lag (samples by which r lags l; positive = r heard it later),
  // tau (s), peak, second, conf = peak/second} searching only |lag| <= maxLag and only the band [fmin, fmax] Hz.
  function gccPhat(l, r, sr, { maxLag = 200, fmin = 100, fmax = 2000, gate = 3 } = {}) {
    const n = l.length, lr = new Float64Array(n), li = new Float64Array(n), rr = new Float64Array(n), ri = new Float64Array(n);
    for (let i = 0; i < n; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n); lr[i] = l[i] * w; rr[i] = r[i] * w; }
    fft(lr, li, false); fft(rr, ri, false);
    const b0 = Math.max(1, Math.floor(fmin / sr * n)), b1 = Math.min(n / 2 - 1, Math.ceil(fmax / sr * n));
    const gr = new Float64Array(n), gi = new Float64Array(n), mag = new Float64Array(b1 - b0 + 1);
    for (let k = b0; k <= b1; k++) mag[k - b0] = Math.hypot(lr[k], li[k]) * Math.hypot(rr[k], ri[k]);
    // plain PHAT gives every bin the same vote, so for a rotor (a dozen narrow lines in a band of hundreds of
    // noise-only bins) the noise outvotes the signal. Gate: only bins with cross-power well above the band median count.
    const thr = gate * median(mag);
    for (let k = b0; k <= b1; k++) { // X * conj(Y), unit magnitude, mirrored for a real inverse
      if (mag[k - b0] < thr) continue;
      const xr = lr[k] * rr[k] + li[k] * ri[k], xi = li[k] * rr[k] - lr[k] * ri[k], m = Math.hypot(xr, xi) || 1;
      gr[k] = xr / m; gi[k] = xi / m; gr[n - k] = gr[k]; gi[n - k] = -gi[k];
    }
    fft(gr, gi, true);
    let best = -Infinity, bl = 0, sum = 0;
    for (let lag = -maxLag; lag <= maxLag; lag++) { const v = gr[(lag + n) % n]; sum += Math.abs(v); if (v > best) { best = v; bl = lag; } }
    const mean = sum / (2 * maxLag + 1); // conf = peak over the mean of the window: ~1 = nothing, >3 = a clear arrival
    // parabolic refinement to a fraction of a sample
    const ym = gr[(bl - 1 + n) % n], y0 = gr[(bl + n) % n], yp = gr[(bl + 1 + n) % n], den = ym - 2 * y0 + yp;
    const frac = den ? 0.5 * (ym - yp) / den : 0, lag = bl + (Math.abs(frac) < 1 ? frac : 0);
    // positive lag = r(t) = l(t - lag): the right channel heard it later, the source is on the left mic's side
    return { lag: -lag, tau: -lag / sr, peak: best, conf: mean > 0 ? best / mean : 0 }; // ifft peak sits at -lag for r = l delayed
  }
  // tau = tR - tL (s), d (m) -> angle in degrees from straight ahead, positive towards the right mic (the one that heard it first); clipped at +-90
  function angleOf(tau, d, c = C) { const s = Math.max(-1, Math.min(1, -c * tau / d)); return Math.asin(s) * 180 / Math.PI; }
  function maxLagFor(d, sr, c = C) { return Math.ceil(d / c * sr) + 4; }
  const api = { C, fft, gccPhat, angleOf, maxLagFor, median };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Bearing = api;
})(typeof self !== 'undefined' ? self : this);
