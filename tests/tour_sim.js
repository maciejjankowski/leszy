// node tests/tour_sim.js [hub]  - four real-device names, a touch tour: the walker (iPhone 13) visits each device.
// Devices differ: iPad speaker +6 dB, MacBook mic +3 dB, iPhone 7 speaker -2 dB; each has a 5 cm speaker-mic gap.
const R = require('../ranging.js');
const HUB = process.argv[2] || 'http://localhost:18080/drone-ear/party.php?room=test';
const q = a => HUB + (HUB.includes('?') ? '&' : '?') + 'a=' + a;
const post = (a, b) => fetch(q(a), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
let seed = 9; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const dev = [
  { id: 'ip13', name: 'iPhone 13', x: 0, y: 0, spk: 0, mic: 0 },
  { id: 'ip7', name: 'iPhone 7', x: 3, y: 0, spk: -2, mic: 0 },
  { id: 'ipad', name: 'iPad Pro', x: 3, y: 2.5, spk: 6, mic: 0 },
  { id: 'mac', name: 'MacBook', x: 0, y: 2.5, spk: 0, mic: 3 },
];
if (process.env.MOVE) { const [id, dx, dy] = process.env.MOVE.split(','); const d = dev.find(x => x.id === id); d.x += +dx; d.y += +dy; }
const clock = dev.map(() => rnd() * 40), lat = dev.map(() => 0.02 + rnd() * 0.1);
async function round(opts, pos) {
  const rc = await post('admin', opts), p = rc.party, order = p.order;
  for (let i = 0; i < dev.length; i++) {
    const heard = {}, lvl = {};
    order.forEach((src, k) => {
      const j = dev.findIndex(d => d.id === src), d = Math.hypot(pos[i].x - pos[j].x, pos[i].y - pos[j].y) + 0.05 + (i === j ? 0.05 : 0);
      heard[src] = clock[i] + k * p.slot + lat[j] + d / R.C + (rnd() - 0.5) * 0.0002 + (rnd() - 0.5) * (+(process.env.NOISE || 0)) / R.C;
      lvl[src] = +(-20 - 20 * Math.log10(Math.max(d, 0.1)) + dev[j].spk + dev[i].mic + (i === j ? 10 : 0)).toFixed(1);
    });
    await post('heard', { id: dev[i].id, round: p.round, heard, lvl });
  }
  return p.round;
}
(async () => {
  const mode = process.argv[3] || 'all';
  if (mode === 'all' || mode === 'setup') {
    await post('admin', { cmd: 'reset' });
    for (const d of dev) await post('join', { id: d.id, name: d.name });
    console.log('round', await round({ cmd: 'rollcall' }, dev), 'full');
  }
  if (mode === 'all' || mode === 'touch') {
    for (const target of ['ip7', 'ipad', 'mac']) { // the walker goes to each device and touches it
      const t = dev.find(d => d.id === target), pos = dev.map(d => d.id === 'ip13' ? { x: t.x + 0.02, y: t.y } : d);
      console.log('round', await round({ cmd: 'rollcall', walker: 'ip13', slot: 0.25 }, pos), 'touching', t.name);
      await new Promise(r => setTimeout(r, +(process.env.GAP || 0)));
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
