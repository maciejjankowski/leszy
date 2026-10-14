<?php
// Web app manifest for the audience page. When this demo is published with --pin-qr, the start
// address carries the demo's own join PIN, so an app added to the Home Screen opens unlocked
// (iOS gives Home Screen apps their own cookie jar). Ends with exit (Site Notes append).
header('Content-Type: application/manifest+json');
header('Cache-Control: no-store');
$pin = '';
$room = substr(preg_replace('/[^a-z0-9]/', '', strtolower($_GET['room'] ?? '')), 0, 16);
if (is_file(__DIR__ . '/pin.config.php')) { $cfg = require __DIR__ . '/pin.config.php'; $pin = $cfg['qr_pin'] ?? ''; }
echo json_encode([
  'name' => 'Wielki Leszy', 'short_name' => 'Leszy',
  'start_url' => 'party.html?' . http_build_query(array_filter(['room' => $room, 'pin' => $pin])), // the installed app joins the room it was installed from
  'scope' => './', 'display' => 'standalone', 'background_color' => '#04100a', 'theme_color' => '#04100a',
  'icons' => [['src' => 'icon-192.png', 'sizes' => '192x192', 'type' => 'image/png'], ['src' => 'icon-512.png', 'sizes' => '512x512', 'type' => 'image/png']],
], JSON_UNESCAPED_SLASHES);
exit;
