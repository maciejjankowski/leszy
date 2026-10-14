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
    const n = Math.round(sr * dur), re = new Float32Array(n), im = new Float32Array(n), k = (f1 - f0) / dur, a = 0.4; // soft edges: no click
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
  // opts.frac: a candidate must reach this fraction of the loudest peak (0.5 default; lower catches a direct path
  // quieter than its own bounce). opts.lookMs: how far before the loudest peak to search (10 ms default = 3.4 m of path).
  function detectFirst(x, chirp, opts = {}) {
    const thr = opts.frac ?? 0.5, lookMs = opts.lookMs ?? 10;
    const env = xcorrEnv(x, chirp);
    if (!env.length) return null;
    let mi = 0, mv = 0; for (let i = 0; i < env.length; i++) if (env[i] > mv) { mv = env[i]; mi = i; }
    const s = []; for (let i = 0; i < env.length; i += 7) s.push(env[i]); s.sort((a, b) => a - b);
    const snr = mv / (s[s.length >> 1] + 1e-12);
    let i = Math.max(0, mi - Math.round(lookMs / 1000 * chirp.sr));
    while (i < mi && env[i] < thr * mv) i++;
    while (i + 1 < env.length && env[i + 1] > env[i]) i++;
    let frac = 0;
    if (i > 0 && i + 1 < env.length) { const y0 = env[i - 1], y1 = env[i], y2 = env[i + 1], den = y0 - 2 * y1 + y2; if (den) frac = 0.5 * (y0 - y2) / den; }
    return { sample: i + frac, snr, peak: mv }; // peak = how loud the beep arrived (for device profiles)
  }

  // ---------- distances ----------
  // heard[x][y] = time (s, on phone x's own clock) phone x heard phone y's beep.
  // The formula comes out short by half of each phone's own speaker-to-mic gap; offset[id] adds that back
  // (fitted from tape-measured pairs, see fitOffsets). c = speed of sound for the room (soundSpeed).
  function pairDistances(ids, heard, opts = {}) {
    const out = [], c = opts.c || C, off = opts.offset || {};
    for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
      const A = heard[ids[a]] || {}, B = heard[ids[b]] || {};
      const v = [A[ids[a]], A[ids[b]], B[ids[a]], B[ids[b]]];
      if (v.some(t => !Number.isFinite(t))) continue;
      const raw = c / 2 * ((v[1] - v[0]) - (v[3] - v[2])), d = raw + (off[ids[a]] || 0) + (off[ids[b]] || 0);
      if (d > -0.3 && d < 60) out.push({ a: ids[a], b: ids[b], d: Math.max(d, 0.05), raw });
    }
    return out;
  }
  const soundSpeed = tC => 331.3 + 0.606 * tC; // m/s; 20 C -> 343.4

  // Distances from several rounds at once: per direction A->B take the MEDIAN over rounds of
  // (A heard B) - (A heard A) - slot gap, so a lone wrong peak in one round cannot move the pair.
  // rounds: [{ order, slot, heard: {id: {id: t}} }] ; returns the same shape as pairDistances.
  function medianDistances(ids, rounds, opts = {}) {
    const c = opts.c || C, off = opts.offset || {}, med = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
    const one = (a, b) => med(rounds.map(r => { const H = r.heard[a]; if (!H || !r.order.includes(a) || !r.order.includes(b)) return NaN; return H[b] - H[a] - (r.order.indexOf(b) - r.order.indexOf(a)) * r.slot; }));
    const out = [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i], b = ids[j], raw = c / 2 * (one(a, b) + one(b, a)); if (!Number.isFinite(raw)) continue;
      const d = raw + (off[a] || 0) + (off[b] || 0); if (d > -0.3 && d < 60) out.push({ a, b, d: Math.max(d, 0.05), raw });
    }
    return out;
  }

  // Per-phone offsets from tape-measured pairs: raw + k_a + k_b = tape. Few pairs -> one shared k for all
  // phones; enough pairs -> least squares per phone, pulled toward the shared k (ridge).
  function fitOffsets(dists, tape) {
    const eq = dists.filter(x => tape[x.a + "|" + x.b] > 0).map(x => ({ a: x.a, b: x.b, r: tape[x.a + "|" + x.b] - x.raw }));
    if (!eq.length) return { k: {}, shared: 0, n: 0 };
    const shared = eq.reduce((s, e) => s + e.r, 0) / eq.length / 2;
    const ids = [...new Set(eq.flatMap(e => [e.a, e.b]))], k = Object.fromEntries(ids.map(i => [i, shared]));
    if (eq.length >= ids.length) { // Gauss-Seidel on the normal equations with a ridge toward the shared k
      for (let it = 0; it < 200; it++) for (const i of ids) {
        let num = 0.5 * shared, den = 0.5;
        for (const e of eq) if (e.a === i) { num += e.r - k[e.b]; den++; } else if (e.b === i) { num += e.r - k[e.a]; den++; }
        k[i] = num / den;
      }
    }
    return { k, shared, n: eq.length };
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

  // ---------- layout: a network of springs ----------
  // Each measured pair is a spring whose rest length is the measured distance; SMACOF (stress majorization)
  // finds the lowest-energy layout, step by step. Missing pairs = no spring.
  //   opts.init   {id: {x, y}}  warm start (e.g. the previous map), so the map settles instead of jumping
  //   opts.robust true          springs that stay stretched far beyond the rest get weaker (blocked paths read long)
  //   opts.iters  steps per pass
  function smacofSteps(X, D, W, iters) {
    const n = X.length;
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
    return X;
  }
  function layout(ids, dists, iters = 300, opts = {}) {
    if (typeof iters === "object") { opts = iters; iters = opts.iters || 300; }
    const n = ids.length, ix = new Map(ids.map((id, i) => [id, i]));
    const D = Array.from({ length: n }, () => Array(n).fill(Infinity)), W = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) D[i][i] = 0;
    const used = [];
    for (const p of dists) { const i = ix.get(p.a), j = ix.get(p.b); if (i === undefined || j === undefined) continue; D[i][j] = D[j][i] = p.d; W[i][j] = W[j][i] = p.w || 1; used.push([i, j, p]); }
    let X;
    const init = opts.init || {};
    if (ids.filter(id => init[id]).length >= Math.max(3, n - 2)) { // warm start: known phones keep their place, new ones start near the middle
      const known = ids.filter(id => init[id]), cx = known.reduce((s, id) => s + init[id].x, 0) / known.length, cy = known.reduce((s, id) => s + init[id].y, 0) / known.length;
      X = ids.map((id, i) => init[id] ? [init[id].x, init[id].y] : [cx + Math.cos(i * 2.4) * 0.5, cy + Math.sin(i * 2.4) * 0.5]);
    } else { // cold start: classical MDS on shortest-path-completed distances
      const G = D.map(r => r.slice());
      for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (G[i][k] + G[k][j] < G[i][j]) G[i][j] = G[i][k] + G[k][j];
      const big = Math.max(...G.flat().filter(Number.isFinite), 1);
      const D2 = G.map(r => r.map(v => (Number.isFinite(v) ? v : big * 1.5) ** 2));
      const rm = D2.map(r => r.reduce((s, v) => s + v, 0) / n), gm = rm.reduce((s, v) => s + v, 0) / n;
      const B = D2.map((r, i) => r.map((v, j) => -0.5 * (v - rm[i] - rm[j] + gm)));
      const { vecs, vals } = top2(B);
      X = ids.map((_, i) => [vecs[0][i] * Math.sqrt(Math.max(vals[0], 1e-9)), vecs[1][i] * Math.sqrt(Math.max(vals[1], 1e-9))]);
    }
    X = smacofSteps(X, D, W, iters);
    const suspect = [];
    if (opts.robust) for (let pass = 0; pass < 3; pass++) { // weaken springs whose length disagrees with the rest of the network
      for (const [i, j, p] of used) {
        const e = D[i][j] - Math.hypot(X[i][0] - X[j][0], X[i][1] - X[j][1]); // > 0: measured longer than the map allows
        W[i][j] = W[j][i] = (p.w || 1) / (1 + (e / 0.3) ** 2);
      }
      X = smacofSteps(X, D, W, Math.ceil(iters / 2));
    }
    let stress = 0, cnt = 0;
    for (const [i, j, p] of used) {
      const e = Math.hypot(X[i][0] - X[j][0], X[i][1] - X[j][1]) - p.d;
      if (opts.robust && W[i][j] < 0.5 * (p.w || 1)) suspect.push({ a: p.a, b: p.b, off: -e }); else { stress += e * e; cnt++; }
    }
    return { pos: Object.fromEntries(ids.map((id, i) => [id, { x: X[i][0], y: X[i][1] }])), rms: Math.sqrt(stress / Math.max(cnt, 1)), suspect };
  }

  // Put one moving phone on a frozen map: minimise sum (|p - q_i| - d_i)^2 over the fixed phones q_i (Gauss-Newton).
  function placeOne(fixed, dists, id, start) {
    const obs = dists.filter(x => (x.a === id || x.b === id) && fixed[x.a === id ? x.b : x.a]).map(x => ({ q: fixed[x.a === id ? x.b : x.a], d: x.d }));
    if (obs.length < 2) return null;
    let p = start ? { x: start.x, y: start.y } : { x: obs.reduce((s, o) => s + o.q.x, 0) / obs.length, y: obs.reduce((s, o) => s + o.q.y, 0) / obs.length + 0.01 };
    for (let it = 0; it < 60; it++) {
      let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
      for (const { q, d } of obs) {
        const dx = p.x - q.x, dy = p.y - q.y, r = Math.hypot(dx, dy) || 1e-6, e = r - d, jx = dx / r, jy = dy / r;
        a11 += jx * jx; a12 += jx * jy; a22 += jy * jy; b1 -= jx * e; b2 -= jy * e;
      }
      const det = a11 * a22 - a12 * a12 || 1e-9, sx = (a22 * b1 - a12 * b2) / det, sy = (a11 * b2 - a12 * b1) / det;
      p = { x: p.x + sx, y: p.y + sy }; if (Math.hypot(sx, sy) < 1e-4) break;
    }
    let rms = 0; for (const { q, d } of obs) rms += (Math.hypot(p.x - q.x, p.y - q.y) - d) ** 2;
    return { x: p.x, y: p.y, rms: Math.sqrt(rms / obs.length), n: obs.length };
  }

  // Align a new map onto a previous one (best rotation, mirror and shift over the phones both have), so a refit of a room
  // that did not move draws the same picture. Phones only in the new map are carried along by the same transform.
  function alignTo(pos, ref) {
    const ids = Object.keys(pos).filter(id => ref[id]); if (ids.length < 2) return pos;
    const mean = (P, k) => ids.reduce((s, id) => s + P[id][k], 0) / ids.length;
    const px = mean(pos, "x"), py = mean(pos, "y"), rx = mean(ref, "x"), ry = mean(ref, "y");
    let best = null;
    for (const refl of [1, -1]) {
      let a = 0, b = 0;
      for (const id of ids) { const x = pos[id].x - px, y = refl * (pos[id].y - py), u = ref[id].x - rx, v = ref[id].y - ry; a += x * u + y * v; b += x * v - y * u; }
      const th = Math.atan2(b, a), c = Math.cos(th), s = Math.sin(th);
      const map = p => { const x = p.x - px, y = refl * (p.y - py); return { x: x * c - y * s + rx, y: x * s + y * c + ry }; };
      let err = 0; for (const id of ids) { const q = map(pos[id]); err += (q.x - ref[id].x) ** 2 + (q.y - ref[id].y) ** 2; }
      if (!best || err < best.err) best = { err, map };
    }
    return Object.fromEntries(Object.entries(pos).map(([id, p]) => [id, best.map(p)]));
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

  const api = { C, soundSpeed, medianDistances, makeChirp, xcorrEnv, detectFirst, pairDistances, fitOffsets, layout, placeOne, alignTo, orient, combLevel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Ranging = api;
})(typeof self !== 'undefined' ? self : this);
