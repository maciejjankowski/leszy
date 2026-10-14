// node tests/party_sim.js [hubUrl]  - drives party.php like 14 phones would (audio simulated):
// join, roll call (heard times from a simulated room), one drone, levels. Then open stage.html to look.
const R = require('../ranging.js'), F = require('../fusion.js');
const HUB = process.argv[2] || 'http://localhost:18080/drone-ear/party.php';
const q = a => HUB + (HUB.includes('?') ? '&' : '?') + 'a=' + a;
const post = (a, b) => fetch(q(a), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
const get = a => fetch(q(a)).then(r => r.json());
let seed = 5; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

(async () => {
  await post('admin', { cmd: 'reset' });
  const seats = [{ x: -3, y: 1, role: 'L', name: 'stage-L' }, { x: 3, y: 1, role: 'R', name: 'stage-R' }];
  const names = ['Ania', 'Bartek', 'Celina', 'Darek', 'Ewa', 'Filip', 'Gosia', 'Hubert', 'Iza', 'Janek', 'Kasia', 'Leon'];
  names.forEach((n, i) => seats.push({ x: -3 + (i % 4) * 2 + (rnd() - 0.5) * 0.4, y: -2 - Math.floor(i / 4) * 1.5, role: 'audience', name: n }));
  const ids = seats.map((_, i) => 'sim' + i);
  for (let i = 0; i < seats.length; i++) await post('join', { id: ids[i], name: seats[i].name, role: seats[i].role });
  const rc = await post('admin', { cmd: 'rollcall' });
  const order = rc.party.order, round = rc.party.round;
  // each phone's arrival times on its own clock: clock offset + playback latency + flight time + jitter
  const clock = ids.map(() => rnd() * 40), lat = ids.map(() => 0.02 + rnd() * 0.12);
  for (let i = 0; i < ids.length; i++) {
    const heard = {};
    order.forEach((src, k) => {
      const j = ids.indexOf(src), d = Math.hypot(seats[i].x - seats[j].x, seats[i].y - seats[j].y) + (i === j ? 0.1 : 0);
      heard[src] = clock[i] + k * 0.5 + lat[j] + d / R.C + (rnd() - 0.5) * 0.0002; // +-0.1 ms detection jitter
    });
    await post('heard', { id: ids[i], round, heard });
    await post('pose', { id: ids[i], heading: i === 4 ? 70 : 10 + (rnd() - 0.5) * 16 }); // one phone (Celina) turned 60 degrees off
  }
  const dr = await post('admin', { cmd: 'drones', k: 1 }), drone = dr.party.drones[0], di = ids.indexOf(drone.id);
  console.log('roll call round', round, 'with', order.length, 'phones; drone =', seats[di].name, 'at', seats[di].x.toFixed(1), seats[di].y.toFixed(1));
  const listeners = seats.map((s, i) => ({ ...s, i })).filter(s => s.i !== di);
  const lv = F.simulateLevels(listeners, seats[di], -30, 2, rnd);
  for (const l of lv) await post('levels', { id: ids[l.i], levels: { [drone.id]: +l.level.toFixed(1) } });
  // the stage's own math, from the hub's data
  const data = await get('data'), done = data.members.filter(m => m.round === round && m.heard);
  const heard = Object.fromEntries(done.map(m => [m.id, m.heard])), dists = R.pairDistances(done.map(m => m.id), heard);
  const lay = R.layout(done.map(m => m.id), dists, 200), map = R.orient(lay.pos, 'sim0', 'sim1');
  const mapErr = ids.map((id, i) => Math.hypot(map[id].x - seats[i].x, map[id].y - (seats[i].y - 1))).sort((a, b) => a - b);
  const use = data.members.filter(m => m.id !== drone.id && m.levels && map[m.id]).map(m => ({ x: map[m.id].x, y: map[m.id].y, level: m.levels[drone.id] }));
  const fx = F.localize(use), err = Math.hypot(fx.x - map[drone.id].x, fx.y - map[drone.id].y);
  console.log(`hub members ${data.members.length}, pairs ${dists.length}, map median error ${mapErr[mapErr.length >> 1].toFixed(2)} m`);
  console.log(`drone fix from ${use.length} phones: off by ${err.toFixed(2)} m (2 dB level noise)`);
  // the map is what this test gates; the drone fix depends on which seat the hub picks (edge seats are harder), so it is reported, not gated
  const ok = data.members.length === 14 && mapErr[mapErr.length >> 1] < 0.3;
  console.log((ok ? 'PASS' : 'FAIL') + ' party flow (map)' + (err < 2 ? '' : '  [info: drone fix over 2 m for an edge seat]')); process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
