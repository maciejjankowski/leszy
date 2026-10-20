// Harmonic-comb drone detector, after VolAnti tier 1 (github.com/agamrossen/VolAnti docs/how-it-works.md):
// rotors chop the air at f0 = blades x rev/s, so the spectrum is a comb of evenly spaced teeth.
// Per frame: subtract an adaptive per-bin floor, score every candidate f0 by
// (energy on the teeth - energy in the gaps) / sqrt(K), and alarm only when the
// same f0 wins several frames in a row. Input is a dB spectrum (AnalyserNode style).
(function (root) {
  class CombDetector {
    constructor(o) {
      this.binHz = o.binHz;
      this.fmin = o.fmin || 100;        // cheap toy quads sit roughly 150-1200 Hz
      this.fmax = o.fmax || 2000;        // Tello ~540 Hz, small toy props up to ~2 kHz (Astra r2 table)
      this.fHarmMax = o.fHarmMax || 8000;
      this.maxK = o.maxK || 24;
      this.threshold = o.threshold || 15;  // noise alone reaches ~24 on some frames; the 6-frame f0 chain is what rejects it
      this.needFrames = o.needFrames || 6;   // same f0 (within 3%) six frames running, as VolAnti tier 1
      this.holdSec = o.holdSec || 1.5;
      this.riseTau = o.riseTau || 8;    // s, floor creeps up slowly so a new drone stands out
      this.fallTau = o.fallTau || 1;    // s, floor drops fast when the room goes quiet
      this.floor = null; this.lastT = null; this.t0 = null;
      this.warmSec = o.warmSec || 2;     // learn the room first, no alarms meanwhile
      this.chainF0 = 0; this.chain = 0; this.lastGood = -1e9;
    }

    process(db, t) {
      const n = db.length, bin = this.binHz;
      if (!this.floor) { this.floor = Float32Array.from(db, v => (isFinite(v) ? v : -140)); this.lastT = t; this.t0 = t; }
      const warming = t - this.t0 < this.warmSec;
      const dt = Math.min(Math.max(t - this.lastT, 0.001), 1); this.lastT = t;
      // baseline per bin = the lower of (a) the slowly learned room floor and (b) the median of the neighbouring bins right now.
      // (b) keeps a drone visible that was already flying when the phone started: its teeth stand above their own gaps
      // even after the room floor has learned them in.
      const top = Math.min(n, Math.ceil(this.fHarmMax / bin) + 12), W = 8, loc = new Float32Array(n).fill(-140), win = [];
      for (let i = 0; i < top; i++) { win.length = 0; for (let j = Math.max(1, i - W); j <= Math.min(top - 1, i + W); j++) win.push(isFinite(db[j]) ? db[j] : -140); win.sort((x, y) => x - y); loc[i] = win[win.length >> 1]; }
      const r = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const v = isFinite(db[i]) ? db[i] : -140, base = i < top ? Math.min(this.floor[i], loc[i]) : this.floor[i];
        r[i] = Math.min(Math.max(v - base, 0), 25); // dB above the baseline, capped so nothing dominates
      }
      const peak = (f) => { const c = Math.round(f / bin); let m = -1; for (let b = c - 1; b <= c + 1; b++) if (b > 0 && b < n && r[b] > m) m = r[b]; return m; };

      const comb = (f0) => {
        const K = Math.min(this.maxK, Math.floor(this.fHarmMax / f0));
        if (K < 3) return null;
        let s = 0, lit = 0;
        for (let k = 1; k <= K; k++) { const tooth = peak(k * f0); s += tooth - peak((k + 0.5) * f0); if (tooth > 10) lit++; }
        if (lit < Math.max(4, Math.ceil(K / 4))) return null; // one loud whistle is not a comb
        return { score: s / Math.sqrt(K), f0, K };
      };
      let best = { score: -1e9, f0: 0, K: 0 };
      for (let f0 = this.fmin; f0 <= this.fmax; f0 += 1) { const c = comb(f0); if (c && c.score > best.score) best = c; }
      // octave check: half the true f0 also hits every other tooth; prefer the higher one if it scores nearly as well
      for (let up; best.f0 && best.f0 * 2 <= this.fmax && (up = comb(best.f0 * 2)) && up.score > 0.7 * best.score;) best = up;

      const good = best.score >= this.threshold;
      if (good && this.chain > 0 && Math.abs(best.f0 - this.chainF0) / this.chainF0 < 0.03) this.chain++;
      else this.chain = good ? 1 : 0;
      if (good) this.chainF0 = best.f0;
      if (this.chain >= this.needFrames) this.lastGood = t;
      const detected = !warming && t - this.lastGood < this.holdSec;

      // received level: power above the floor on the teeth (what the fusion compares between phones)
      let p = 0; const teeth = [];
      if (best.f0) for (let k = 1; k <= best.K; k++) {
        let b = Math.round(k * best.f0 / bin); if (b + 1 >= n) break;
        if (r[b - 1] > r[b]) b--; else if (r[b + 1] > r[b]) b++; // same peak bin the score used
        teeth.push(k * best.f0);
        p += Math.max(Math.pow(10, db[b] / 10) - Math.pow(10, this.floor[b] / 10), 0);
      }
      const level = p > 0 ? 10 * Math.log10(p) : -140;

      // floor update; freeze the bins under the comb while a drone is present so it is not learned away
      const freeze = new Uint8Array(n);
      if (detected) for (const f of teeth) { const c = Math.round(f / bin); for (let b = c - 2; b <= c + 2; b++) if (b >= 0 && b < n) freeze[b] = 1; }
      const aR = 1 - Math.exp(-dt / (warming ? 0.3 : this.riseTau)), aF = 1 - Math.exp(-dt / (warming ? 0.3 : this.fallTau));
      for (let i = 0; i < n; i++) {
        if (freeze[i]) continue;
        const v = isFinite(db[i]) ? db[i] : -140, d = v - this.floor[i];
        this.floor[i] += d * (d > 0 ? aR : aF);
      }
      return { warming, score: best.score, f0: best.f0, chain: this.chain, detected, level, teeth };
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { CombDetector }; else root.CombDetector = CombDetector;
})(typeof self !== 'undefined' ? self : this);
