// node tests/guide.test.cjs
// 1. SSOT: ssot.json is built from the YAML, every key used by the pages and flow.yaml exists, flow names have implementations.
// 2. The real inline script of check.html runs against a mock hub: each guide state shows its buttons, Detekcja dronów works
//    from every state (also while a measurement runs), a running measurement can be cancelled.
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert/strict');
const root = path.join(__dirname, '..'), app = path.join(root, 'app') + '/';
const tests = []; const test = (name, fn) => tests.push([name, fn]);
const { build, problems, parseYaml } = require('../tools/build_ssot.js');
const Guide = require('../guide.js');

// ---------- part 1: SSOT files
test('ssot.json is up to date with the YAML', () => {
  assert.equal(fs.readFileSync(app + 'ssot/ssot.json', 'utf8'), JSON.stringify(build(), null, 1) + '\n');
});
test('every ui key used by check.html, party.html, meter.js and flow.yaml exists', () => {
  assert.deepEqual(problems(build()), []);
});
test('dynamic platform keys exist (install, ringer for ios, android, other)', () => {
  const ui = build().ui.party.steps;
  for (const p of ['ios', 'android', 'other']) { assert.equal(typeof ui.install[p], 'string'); assert.equal(typeof ui.ringer[p], 'string'); }
});
test('flow.yaml only names predicates and actions that guide.js implements', () => {
  const flow = build().flow, acts = new Set(Guide.ACTIONS), preds = new Set(Guide.PRED), used = [];
  const walk = o => { for (const [k, v] of Object.entries(o)) {
    if (k === 'entry' || k === 'enabled') used.push(['pred', v]);
    else if (k === 'id') used.push(['act', v]);
    else if (k === 'exit') for (const x of v) used.push(['exit', x]);
    else if (v && typeof v === 'object') walk(v); } };
  walk(flow.states);
  for (const [kind, name] of used) {
    if (kind === 'pred') assert.ok(preds.has(name), 'predicate ' + name);
    else if (kind === 'act') assert.ok(acts.has(name), 'action ' + name);
    else assert.ok(preds.has(name) || acts.has(name) || ['queue_empty'].includes(name), 'exit ' + name);
  }
});
test('every state can reach detection and every busy state can be cancelled', () => {
  const flow = build().flow;
  for (const [id, st] of Object.entries(flow.states)) {
    if (id === 'detect') continue;
    assert.ok(st.secondary.some(a => a.id === 'detect'), id + ' has detect');
    assert.ok(st.secondary.some(a => a.id.startsWith('back_')), id + ' has a way back');
    if (st.busy) { assert.ok(st.busy.secondary.some(a => a.id === 'detect'), id + ' busy has detect'); assert.ok(st.busy.secondary.some(a => a.id === 'cancel_run'), id + ' busy can be cancelled'); }
  }
});
test('band ranges in params.yaml equal the ones in party.php', () => {
  const php = fs.readFileSync(app + 'party.php', 'utf8'), b = build().params.bands;
  assert.ok(php.includes('[2000, 6000]') && php.includes('[14000, 18000]') && php.includes('[8000, 12000]'));
  assert.deepEqual([b.mid, b.quiet, b.high], [[2000, 6000], [14000, 18000], [8000, 12000]]);
});
test('YAML reader handles the subset it claims to', () => {
  const y = parseYaml('a: 1\nb:\n  - x\n  - k: "v: w"\n    z: [1, 2]\nc: { p: q, r: "s" } # note\nd:\n  e: null\n');
  assert.deepEqual(y, { a: 1, b: ['x', { k: 'v: w', z: [1, 2] }], c: { p: 'q', r: 's' }, d: { e: null } });
});
test('Polish plural forms', () => {
  const ctx = vm.createContext({ fetch: () => new Promise(() => {}), document: {}, console }); vm.runInContext(fs.readFileSync(app + 'ssot.js', 'utf8'), ctx);
  vm.runInContext("SSOT.ui = { x: '{n} {n|runda|rundy|rund}' }", ctx);
  const f = n => vm.runInContext("SSOT.t('x', { n: " + n + " })", ctx);
  assert.deepEqual([1, 2, 5, 12, 22, 25].map(f), ['1 runda', '2 rundy', '5 rund', '12 rund', '22 rundy', '25 rund']);
});

