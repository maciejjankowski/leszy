// Network first (fresh code during the hackathon), cache as fallback. api.php is never cached.
const C = 'drone-ear-v2';
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(['./', 'sensor.html', 'radar.html', 'emitter.html', 'style.css', 'detector.js', 'fusion.js', 'synth.js', 'manifest.json']))); self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || e.request.url.includes('api.php')) return;
  e.respondWith(fetch(e.request, { cache: 'no-store' }).then(r => {
    if (r.ok) { const copy = r.clone(); e.waitUntil(caches.open(C).then(c => c.put(e.request, copy))); }
    return r;
  }).catch(() => caches.match(e.request)));
});
