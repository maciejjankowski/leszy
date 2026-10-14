// node tests/ranging.test.js - audience roll call in a simulated room:
// N phones with unrelated clocks, random playback latency, noise and a strong late reflection.
// Each phone beeps once in its slot; every phone detects every beep on its own clock; then
// pair distances -> MDS -> oriented map, compared with the true seats.
const R = require('../ranging.js');
let fails = 0;
const check = (name, ok, info) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails++; };
let seed = +(process.env.SEED || 11); const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };

const SR = 48000, SLOT = 0.5, chirp = R.makeChirp(SR, 8000, 12000);
function addChirp(x, at, amp) { // fractional-delay insert of the real chirp at time `at` (s)
  const p = at * SR, i0 = Math.floor(p), fr = p - i0;
  for (let i = 0; i < chirp.n; i++) { const v = amp * chirp.re[i]; if (i0 + i >= 0 && i0 + i < x.length) x[i0 + i] += v * (1 - fr); if (i0 + i + 1 < x.length) x[i0 + i + 1] += v * fr; }
}

function rollCall(seats, opts = {}) {
  const n = seats.length, ids = seats.map((_, i) => 'p' + i);
  const clock = ids.map(() => rnd() * 50);            // each phone's context clock started at a random time
  const lat = ids.map(() => 0.02 + rnd() * 0.12);       // playback latency 20-140 ms, unknown
  const sched = ids.map((_, k) => 1 + k * SLOT);        // slot start on the "true" timeline (s)
  const len = Math.ceil((1 + n * SLOT + 1) * SR), heard = {};
  ids.forEach((me, i) => {
    const x = new Float32Array(len);
    for (let s = 0; s < len; s++) x[s] = 0.002 * gauss();            // room noise
    ids.forEach((src, k) => {
      const d = Math.hypot(seats[i].x - seats[k].x, seats[i].y - seats[k].y), emit = sched[k] + lat[k];
      if (opts.deaf && opts.deaf(i, k)) return;                        // this pair cannot hear each other
      const amp = i === k ? 0.5 : 0.08 / Math.max(d, 0.5), c = opts.c || R.C;
      const dd = i === k ? (opts.selfGap || 0) : d; // own speaker sits a few cm from own mic
      addChirp(x, emit + dd / c, amp);
      addChirp(x, emit + (dd + 2.5) / c, amp * 1.3);                  // reflection, louder than direct
    });
    heard[me] = {};
    ids.forEach((src, k) => {                                          // search each slot window on my own clock
      const from = Math.floor(sched[k] * SR), win = x.subarray(from, from + Math.floor(0.45 * SR));
      const r = R.detectFirst(win, chirp);
      if (r && r.snr > 8) heard[me][src] = clock[i] + (from + r.sample) / SR;
    });
  });
  return { ids, heard };
}

function procrustesErr(est, seats, ids) { // best rotation/reflection/translation, then median error (m)
  const P = ids.map(id => [est[id].x, est[id].y]), Q = seats.map(s => [s.x, s.y]);
  const mean = A => [A.reduce((s, p) => s + p[0], 0) / A.length, A.reduce((s, p) => s + p[1], 0) / A.length];
  const mp = mean(P), mq = mean(Q), p = P.map(v => [v[0] - mp[0], v[1] - mp[1]]), q = Q.map(v => [v[0] - mq[0], v[1] - mq[1]]);
  let best = Infinity;
  for (const refl of [1, -1]) {
    const pr = p.map(v => [v[0], refl * v[1]]);
    let a = 0, b = 0; pr.forEach((v, i) => { a += v[0] * q[i][0] + v[1] * q[i][1]; b += v[0] * q[i][1] - v[1] * q[i][0]; });
    const th = Math.atan2(b, a), c = Math.cos(th), s = Math.sin(th);
    const e = pr.map((v, i) => Math.hypot(v[0] * c - v[1] * s - q[i][0], v[0] * s + v[1] * c - q[i][1])).sort((x, y) => x - y);
    best = Math.min(best, e[e.length >> 1]);
  }
  return best;
}

