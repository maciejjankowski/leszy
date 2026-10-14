// Fusion: where is the drone, given how loud each phone hears it.
// Model: level_i = S - 20*log10(distance_i)   (S = unknown source loudness)
// Grid search for the point where all phones agree on S. Then a constant-velocity
// Kalman filter turns the noisy fixes into a track: speed, heading, predicted path.
// Works in the browser (window.Fusion) and in Node (require) for tests.
(function (root) {
  const MIN_D = 0.5; // m, a phone right under the drone does not mean infinite level

  function costAt(nodes, x, y) {
    let sum = 0, sum2 = 0;
    for (const n of nodes) {
      const d = Math.max(Math.hypot(x - n.x, y - n.y), MIN_D);
      const s = n.level + 20 * Math.log10(d);
      sum += s; sum2 += s * s;
    }
    const m = sum / nodes.length;
    return { cost: sum2 / nodes.length - m * m, S: m };
  }

  function gridBest(nodes, x0, x1, y0, y1, steps) {
    let best = null;
    const dx = (x1 - x0) / steps, dy = (y1 - y0) / steps;
    for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps; j++) {
      const x = x0 + i * dx, y = y0 + j * dy, c = costAt(nodes, x, y);
      if (!best || c.cost < best.cost) best = { x, y, cost: c.cost, S: c.S };
    }
    best.cell = Math.max(dx, dy);
    return best;
  }

  // nodes: [{x, y, level}] level in dB, gain-corrected. Returns null with fewer than 3.
  function localize(nodes) {
    nodes = nodes.filter(n => [n.x, n.y, n.level].every(Number.isFinite));
    if (nodes.length < 3) return null;
    const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 2);
    const pad = span * 0.5; // a room demo: the drone stays roughly inside the phone ring
    const X0 = Math.min(...xs) - pad, X1 = Math.max(...xs) + pad;
    const Y0 = Math.min(...ys) - pad, Y1 = Math.max(...ys) + pad;
    const coarse = gridBest(nodes, X0, X1, Y0, Y1, 60);
    const r = coarse.cell * 2;
    const fine = gridBest(nodes, coarse.x - r, coarse.x + r, coarse.y - r, coarse.y + r, 30);
    // uncertainty: radius of the coarse region whose cost is within 1 dB^2 of the best
    let err = coarse.cell;
    const step = coarse.cell;
    for (let x = X0; x <= X1; x += step) for (let y = Y0; y <= Y1; y += step) {
      if (costAt(nodes, x, y).cost < fine.cost + 1) err = Math.max(err, Math.hypot(x - fine.x, y - fine.y));
    }
    return { x: fine.x, y: fine.y, rms: Math.sqrt(Math.max(fine.cost, 0)), S: fine.S, err: Math.min(err, span) };
  }

  // Per-axis constant-velocity Kalman filter. accel = how hard the drone can turn (m/s^2).
  class Tracker {
    constructor(accel = 1) { this.q = accel * accel; this.reset(); }
    reset() { this.s = null; this.trail = []; }
    _axis(a, z, R, dt) {
      // predict
      a.p += a.v * dt;
      const q = this.q, dt2 = dt * dt;
      a.P00 += dt * (2 * a.P01 + dt * a.P11) + q * dt2 * dt2 / 4;
      a.P01 += dt * a.P11 + q * dt2 * dt / 2;
      a.P11 += q * dt2;
      // update
      const S = a.P00 + R, k0 = a.P00 / S, k1 = a.P01 / S, y = z - a.p;
      a.p += k0 * y; a.v += k1 * y;
      const P00 = a.P00, P01 = a.P01;
      a.P00 -= k0 * P00; a.P01 -= k0 * P01; a.P11 -= k1 * P01;
    }
    update(t, fix) {
      const R = Math.max(fix.err, 0.3) ** 2;
      if (!this.s || t - this.s.t > 4) {
        const ax = z => ({ p: z, v: 0, P00: R, P01: 0, P11: 4 });
        this.s = { t, x: ax(fix.x), y: ax(fix.y), n: 1 };
        this.trail = [];
      } else {
        const dt = Math.max(t - this.s.t, 0.01);
        this._axis(this.s.x, fix.x, R, dt); this._axis(this.s.y, fix.y, R, dt);
        this.s.t = t; this.s.n++;
      }
      this.trail.push({ t, x: this.s.x.p, y: this.s.y.p });
      while (this.trail.length && t - this.trail[0].t > 20) this.trail.shift();
      return this.state();
    }
    state() {
      if (!this.s) return null;
      const vx = this.s.x.v, vy = this.s.y.v;
      return {
        x: this.s.x.p, y: this.s.y.p, vx, vy,
        speed: Math.hypot(vx, vy),
        heading: (Math.atan2(vx, vy) * 180 / Math.PI + 360) % 360, // 0 = up / north, clockwise
        posErr: Math.sqrt(this.s.x.P00 + this.s.y.P00),
        updates: this.s.n, t: this.s.t,
      };
    }
  }

  // Simulator shared by the radar's SIM mode and the tests.
  function simulateLevels(nodes, drone, S = 70, noiseDb = 1.5, rand = Math.random) {
    const gauss = () => { let u = 0, v = 0; while (!u) u = rand(); v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    return nodes.map(n => {
      const d = Math.max(Math.hypot(drone.x - n.x, drone.y - n.y), MIN_D);
      return { ...n, level: S - 20 * Math.log10(d) + noiseDb * gauss() };
    });
  }

  // Phone layout preset: 4 corners + centre of a W x H room, origin at the centre.
  function roomLayout(w, h, count) {
    const pts = [[-w / 2, h / 2], [w / 2, h / 2], [w / 2, -h / 2], [-w / 2, -h / 2], [0, 0]];
    for (let i = 5; i < count; i++) { const a = i * 2.4; pts.push([Math.cos(a) * w / 4, Math.sin(a) * h / 4]); }
    return pts.slice(0, count).map(([x, y]) => ({ x, y }));
  }

  const api = { localize, Tracker, simulateLevels, roomLayout };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Fusion = api;
})(typeof self !== 'undefined' ? self : this);
