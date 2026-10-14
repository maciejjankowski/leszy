<?php
// Audience demo hub ("drone party"): phones join, beep in turn to map the room,
// then random phones become drones and everyone else listens.
// One JSON state row + one row per phone. Every response ends with exit (Site Notes append).
header('Content-Type: application/json');
header('Cache-Control: no-store');
$dir = __DIR__ . '/data';
if (!is_dir($dir)) mkdir($dir, 0775, true);
$room = substr(preg_replace('/[^a-z0-9]/', '', strtolower($_GET['room'] ?? '')), 0, 16); // separate rooms (e.g. "test") never mix with the live demo
$db = new PDO('sqlite:' . $dir . '/party' . ($room !== '' ? '-' . $room : '') . '.sqlite');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;');
$db->exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)');
$db->exec('CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, name TEXT, role TEXT, joined REAL, seen REAL, round INTEGER DEFAULT -1, heard TEXT, levels TEXT, lt REAL)');
try { $db->exec('ALTER TABLE members ADD COLUMN heading REAL'); } catch (Exception $e) {}
try { $db->exec('ALTER TABLE members ADD COLUMN snr TEXT'); } catch (Exception $e) {}
try { $db->exec('ALTER TABLE members ADD COLUMN lvl TEXT'); } catch (Exception $e) {} // how loud each beep arrived (dB) // how clearly each beep was heard // compass heading, degrees

function out($a) { echo json_encode($a); exit; }
function body() { return json_decode(file_get_contents('php://input'), true) ?: []; }
function cleanId($s) { return substr(preg_replace('/[^A-Za-z0-9_-]/', '', (string)$s), 0, 32); }
function party($db) {
  $v = $db->query("SELECT v FROM kv WHERE k='party'")->fetchColumn();
  return $v ? json_decode($v, true) : ['phase' => 'lobby', 'round' => 0, 'order' => [], 'drones' => []];
}
// median compass heading of the room = where the phones point = the stage direction (circular median by search)
function stageHeading($db, $now) {
  $q = $db->prepare('SELECT heading FROM members WHERE heading IS NOT NULL AND seen > ?'); $q->execute([$now - 30]);
  $h = array_map('floatval', $q->fetchAll(PDO::FETCH_COLUMN)); if (count($h) < 2) return null;
  $best = null; $bestCost = INF;
  foreach ($h as $c) { $cost = 0; foreach ($h as $x) $cost += abs(fmod($x - $c + 540, 360) - 180); if ($cost < $bestCost) { $bestCost = $cost; $best = $c; } }
  return $best;
}
function save($db, $p) { $db->prepare("INSERT INTO kv (k, v) VALUES ('party', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v")->execute([json_encode($p)]); }

$now = microtime(true);
$a = $_GET['a'] ?? 'state';

if ($a === 'time') out(['t' => $now * 1000]);

if ($a === 'join') {
  $b = body(); $id = cleanId($b['id'] ?? '');
  if ($id === '') out(['error' => 'id']);
  $role = in_array($b['role'] ?? '', ['L', 'R'], true) ? $b['role'] : 'audience';
  $db->prepare('INSERT INTO members (id, name, role, joined, seen) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, seen = excluded.seen')
     ->execute([$id, mb_substr(trim($b['name'] ?? ''), 0, 24) ?: $id, $role, $now, $now]);
  out(['ok' => 1]);
}

if ($a === 'state') { // every phone polls this about once a second
  $id = cleanId($_GET['id'] ?? '');
  if ($id !== '') $db->prepare('UPDATE members SET seen = ? WHERE id = ?')->execute([$now, $id]);
  out(['t' => $now * 1000, 'party' => party($db), 'stage' => stageHeading($db, $now)]);
}

if ($a === 'pose') { // the phone's compass heading (top edge direction)
  $b = body(); $id = cleanId($b['id'] ?? ''); $h = isset($b['heading']) ? fmod((float)$b['heading'] + 360, 360) : null;
  $db->prepare('UPDATE members SET heading = ?, seen = ? WHERE id = ?')->execute([$h, $now, $id]);
  out(['ok' => 1]);
}

