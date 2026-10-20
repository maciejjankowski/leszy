// Executes the real inline page scripts with controllable browser/network boundaries.
const fs = require('fs'), vm = require('vm'), assert = require('assert/strict');
const app = __dirname + '/../';
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
// static guard: the roll-call beep must be started on a statement of its own (a trailing comment once swallowed s.start)
test('beep start survives the gain-node line', () => {
  const src = fs.readFileSync(app + 'party.html', 'utf8');
  assert.match(src, /\n\s*s\.start\(Math\.max\(when, ctx\.currentTime \+ 0\.02\)\);/);
});
function page(file) {
  const elements = new Map(), intervals = new Map(), timeouts = new Map(), requests = [], contexts = [];
  let serial = 0;
  const el = s => {
    if (!elements.has(s)) elements.set(s, { value: '', checked: false, hidden: false, style: {},
      classList: { add() {}, remove() {} }, handlers: {}, clientWidth: 400, clientHeight: 400,
      addEventListener(type, fn) { this.handlers[type] = fn; }, setPointerCapture() {},
      getContext() { return {}; }, click() { return this.onclick(); } });
    return elements.get(s);
  };
  const audioNode = () => ({ connect() {}, frequency: {}, gain: {} });
  class AudioContext {
    constructor() { this.state = 'suspended'; this.sampleRate = 48000; contexts.push(this); }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createBiquadFilter() { return audioNode(); }
    createAnalyser() { return { frequencyBinCount: 4096 }; }
    createMediaStreamSource() { return audioNode(); }
  }
  const sandbox = { console, Float32Array, URLSearchParams, AbortController,
    document: { querySelector: el, addEventListener() {}, hidden: false }, localStorage: { getItem() { return null; }, setItem() {} },
    location: { href: 'https://demo.test/radar.html', search: '' }, performance: { now: () => 1000 },
    devicePixelRatio: 1, isSecureContext: true, window: { AudioContext },
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }], getAudioTracks: () => [{ getSettings: () => ({ channelCount: 1 }) }] }) },
      wakeLock: { request: async () => ({ release: async () => {} }) } },
    requestAnimationFrame() {},
    setInterval(fn, ms) { const id = ++serial; intervals.set(id, { fn, ms }); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(fn, ms) { const id = ++serial; timeouts.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    fetch(url, options = {}) { return new Promise((resolve, reject) => {
      if (String(url).includes('pin.php')) return resolve({ ok: true, json: async () => ({ pin: '' }) }); // the QR lookup is not a state request
      requests.push({ url, options, resolve, reject });
      options.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }); },
    CombDetector: require('../detector.js').CombDetector,
    Fusion: require('../fusion.js'),
    makeDrone() { return { output: audioNode(), setF0() {}, setGain(v) { this.gain = v; }, stop() {} }; }
  };
  const ctx = vm.createContext(sandbox);
  for (const m of fs.readFileSync(app + file, 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(m[1], ctx);
  return { ...sandbox, el, ctx, contexts, requests, intervals, timeouts, run: code => vm.runInContext(code, ctx) };
}
test('double Start leaves one audio context and Stop clears all loops', async () => {
  const p = page('sensor.html');
  await Promise.all([p.el('#go').onclick(), p.el('#go').onclick()]);
  assert.equal(p.contexts.length, 1);
  p.el('#stop').onclick(); assert.equal(p.intervals.size, 0);
});
test('denied microphone releases audio context and can retry', async () => {
  const p = page('sensor.html');
  p.navigator.mediaDevices.getUserMedia = async () => { throw new Error('denied'); };
  await p.el('#go').onclick(); assert.equal(p.contexts[0].state, 'closed');
  p.navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [], getAudioTracks: () => [] });
  await p.el('#go').onclick(); assert.equal(p.el('#run').hidden, false);
});
test('Stop cancels self-test onset and clears the previous reading', async () => {
  const p = page('sensor.html'); p.el('#selftest').checked = true;
  await p.el('#go').onclick(); p.run('last = {detected:true}'); p.el('#stop').onclick();
  assert.equal(p.timeouts.size, 0); assert.equal(p.run('last'), null);
});
test('self-test distance doubling is -6.02 dB amplitude change', async () => {
  const p = page('sensor.html'); p.el('#selftest').checked = true; await p.el('#go').onclick();
  p.el('#sg').value = 0; p.run('setFake()'); const a = p.run('fake.gain');
  p.el('#sg').value = 10; p.run('setFake()'); const b = p.run('fake.gain');
  assert.ok(Math.abs(20 * Math.log10(a / b) - 6.0206) < 0.001);
});
test('radar serializes state requests', async () => {
  const p = page('radar.html'); p.run('poll()'); p.run('poll()'); assert.equal(p.requests.length, 1);
});
test('a live reply cannot replace SIM nodes after a mode switch', async () => {
  const p = page('radar.html'); const pending = p.run('poll()'); p.el('#sim').onclick();
  p.requests[0].resolve({ ok: true, json: async () => ({ nodes: [{ id: 'live', age: 0, warming: 1 }] }) });
  await pending; assert.equal(p.run('nodes.some(n => n.id === "live")'), false);
});
test('failed state fetch removes the stale track', async () => {
  const p = page('radar.html'); p.run('track={t:1}; fix={x:1,y:1}');
  const pending = p.run('poll()'); p.requests[0].reject(new Error('offline')); await pending;
  assert.equal(p.run('track'), null); assert.equal(p.run('fix'), null);
});
test('cancelled touch drag does not leave a captured node', () => {
  const p = page('radar.html'); p.run('drag={id:"n1",x:0,y:0}');
  p.el('#cv').handlers.pointercancel?.({pointerId: 1}); assert.equal(p.run('drag'), null);
});
test('SW does not overwrite a cached script with an HTTP error', async () => {
  let handler, puts = 0;
  const c = vm.createContext({ self: { addEventListener(type, fn) { if (type === 'fetch') handler = fn; } },
    caches: { open: async () => ({ put: async () => { puts++; } }), match: async () => 'cached' },
    fetch: async () => ({ ok: false, clone: () => ({}) }) });
  vm.runInContext(fs.readFileSync(app + 'sw.js', 'utf8'), c);
  let response; handler({ request: { method: 'GET', url: 'https://demo.test/detector.js' },
    respondWith(p) { response = p; }, waitUntil() {} });
  await response; await Promise.resolve(); assert.equal(puts, 0);
});
(async () => {
  let failed = 0;
  for (const [name, fn] of tests) { try { await fn(); console.log('PASS ' + name); }
    catch(e) { failed++; console.log('FAIL ' + name + ': ' + e.message); } }
  console.log(`${tests.length - failed}/${tests.length} passed`); process.exitCode = failed ? 1 : 0;
})();