test('no Polish text is left in the pages or scripts (strings live in ssot/ui.yaml)', () => {
  for (const f of ['check.html', 'party.html', 'meter.js', 'guide.js', 'ssot.js']) assert.doesNotMatch(fs.readFileSync(app + f, 'utf8'), /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/, f);
});
test('no em dash in the SSOT files', () => {
  for (const f of ['ui.yaml', 'flow.yaml', 'params.yaml']) assert.ok(!fs.readFileSync(app + 'ssot/' + f, 'utf8').includes('\u2014'), f);
});
test('party.html loads, renders its static text from the SSOT and keeps its script tags', async () => {
  const els = new Map(), q = s => { if (!els.has(s)) els.set(s, { style: {}, classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, value: '', textContent: '', innerHTML: '', addEventListener() {} }); return els.get(s); };
  const sb = { console, Math, Date, JSON, URLSearchParams, Float32Array, Promise, Array, Object, Number, String, Set, Map, isFinite,
    document: { querySelector: q, querySelectorAll: () => [], addEventListener() {}, hidden: false, body: {} },
    localStorage: { getItem: () => null, setItem() {} }, location: { href: 'http://x/party.html?room=test', search: '?room=test' }, matchMedia: () => ({ matches: false }),
    navigator: { userAgent: 'Mozilla/5.0 (iPhone)', platform: 'iPhone', maxTouchPoints: 5 }, performance: { now: () => 0 }, isSecureContext: true,
    setInterval() { return 1; }, setTimeout() { return 1; }, addEventListener() {}, requestAnimationFrame() {},
    fetch: u => Promise.resolve({ ok: true, json: async () => String(u).includes('ssot.json') ? JSON.parse(fs.readFileSync(app + 'ssot/ssot.json', 'utf8')) : {} }) };
  sb.window = sb; sb.globalThis = sb; const ctx = vm.createContext(sb);
  vm.runInContext(fs.readFileSync(app + 'ssot.js', 'utf8'), ctx);
  for (const f of ['ranging.js', 'detector.js']) vm.runInContext(fs.readFileSync(app + f, 'utf8'), ctx);
  const html = fs.readFileSync(app + 'party.html', 'utf8');
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(m[1], ctx);
  await sb.SSOT.ready; await new Promise(r => setImmediate(r));
  assert.equal(q('#h1').textContent, 'Wielki Leszy - dołącz');
  assert.match(q('#stInstall').textContent, /Udostępnij/);
  assert.match(q('#stFlat').innerHTML + q('#stFlat').textContent, /gdzie ma stać/);
  assert.match(html, /<script src="detector.js\?v=2"><\/script>/); assert.match(html, /<script src="meter.js\?v=2"><\/script>/);
});

// ---------- part 2: check.html against a mock hub
function el() {
  const e = { children: [], options: [], style: {}, dataset: {}, hidden: false, disabled: false, value: '', _text: '', innerHTML: '', onclick: null, handlers: {},
    classList: { add() {}, remove() {}, toggle() {} }, clientWidth: 400, clientHeight: 400,
    addEventListener(t, fn) { e.handlers[t] = fn; }, appendChild(c) { e.children.push(c); e.options.push(c); return c; }, remove() {}, getContext() { return {}; } };
  Object.defineProperty(e, 'textContent', { get() { return e._text; }, set(v) { e._text = v; if (v === '') { e.children.length = 0; e.options.length = 0; } } });
  return e;
}
function checkPage() {
  const els = new Map(), timers = [], intervals = [], hubCalls = [], store = new Map();
  const q = s => { if (!els.has(s)) els.set(s, el()); return els.get(s); };
  const state = { members: [], party: { phase: 'lobby', round: 0, order: [], names: {} }, hold: null };
  const sandbox = { console, Math, Date, JSON, Number, String, Array, Object, Set, Map, Promise, parseFloat, isFinite, Float32Array, URLSearchParams,
    document: { querySelector: q, querySelectorAll: () => [], createElement: () => el(), addEventListener() {}, hidden: false, body: el() },
    Option: function (text, value) { return { text, value, textContent: text }; },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) },
    location: { href: 'http://x/check.html?room=test', search: '' }, innerWidth: 1000, devicePixelRatio: 1,
    requestAnimationFrame() {}, setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; }, clearInterval() {},
    setTimeout(fn, ms) { const id = timers.push({ fn, ms }); Promise.resolve().then(fn); return id; }, clearTimeout() {},
    fetch(url, opt = {}) {
      url = String(url);
      const json = o => Promise.resolve({ ok: true, json: async () => o });
      if (url.includes('ssot.json')) return json(JSON.parse(fs.readFileSync(app + 'ssot/ssot.json', 'utf8')));
      if (url.includes('pin.php')) return json({ pin: '' });
      const a = /a=([a-z]+)/.exec(url)[1], body = opt.body ? JSON.parse(opt.body) : null; hubCalls.push({ a, body });
      if (a === 'data') return json({ t: 1e6, party: state.party, members: state.members, stage: null });
      if (a === 'admin') return state.hold ? state.hold.then(() => json({ ok: 1, party: state.party })) : json({ ok: 1, party: state.party });
      return json({ ok: 1 });
    } };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(app + 'ssot.js', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(app + 'guide.js', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(app + 'ranging.js', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(app + 'fusion.js', 'utf8'), ctx);
  const html = fs.readFileSync(app + 'check.html', 'utf8'), scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.equal(scripts.length, 1);
  const page = { q, state, hubCalls, store, ctx,
    phones(n, extra = {}) { state.members = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'Tel' + i, role: 'audience', age: 1, joined: 100 + i, round: 0, heard: null, snr: null, lvl: null, lat: null, det: null, prev: null, ...extra })); },
    async poll() { for (const i of intervals) if (i.ms === 1000) { await i.fn(); break; } await new Promise(r => setImmediate(r)); },
    gm: () => q('#gMore').children, btn: act => q('#gMore').children.find(b => b.dataset.act === act),
    acts: () => q('#gMore').children.map(b => b.dataset.act),
    flush: () => new Promise(r => setImmediate(r)),
    async ready() { vm.runInContext(scripts[0], ctx); await sandbox.SSOT.ready; await page.flush(); } };
  return page;
}
const uncalibrate = p => { p.store.set('dp_pileoff', '{}'); p.store.set('dp_touch', '{}'); };