if ($a === 'heard') { // arrival times of every beep, on the phone's own audio clock
  $b = body(); $id = cleanId($b['id'] ?? '');
  $db->prepare('UPDATE members SET heard = ?, snr = ?, lvl = ?, round = ?, seen = ? WHERE id = ?')
     ->execute([json_encode($b['heard'] ?? new stdClass), json_encode($b['snr'] ?? new stdClass), json_encode($b['lvl'] ?? new stdClass), (int)($b['round'] ?? -1), $now, $id]);
  out(['ok' => 1]);
}

if ($a === 'levels') { // how loud this phone hears each drone's known pitch
  $b = body(); $id = cleanId($b['id'] ?? '');
  $db->prepare('UPDATE members SET levels = ?, lt = ?, seen = ? WHERE id = ?')->execute([json_encode($b['levels'] ?? new stdClass), $now, $now, $id]);
  out(['ok' => 1]);
}

if ($a === 'data') { // the stage screen reads everything
  $rows = $db->prepare('SELECT * FROM members WHERE seen > ? ORDER BY joined');
  $rows->execute([$now - 120]);
  $m = array_map(fn($r) => ['id' => $r['id'], 'name' => $r['name'], 'role' => $r['role'], 'age' => round($now - $r['seen'], 1),
    'round' => (int)$r['round'], 'heard' => json_decode($r['heard'] ?? 'null', true), 'levels' => json_decode($r['levels'] ?? 'null', true),
    'lage' => $r['lt'] ? round($now - $r['lt'], 1) : null, 'heading' => $r['heading'] === null ? null : (float)$r['heading'], 'snr' => json_decode($r['snr'] ?? 'null', true), 'lvl' => json_decode($r['lvl'] ?? 'null', true)], $rows->fetchAll(PDO::FETCH_ASSOC));
  out(['t' => $now * 1000, 'party' => party($db), 'members' => $m, 'stage' => stageHeading($db, $now)]);
}

if ($a === 'admin') { // stage screen controls
  $b = body(); $p = party($db); $cmd = $b['cmd'] ?? '';
  $live = $db->prepare('SELECT id, name FROM members WHERE seen > ? ORDER BY joined'); $live->execute([$now - 10]);
  $names = $live->fetchAll(PDO::FETCH_KEY_PAIR); $ids = array_keys($names); // names travel with the round, so phones can say whom they heard
  if ($cmd === 'rollcall') { // everyone beeps once, 0.5 s apart, starting 4 s from now
    $p = ['phase' => 'rollcall', 'round' => ($p['round'] ?? 0) + 1, 't0' => ($now + 4) * 1000, 'slot' => max(0.3, min(3, (float)($b['slot'] ?? 0.5))), 'order' => $ids, 'names' => $names, 'band' => ['mid' => [2000, 6000], 'quiet' => [14000, 18000]][$b['band'] ?? ''] ?? [8000, 12000], 'drones' => []];
  } elseif ($cmd === 'drones') { // k random audience phones become drones, each with its own rotor pitch
    $pool = $db->prepare("SELECT id FROM members WHERE seen > ? AND role = 'audience'"); $pool->execute([$now - 10]);
    $cand = $pool->fetchAll(PDO::FETCH_COLUMN); shuffle($cand);
    $f0s = [310, 437, 523, 601, 389]; $k = max(1, min((int)($b['k'] ?? 1), count($f0s), count($cand)));
    $p['phase'] = 'drones'; $p['drones'] = [];
    foreach (array_slice($cand, 0, $k) as $i => $id) $p['drones'][] = ['id' => $id, 'f0' => $f0s[$i]];
    $p['td'] = $now * 1000;
  } elseif ($cmd === 'land') { $p['phase'] = 'mapped'; $p['drones'] = []; }
  elseif ($cmd === 'reset') { $db->exec('DELETE FROM members'); $p = ['phase' => 'lobby', 'round' => 0, 'order' => [], 'drones' => []]; }
  save($db, $p);
  out(['ok' => 1, 'party' => $p]);
}
out(['error' => 'unknown action']);
