// Room setup by beeps: where is every phone, with no clock sync.
// Two-way ranging (BeepBeep, Peng et al., SenSys 2007): every phone records its own mic while the
// phones beep in turn. For phones A and B, each notes when it heard A's beep and B's beep on its
// OWN sample clock, so clock offsets and audio latency cancel:
//   d(A,B) = c/2 * ((tA(B) - tA(A)) - (tB(B) - tB(A)))
// Pair distances -> 2D map by weighted MDS (SMACOF), then turned the right way round with two
// stage anchors. Chirp and first-peak detector reused from P074 room-map (2026-09-23).
// Works in the browser (window.Ranging) and in Node (require) for tests.
(function (root) {
  const C = 343.2; // m/s at ~20 C

  // ---------- chirp + matched filter (from P074) ----------
  function makeChirp(sr, f0, f1, dur = 0.04) {
    const n = Math.round(sr * dur), re = new Float32Array(n), im = new Float32Array(n), k = (f1 - f0) / dur, a = 0.15;
    for (let i = 0; i < n; i++) {
      const t = i / sr, ph = 2 * Math.PI * (f0 * t + k * t * t / 2), x = i / (n - 1); // Tukey window
      const w = x < a / 2 ? 0.5 * (1 - Math.cos(2 * Math.PI * x / a)) : x > 1 - a / 2 ? 0.5 * (1 - Math.cos(2 * Math.PI * (1 - x) / a)) : 1;
      re[i] = w * Math.cos(ph); im[i] = w * Math.sin(ph);
    }
    return { re, im, n, sr };
  }
  function fft(re, im, inv) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (inv ? 2 : -2) * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), h = len >> 1;
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < h; k++) {
          const a = i + k, b = a + h, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
    if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
  // envelope of the cross-correlation with the analytic chirp (FFT, so a 0.5 s window is cheap)
  function xcorrEnv(x, t) {
    let n = 1; while (n < x.length + t.n) n <<= 1;
    const xr = new Float64Array(n), xi = new Float64Array(n), tr = new Float64Array(n), ti = new Float64Array(n);
    xr.set(x); tr.set(t.re); ti.set(t.im);
    fft(xr, xi, false); fft(tr, ti, false);
    for (let k = 0; k < n; k++) { const a = xr[k], b = xi[k], c = tr[k], d = -ti[k]; xr[k] = a * c - b * d; xi[k] = a * d + b * c; }
    fft(xr, xi, true);
    const L = Math.max(0, x.length - t.n + 1), env = new Float64Array(L);
    for (let i = 0; i < L; i++) env[i] = Math.hypot(xr[i], xi[i]);
    return env;
  }
  // First strong arrival in x (not the loudest: reflections can be louder than the direct path).
  // Returns the time in samples from the start of x, with sub-sample interpolation, and an SNR.
  function detectFirst(x, chirp) {
    const env = xcorrEnv(x, chirp);
    if (!env.length) return null;
    let mi = 0, mv = 0; for (let i = 0; i < env.length; i++) if (env[i] > mv) { mv = env[i]; mi = i; }
    const s = []; for (let i = 0; i < env.length; i += 7) s.push(env[i]); s.sort((a, b) => a - b);
    const snr = mv / (s[s.length >> 1] + 1e-12);
    let i = Math.max(0, mi - Math.round(0.01 * chirp.sr));
    while (i < mi && env[i] < 0.5 * mv) i++;
    while (i + 1 < env.length && env[i + 1] > env[i]) i++;
    let frac = 0;
    if (i > 0 && i + 1 < env.length) { const y0 = env[i - 1], y1 = env[i], y2 = env[i + 1], den = y0 - 2 * y1 + y2; if (den) frac = 0.5 * (y0 - y2) / den; }
    return { sample: i + frac, snr };
  }

  // ---------- distances ----------
  // heard[x][y] = time (s, on phone x's own clock) phone x heard phone y's beep.
  function pairDistances(ids, heard) {
    const out = [];
    for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
      const A = heard[ids[a]] || {}, B = heard[ids[b]] || {};
      const v = [A[ids[a]], A[ids[b]], B[ids[a]], B[ids[b]]];
      if (v.some(t => !Number.isFinite(t))) continue;
      const d = C / 2 * ((v[1] - v[0]) - (v[3] - v[2]));
      if (d > -0.3 && d < 60) out.push({ a: ids[a], b: ids[b], d: Math.max(d, 0.05) });
    }
    return out;
  }

  // ---------- small linear algebra ----------
  function inverse(M) {
    const n = M.length, A = M.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]];
      const v = A[c][c] || 1e-12; for (let j = 0; j < 2 * n; j++) A[c][j] /= v;
      for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c]; if (f) for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[c][j]; }
    }
    return A.map(r => r.slice(n));
  }
  // top-2 eigenvectors of a symmetric matrix by power iteration with deflation
  function top2(B) {
    const n = B.length, vecs = [], vals = [], M = B.map(r => r.slice());
    for (let e = 0; e < 2; e++) {
      let v = Array.from({ length: n }, (_, i) => Math.sin(i * 1.7 + e + 1)), lam = 0;
      for (let it = 0; it < 300; it++) {
        const w = M.map(r => r.reduce((s, x, j) => s + x * v[j], 0)), nrm = Math.hypot(...w) || 1;
        lam = w.reduce((s, x, i) => s + x * v[i], 0); v = w.map(x => x / nrm);
      }
      vecs.push(v); vals.push(lam);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) M[i][j] -= lam * v[i] * v[j];
    }
    return { vecs, vals };
  }

  // ---------- MDS ----------
  // dists: [{a, b, d, w?}] over ids. Missing pairs allowed (filled by shortest path only for the start).
  function layout(ids, dists, iters = 300) {
    const n = ids.length, ix = new Map(ids.map((id, i) => [id, i]));
    const D = Array.from({ length: n }, () => Array(n).fill(Infinity)), W = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) D[i][i] = 0;
    for (const { a, b, d, w = 1 } of dists) { const i = ix.get(a), j = ix.get(b); if (i === undefined || j === undefined) continue; D[i][j] = D[j][i] = d; W[i][j] = W[j][i] = w; }
    // start: classical MDS on shortest-path-completed distances
    const G = D.map(r => r.slice());
    for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (G[i][k] + G[k][j] < G[i][j]) G[i][j] = G[i][k] + G[k][j];
    const big = Math.max(...G.flat().filter(Number.isFinite), 1);
    const D2 = G.map(r => r.map(v => (Number.isFinite(v) ? v : big * 1.5) ** 2));
    const rm = D2.map(r => r.reduce((s, v) => s + v, 0) / n), gm = rm.reduce((s, v) => s + v, 0) / n;
    const B = D2.map((r, i) => r.map((v, j) => -0.5 * (v - rm[i] - rm[j] + gm)));
    const { vecs, vals } = top2(B);
    let X = ids.map((_, i) => [vecs[0][i] * Math.sqrt(Math.max(vals[0], 1e-9)), vecs[1][i] * Math.sqrt(Math.max(vals[1], 1e-9))]);
    // SMACOF: weighted stress majorization (Guttman transform), handles missing pairs via W = 0
    const V = W.map((r, i) => r.map((w, j) => (i === j ? r.reduce((s, x, k) => s + (k === i ? 0 : x), 0) : -w)));
    const Vp = inverse(V.map(r => r.map(v => v + 1 / n))).map(r => r.map(v => v - 1 / n));
    for (let it = 0; it < iters; it++) {
      const Bx = Array.from({ length: n }, () => Array(n).fill(0));
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        if (i === j || !W[i][j]) continue;
        const dij = Math.hypot(X[i][0] - X[j][0], X[i][1] - X[j][1]) || 1e-9;
        Bx[i][j] = -W[i][j] * D[i][j] / dij;
      }
      for (let i = 0; i < n; i++) Bx[i][i] = -Bx[i].reduce((s, v, j) => s + (j === i ? 0 : v), 0);
      const BX = Bx.map(r => [r.reduce((s, v, j) => s + v * X[j][0], 0), r.reduce((s, v, j) => s + v * X[j][1], 0)]);
      X = Vp.map(r => [r.reduce((s, v, j) => s + v * BX[j][0], 0), r.reduce((s, v, j) => s + v * BX[j][1], 0)]);
    }
    let stress = 0, cnt = 0;
    for (const { a, b, d } of dists) { const i = ix.get(a), j = ix.get(b); if (i === undefined || j === undefined) continue; const e = Math.hypot(X[i][0] - X[j][0], X[i][1] - X[j][1]) - d; stress += e * e; cnt++; }
    return { pos: Object.fromEntries(ids.map((id, i) => [id, { x: X[i][0], y: X[i][1] }])), rms: Math.sqrt(stress / Math.max(cnt, 1)) };
  }

  // Turn the map the right way round: stage-left -> stage-right is the +x axis, stage on top,
  // audience below (the side where most phones are). Without anchors: centre it, leave rotation.
  function orient(pos, left, right) {
    const ids = Object.keys(pos);
    if (!pos[left] || !pos[right]) {
      const cx = ids.reduce((s, i) => s + pos[i].x, 0) / ids.length, cy = ids.reduce((s, i) => s + pos[i].y, 0) / ids.length;
      return Object.fromEntries(ids.map(i => [i, { x: pos[i].x - cx, y: pos[i].y - cy }]));
    }
    const L = pos[left], R = pos[right], mx = (L.x + R.x) / 2, my = (L.y + R.y) / 2, ang = Math.atan2(R.y - L.y, R.x - L.x);
    const c = Math.cos(-ang), s = Math.sin(-ang);
    let out = Object.fromEntries(ids.map(i => { const dx = pos[i].x - mx, dy = pos[i].y - my; return [i, { x: dx * c - dy * s, y: dx * s + dy * c }]; }));
    const others = ids.filter(i => i !== left && i !== right), below = others.filter(i => out[i].y < 0).length;
    if (below < others.length / 2) out = Object.fromEntries(ids.map(i => [i, { x: out[i].x, y: -out[i].y }]));
    return out;
  }

  // Level at a KNOWN rotor pitch: power on the teeth k*f0 above the floor (the hub tells phones each drone's f0).
  function combLevel(db, floor, binHz, f0, fmax = 6000) {
    let p = 0;
    for (let k = 1; k * f0 < fmax; k++) {
      const c = Math.round(k * f0 / binHz); let best = c;
      for (let b = c - 1; b <= c + 1; b++) if (b > 0 && b < db.length && db[b] > db[best]) best = b;
      if (best >= db.length) break;
      p += Math.max(Math.pow(10, db[best] / 10) - Math.pow(10, floor[best] / 10), 0);
    }
    return p > 0 ? 10 * Math.log10(p) : -140;
  }

  const api = { C, makeChirp, xcorrEnv, detectFirst, pairDistances, layout, orient, combLevel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Ranging = api;
})(typeof self !== 'undefined' ? self : this);