// 1. two phones, known distance: the BeepBeep formula itself
{
  const seats = [{ x: 0, y: 0 }, { x: 3, y: 0 }];
  const { ids, heard } = rollCall(seats);
  const d = R.pairDistances(ids, heard)[0];
  check('two phones 3.00 m apart, unrelated clocks + latency', d && Math.abs(d.d - 3) < 0.05, d ? d.d.toFixed(3) + ' m' : 'no pair');
}
// 2. a 12-seat audience (3 rows x 4) + 2 stage anchors
const audience = [];
for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) audience.push({ x: -3 + c * 2 + (rnd() - 0.5) * 0.4, y: -2 - r * 1.5 });
const seats = [{ x: -3, y: 1 }, { x: 3, y: 1 }, ...audience]; // p0 = stage left, p1 = stage right
{
  const { ids, heard } = rollCall(seats);
  const dists = R.pairDistances(ids, heard), pairs = ids.length * (ids.length - 1) / 2;
  const lay = R.layout(ids, dists);
  const err = procrustesErr(lay.pos, seats, ids);
  check('14 phones: all pairs ranged', dists.length === pairs, `${dists.length}/${pairs}`);
  check('14 phones: map within 0.25 m (median, after rotation)', err < 0.25, `median ${err.toFixed(3)} m, stress rms ${lay.rms.toFixed(3)} m`);
  const o = R.orient(lay.pos, 'p0', 'p1');
  const oerr = ids.map((id, i) => Math.hypot(o[id].x - seats[i].x, o[id].y - (seats[i].y - 1))).sort((a, b) => a - b);
  check('anchors turn the map: stage on top, left on the left', oerr[oerr.length >> 1] < 0.3, `median ${oerr[oerr.length >> 1].toFixed(3)} m vs true seats`);
}
// 3. back row cannot hear the stage anchors (missing pairs)
{
  const back = new Set([10, 11, 12, 13]);
  const { ids, heard } = rollCall(seats, { deaf: (i, k) => (back.has(i) && k < 2) || (back.has(k) && i < 2) });
  const dists = R.pairDistances(ids, heard), lay = R.layout(ids, dists), err = procrustesErr(lay.pos, seats, ids);
  check('missing pairs: map still within 0.4 m', err < 0.4, `${dists.length} pairs, median ${err.toFixed(3)} m`);
}
{ // 4. real-world flaws: 10 cm speaker-mic gap, a 25 C room (346 m/s), one pair blocked (+1.5 m)
  const { ids, heard } = rollCall(seats, { selfGap: 0.1, c: 346.1 });
  const dists = R.pairDistances(ids, heard); dists[5].d += 1.5;
  const lay = R.layout(ids, dists), err = procrustesErr(lay.pos, seats, ids);
  check('real-world flaws: map within 0.4 m', err < 0.4, 'median ' + err.toFixed(3) + ' m, stress rms ' + lay.rms.toFixed(3) + ' m');
}
{ // 5. blocked paths: three pairs read 1.5-2.5 m too long (first arrival was a reflection). Robust springs vs plain.
  const { ids, heard } = rollCall(seats);
  const dists = R.pairDistances(ids, heard); dists[3].d += 1.5; dists[20].d += 2.0; dists[47].d += 2.5;
  const plain = procrustesErr(R.layout(ids, dists).pos, seats, ids), rob = R.layout(ids, dists, { robust: true }), robust = procrustesErr(rob.pos, seats, ids);
  check('blocked paths: robust springs beat plain', robust < plain && robust < 0.15, 'plain ' + plain.toFixed(3) + ' m, robust ' + robust.toFixed(3) + ' m, flagged ' + rob.suspect.length + ' pairs');
}
{ // 6. tape calibration: every phone has a 12 cm speaker-mic gap; one taped pair fixes the shared offset
  const { ids, heard } = rollCall(seats, { selfGap: 0.12 });
  const raw = R.pairDistances(ids, heard), t = raw[0], truth = Math.hypot(seats[0].x - seats[1].x, seats[0].y - seats[1].y);
  const fit = R.fitOffsets(raw, { [t.a + '|' + t.b]: truth }), cal = R.pairDistances(ids, heard, { offset: Object.fromEntries(ids.map(i => [i, fit.k[i] ?? fit.shared])) });
  const errOf = ds => { const e = ds.map(x => { const i = ids.indexOf(x.a), j = ids.indexOf(x.b); return Math.abs(x.d - Math.hypot(seats[i].x - seats[j].x, seats[i].y - seats[j].y)); }).sort((p, q) => p - q); return e[e.length >> 1]; };
  check('tape calibration removes the speaker-mic bias', errOf(cal) < 0.03 && errOf(cal) < errOf(raw), 'median pair error ' + errOf(raw).toFixed(3) + ' m -> ' + errOf(cal).toFixed(3) + ' m');
}
{ // 7. speed of sound from temperature
  check('sound speed at 20 C is 343.4 m/s', Math.abs(R.soundSpeed(20) - 343.4) < 0.2, R.soundSpeed(20).toFixed(1) + ' m/s');
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