test('join: waiting for phones shows no dead button, but Detekcja dronów, Pomiń, Wróć', async () => {
  const p = checkPage(); p.phones(1); await p.ready(); await p.poll();
  assert.match(p.q('#gStep').textContent, /KROK 1 z 3/);
  assert.equal(p.q('#gTitle').textContent, 'Dołącz telefony');
  assert.match(p.q('#gStat').textContent, /1 z 3/);
  assert.equal(p.q('#gBtn').hidden, true);
  assert.deepEqual(p.acts(), ['detect', 'skip_join', 'back_home']);
  assert.equal(p.btn('detect').textContent, 'Detekcja dronów');
});
test('join: Pomiń czekanie moves on with two phones', async () => {
  const p = checkPage(); p.phones(2); await p.ready(); await p.poll();
  assert.equal(p.q('#gTitle').textContent, 'Dołącz telefony');
  p.btn('skip_join').onclick(); await p.flush();
  assert.match(p.q('#gStep').textContent, /KROK 2 z 3/);
  assert.match(p.q('#gTitle').textContent, /Weź Tel1 i połóż tuż przy Tel0/);
});
test('touch-calibrate: primary Zmierz, Detekcja dronów works (the old trap), and Wróć returns', async () => {
  const p = checkPage(); p.phones(3); await p.ready(); await p.poll();
  assert.match(p.q('#gStep').textContent, /KROK 2 z 3/);
  assert.equal(p.q('#gBtn').textContent, 'Zmierz Tel1 (2 rundy)'); assert.equal(p.btn('skip_phone').textContent, 'Pomiń Tel1');
  assert.deepEqual(p.acts(), ['detect', 'skip_phone', 'skip_all', 'back_to_join']);
  p.btn('detect').onclick(); await p.flush();
  assert.equal(p.q('#gStep').textContent, 'TRYB: DETEKCJA'); assert.equal(p.store.get('dp_mode'), 'detect');
  assert.deepEqual(p.acts(), ['back_to_calibration']);
  p.btn('back_to_calibration').onclick(); await p.flush();
  assert.match(p.q('#gStep').textContent, /KROK 2 z 3/); assert.equal(p.store.get('dp_mode'), '');
});
test('touch-calibrate: Pomiń ten telefon does not bring the phone back; Pomiń kalibrację goes to measure', async () => {
  const p = checkPage(); p.phones(3); await p.ready(); await p.poll();
  p.btn('skip_phone').onclick(); await p.flush();
  assert.match(p.q('#gTitle').textContent, /Weź Tel2/);
  p.btn('skip_phone').onclick(); await p.flush(); await p.poll();
  assert.match(p.q('#gStep').textContent, /KROK 3 z 3/);
});
test('touch-calibrate: Wróć goes to join, Dalej continues', async () => {
  const p = checkPage(); p.phones(3); await p.ready(); await p.poll();
  p.btn('back_to_join').onclick(); await p.flush();
  assert.equal(p.q('#gTitle').textContent, 'Dołącz telefony'); assert.equal(p.q('#gBtn').hidden, false); assert.equal(p.q('#gBtn').textContent, 'Dalej');
  p.q('#gBtn').onclick(); await p.flush();
  assert.match(p.q('#gStep').textContent, /KROK 2 z 3/);
});
test('measure: Mierz odległości (5 rund), Detekcja dronów, Wróć; Wróć re-opens the touch queue', async () => {
  const p = checkPage(); p.phones(3); await p.ready(); await p.poll(); p.btn('skip_all').onclick(); await p.flush();
  assert.match(p.q('#gStep').textContent, /KROK 3 z 3/); assert.equal(p.q('#gBtn').textContent, 'Mierz odległości (5 rund)');
  assert.deepEqual(p.acts(), ['detect', 'back_to_touch']);
  p.btn('back_to_touch').onclick(); await p.flush();
  assert.match(p.q('#gTitle').textContent, /Weź Tel1 i połóż tuż przy Tel0/);
});
test('a running measurement shows Przerwij and Detekcja dronów; Przerwij stops it', async () => {
  const p = checkPage(); p.phones(3); await p.ready(); await p.poll(); p.btn('skip_all').onclick(); await p.flush();
  let release; p.state.hold = new Promise(r => { release = r; });
  const run = p.q('#gBtn').onclick(); await p.flush();
  assert.equal(p.q('#gTitle').textContent, 'Mierzę'); assert.deepEqual(p.acts(), ['detect', 'cancel_run']); assert.equal(p.q('#gBtn').hidden, true);
  p.btn('cancel_run').onclick(); await p.flush();
  assert.equal(p.q('#gTitle').textContent, 'Rozstaw telefony i zmierz');
  const sent = p.hubCalls.filter(c => c.a === 'admin').length; p.state.hold = null; release(); await run; await p.flush();
  assert.equal(p.hubCalls.filter(c => c.a === 'admin').length, sent, 'no further rounds after Przerwij');
});
test('Detekcja dronów also works while a measurement runs', async () => {
  const p = checkPage(); p.phones(3); await p.ready(); await p.poll(); p.btn('skip_all').onclick(); await p.flush();
  let release; p.state.hold = new Promise(r => { release = r; });
  const run = p.q('#gBtn').onclick(); await p.flush();
  p.btn('detect').onclick(); await p.flush();
  assert.equal(p.q('#gStep').textContent, 'TRYB: DETEKCJA');
  const sent = p.hubCalls.filter(c => c.a === 'admin').length; p.state.hold = null; release(); await run; await p.flush();
  assert.equal(p.hubCalls.filter(c => c.a === 'admin').length, sent);
});
test('a phone that reloaded (lost its calibration) cannot trap the guide: detection is one press away', async () => {
  const p = checkPage(); p.phones(3);
  p.store.set('dp_touch', JSON.stringify({ p1: { walker: 'p0', raw: 0.5, round: 2, t: 1 }, p2: { walker: 'p0', raw: 0.5, round: 2, t: 1 } }));
  await p.ready(); await p.poll();
  assert.match(p.q('#gStep').textContent, /KROK 3 z 3/);
  p.state.members[1].joined = 999; await p.poll(); await p.poll(); // p1 rejoined: its calibration expires
  assert.match(p.q('#gStep').textContent, /KROK 2 z 3/);
  assert.ok(p.btn('detect')); p.btn('detect').onclick(); await p.flush();
  assert.equal(p.q('#gStep').textContent, 'TRYB: DETEKCJA');
});
test('detection mode shows DRON when phones hear a rotor', async () => {
  const p = checkPage(); p.phones(3); p.store.set('dp_mode', 'detect'); await p.ready();
  for (const m of p.state.members) m.det = { t: 1e6 / 1000, det: true, f0: 430, level: -40 };
  await p.poll();
  assert.equal(p.q('#gTitle').textContent, 'DRON'); assert.match(p.q('#gText').textContent, /^DRON · słyszy: /);
});
test('network failure is shown in the strip, not hidden in a closed panel', async () => {
  const p = checkPage(); p.phones(1); await p.ready(); await p.poll();
  const orig = p.ctx.fetch; p.ctx.fetch = () => Promise.reject(new Error('x')); await p.poll();
  assert.equal(p.q('#net').textContent, 'Brak połączenia z serwerem');
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) { try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e.stack || e.message).split('\n').slice(0, 4).join(' | ')); } }
  console.log(`${tests.length - failed}/${tests.length} passed`); process.exitCode = failed ? 1 : 0;
})();
