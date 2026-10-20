// Live graph on the phone: rotor-comb score over the last 30 s (with the alarm line) and the spectrum 0-3 kHz with the comb teeth.
// Hooks the detector itself, so the page needs only this script tag.
(function () {
  if (typeof CombDetector === 'undefined') return;
  const hist = [], orig = CombDetector.prototype.process;
  CombDetector.prototype.process = function (db, t) { const o = orig.call(this, db, t); this.last = o; this.lastDb = db; hist.push({ t, s: o.score > -1e6 ? o.score : 0, d: o.detected, lvl: o.level }); while (hist.length && t - hist[0].t > 30) hist.shift(); draw(this); return o; };
  let cv, g;
  function ensure() {
    if (cv) return true; const box = document.getElementById('runBox'); if (!box || box.hidden) return false;
    cv = document.createElement('canvas'); cv.style.cssText = 'width:100%;height:170px;display:block;background:#fff;border:1px solid var(--line);border-radius:8px;margin-top:10px';
    box.appendChild(cv); g = cv.getContext('2d'); return true;
  }
  let lastDraw = 0;
  function draw(det) {
    if (!ensure() || performance.now() - lastDraw < 120) return; lastDraw = performance.now();
    const dpr = devicePixelRatio || 1, W = cv.width = cv.clientWidth * dpr, H = cv.height = cv.clientHeight * dpr, h1 = H * 0.5;
    g.clearRect(0, 0, W, H); g.font = (11 * dpr) + 'px -apple-system, sans-serif';
    // top: score history, alarm line at the detector threshold
    const th = det.threshold, max = Math.max(th * 2.5, ...hist.map(p => p.s)), y = v => h1 - 4 * dpr - Math.max(0, v) / max * (h1 - 16 * dpr), t1 = hist.length ? hist[hist.length - 1].t : 0;
    g.strokeStyle = 'rgba(198,40,40,.6)'; g.setLineDash([4 * dpr, 4 * dpr]); g.beginPath(); g.moveTo(0, y(th)); g.lineTo(W, y(th)); g.stroke(); g.setLineDash([]);
    g.lineWidth = 2 * dpr; g.beginPath(); hist.forEach((p, i) => { const x = W - (t1 - p.t) / 30 * W; i ? g.lineTo(x, y(p.s)) : g.moveTo(x, y(p.s)); }); g.strokeStyle = '#1f5fb3'; g.stroke(); g.lineWidth = 1;
    for (const p of hist) if (p.d) { const x = W - (t1 - p.t) / 30 * W; g.fillStyle = 'rgba(198,40,40,.18)'; g.fillRect(x - 2 * dpr, 0, 4 * dpr, h1); }
    g.fillStyle = '#6a6a66'; g.fillText('siła grzebienia, 30 s (kreska = próg alarmu)', 4 * dpr, 12 * dpr);
    // bottom: spectrum 0-3 kHz, learned floor, teeth
    const db = det.lastDb, bin = det.binHz, n = Math.floor(3000 / bin), yy = v => H - 4 * dpr - (Math.max(-120, Math.min(-20, v)) + 120) / 100 * (H - h1 - 18 * dpr);
    if (db && det.floor) {
      g.strokeStyle = '#bdbab2'; g.beginPath(); for (let i = 1; i < n; i++) g.lineTo(i / n * W, yy(det.floor[i])); g.stroke();
      g.strokeStyle = '#1f7a3f'; g.beginPath(); for (let i = 1; i < n; i++) g.lineTo(i / n * W, yy(db[i])); g.stroke();
      const o = det.last; if (o && o.f0) { g.strokeStyle = o.detected ? 'rgba(198,40,40,.8)' : 'rgba(168,100,0,.5)'; for (const f of o.teeth) if (f < 3000) { const x = f / 3000 * W; g.beginPath(); g.moveTo(x, h1 + 14 * dpr); g.lineTo(x, H); g.stroke(); } }
      g.fillStyle = '#6a6a66'; g.fillText('widmo 0-3 kHz' + (det.last && det.last.f0 ? ' · najlepszy ton ' + Math.round(det.last.f0) + ' Hz, ' + det.last.level.toFixed(0) + ' dB' : ''), 4 * dpr, h1 + 12 * dpr);
    }
  }
})();
