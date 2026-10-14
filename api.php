<?php
// Drone radar hub: phones POST readings, the radar GETs the latest state.
// SQLite in ./data (kept out of rsync by demo_publish). Every response ends with exit,
// so the host's auto_append_file (Site Notes) never lands inside the JSON.
header('Content-Type: application/json');
header('Cache-Control: no-store');
$dir = __DIR__ . '/data';
if (!is_dir($dir)) mkdir($dir, 0775, true);
$db = new PDO('sqlite:' . $dir . '/radar.sqlite');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2000;');
$db->exec('CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, name TEXT, x REAL, y REAL, placed INTEGER DEFAULT 0,
  gain REAL DEFAULT 0, det INTEGER, score REAL, f0 REAL, level REAL, warming INTEGER, seen REAL)');
$db->exec('CREATE TABLE IF NOT EXISTS log (t REAL, id TEXT, det INTEGER, score REAL, f0 REAL, level REAL)');

function out($a) { echo json_encode($a); exit; }
function body() { return json_decode(file_get_contents('php://input'), true) ?: []; }
$now = microtime(true);
$a = $_GET['a'] ?? 'state';

if ($a === 'report') {
  $b = body();
  $id = substr(preg_replace('/[^A-Za-z0-9_-]/', '', $b['id'] ?? ''), 0, 32);
  if ($id === '') out(['error' => 'id']);
  $name = mb_substr(trim($b['name'] ?? $id), 0, 24);
  $v = [':id' => $id, ':name' => $name, ':det' => !empty($b['det']) ? 1 : 0, ':score' => (float)($b['score'] ?? 0),
        ':f0' => (float)($b['f0'] ?? 0), ':level' => (float)($b['level'] ?? -140), ':w' => !empty($b['warming']) ? 1 : 0, ':seen' => $now];
  $db->prepare('INSERT INTO nodes (id,name,det,score,f0,level,warming,seen) VALUES (:id,:name,:det,:score,:f0,:level,:w,:seen)
    ON CONFLICT(id) DO UPDATE SET name=:name, det=:det, score=:score, f0=:f0, level=:level, warming=:w, seen=:seen')->execute($v);
  $db->prepare('INSERT INTO log VALUES (?,?,?,?,?,?)')->execute([$now, $id, $v[':det'], $v[':score'], $v[':f0'], $v[':level']]);
  $n = $db->query('SELECT placed, gain FROM nodes WHERE id=' . $db->quote($id))->fetch(PDO::FETCH_ASSOC);
  out(['ok' => 1, 'placed' => (int)$n['placed'], 'gain' => (float)$n['gain']]);
}
if ($a === 'place') { // radar drags a phone to where it really sits in the room (metres)
  $b = body();
  $db->prepare('UPDATE nodes SET x=?, y=?, placed=1 WHERE id=?')->execute([(float)$b['x'], (float)$b['y'], $b['id'] ?? '']);
  out(['ok' => 1]);
}
if ($a === 'gains') { // {id: dB, ...} from the radar's calibrate button
  $st = $db->prepare('UPDATE nodes SET gain=? WHERE id=?');
  foreach (body() as $id => $g) $st->execute([(float)$g, $id]);
  out(['ok' => 1]);
}
if ($a === 'forget') { $db->prepare('DELETE FROM nodes WHERE id=?')->execute([body()['id'] ?? '']); out(['ok' => 1]); }
if ($a === 'reset') { $db->exec('DELETE FROM nodes; DELETE FROM log;'); out(['ok' => 1]); }
if ($a === 'export') { // CSV of every reading, for a post-demo look
  header('Content-Type: text/csv'); header('Content-Disposition: attachment; filename="drone-radar-log.csv"');
  echo "t,id,det,score,f0,level\n";
  foreach ($db->query('SELECT * FROM log ORDER BY t') as $r) echo implode(',', [$r['t'], $r['id'], $r['det'], $r['score'], $r['f0'], $r['level']]) . "\n";
  exit;
}
// state: every phone seen in the last 60 s
$db->prepare('DELETE FROM log WHERE t < ?')->execute([$now - 3600]);
$st = $db->prepare('SELECT * FROM nodes WHERE seen > ? ORDER BY name');
$st->execute([$now - 60]);
$nodes = [];
foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
  $nodes[] = ['id' => $r['id'], 'name' => $r['name'], 'x' => $r['x'] === null ? null : (float)$r['x'], 'y' => $r['y'] === null ? null : (float)$r['y'],
    'placed' => (int)$r['placed'], 'gain' => (float)$r['gain'], 'det' => (int)$r['det'], 'score' => (float)$r['score'], 'f0' => (float)$r['f0'],
    'level' => (float)$r['level'], 'warming' => (int)$r['warming'], 'age' => round($now - $r['seen'], 2)];
}
out(['t' => $now, 'nodes' => $nodes]);
