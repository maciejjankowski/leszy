// one-off patch: touch offsets direct, faster polling in walker mode, hub keeps the previous round
const fs = require('fs'), path = require('path');
const app = path.join(__dirname, '..', 'app');
let s = fs.readFileSync(path.join(app, 'check.html'), 'utf8');
const must = (from, to) => { if (!s.includes(from)) { console.error('MISSING: ' + from.slice(0, 60)); process.exit(1); } s = s.split(from).join(to); };

must(`  for (const [id, t] of Object.entries(touches)) if (t.walker !== id) tapeOk[[t.walker, id].sort().join('|')] = 0.05; // touches = zero-distance pairs
  // the offset fit needs the touch rounds raw distances, which are not in this round: add them as synthetic pairs
  const rawAll = rawD.slice(); for (const [id, t] of Object.entries(touches)) if (!rawAll.some(x => (x.a === t.walker && x.b === id) || (x.b === t.walker && x.a === id))) rawAll.push({ a: t.walker, b: id, raw: t.raw, d: t.raw });`,
`  // touch tour: a device touched by the walker reads raw ~ 0 - offset(walker) - offset(device). With the walker as the zero
  // reference, offset(device) = -raw. Only pair sums matter to the map, so the walker's own gap shifts every device alike.
  const touchOff = {}; for (const [id, t] of Object.entries(touches)) if (t.walker !== id) touchOff[id] = -t.raw;`);
must(`  const fit = Ranging.fitOffsets(rawAll, tapeOk);
  const offset = Object.fromEntries(dIds.map(i => [i, fit.k[i] ?? fit.shared]));`,
`  const fit = Ranging.fitOffsets(rawD, tapeOk);
  const offset = Object.fromEntries(dIds.map(i => [i, touchOff[i] ?? (fit.k[i] ?? fit.shared)])); // touch beats tape beats shared`);
must(`$('#cal').textContent = fit.n ? 'Poprawka z ' + fit.n + ' pomiarów taśmą: '`,
`$('#cal').textContent = (Object.keys(touchOff).length ? 'Z dotyków: ' + Object.entries(touchOff).map(([i, v]) => nm(i) + ' ' + (v * 100).toFixed(0) + ' cm').join(', ') + ' · ' : '') + (fit.n ? 'Poprawka z ' + fit.n + ' pomiarów taśmą: '`);
must(` : 'bez pomiarów taśmą ani stosu';`, ` : 'bez pomiarów taśmą ani stosu');`);
// walker mode: poll 4x a second so a 3 s touch round is never missed
must(`setInterval(poll, 1000); poll(); requestAnimationFrame(frame);`,
`let pollMs = 1000, pollTimer = setInterval(poll, pollMs); poll(); requestAnimationFrame(frame);
setInterval(() => { const want = walker ? 250 : 1000; if (want !== pollMs) { pollMs = want; clearInterval(pollTimer); pollTimer = setInterval(poll, want); } }, 500);`);
fs.writeFileSync(path.join(app, 'check.html'), s);

let h = fs.readFileSync(path.join(app, 'party.php'), 'utf8');
const mustH = (from, to) => { if (!h.includes(from)) { console.error('MISSING php: ' + from.slice(0, 60)); process.exit(1); } h = h.split(from).join(to); };
mustH(`try { $db->exec('ALTER TABLE members ADD COLUMN lvl TEXT'); } catch (Exception $e) {} // how loud each beep arrived (dB)`,
`try { $db->exec('ALTER TABLE members ADD COLUMN lvl TEXT'); } catch (Exception $e) {} // how loud each beep arrived (dB)
try { $db->exec('ALTER TABLE members ADD COLUMN prev TEXT'); } catch (Exception $e) {} // this member's previous round, so a fast walker round is never missed`);
mustH(`  $db->prepare('UPDATE members SET heard = ?, snr = ?, lvl = ?, round = ?, seen = ? WHERE id = ?')
     ->execute([json_encode($b['heard'] ?? new stdClass), json_encode($b['snr'] ?? new stdClass), json_encode($b['lvl'] ?? new stdClass), (int)($b['round'] ?? -1), $now, $id]);`,
`  $old = $db->prepare('SELECT round, heard, lvl FROM members WHERE id = ?'); $old->execute([$id]); $o = $old->fetch(PDO::FETCH_ASSOC);
  $prev = $o && $o['heard'] ? json_encode(['round' => (int)$o['round'], 'heard' => json_decode($o['heard'], true), 'lvl' => json_decode($o['lvl'] ?? 'null', true)]) : null;
  $db->prepare('UPDATE members SET heard = ?, snr = ?, lvl = ?, prev = ?, round = ?, seen = ? WHERE id = ?')
     ->execute([json_encode($b['heard'] ?? new stdClass), json_encode($b['snr'] ?? new stdClass), json_encode($b['lvl'] ?? new stdClass), $prev, (int)($b['round'] ?? -1), $now, $id]);`);
mustH(`'lvl' => json_decode($r['lvl'] ?? 'null', true)]`, `'lvl' => json_decode($r['lvl'] ?? 'null', true), 'prev' => json_decode($r['prev'] ?? 'null', true)]`);
fs.writeFileSync(path.join(app, 'party.php'), h);
console.log('patched');
