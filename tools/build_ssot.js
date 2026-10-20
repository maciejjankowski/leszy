#!/usr/bin/env node
// Builds app/ssot/ssot.json from the editable YAML (params.yaml, ui.yaml, flow.yaml).
//   node tools/build_ssot.js           write app/ssot/ssot.json
//   node tools/build_ssot.js --check   fail if ssot.json is stale or a key used in a page / in flow.yaml does not exist
// The YAML reader below handles the subset these files use: nested maps, lists, "- key: v" items,
// inline [a, b] and { k: v } values, quoted strings, numbers, true/false/null, # comments. No libraries.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), DIR = path.join(ROOT, 'app', 'ssot');

function stripComment(raw) { // cut " # ..." that is outside quotes
  let q = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i], prev = i ? raw[i - 1] : ' ';
    if (q) { if (c === '\\' && q === '"') i++; else if (c === q) q = null; }
    else if ((c === '"' || c === "'") && /[\s\[{,:]/.test(prev)) q = c;
    else if (c === '#' && /\s/.test(prev)) return raw.slice(0, i);
  }
  return raw;
}
function flow(s, i = 0) { // inline [ ] and { } values -> [value, nextIndex]
  const ws = () => { while (/\s/.test(s[i] || '')) i++; };
  ws();
  if (s[i] === '[') {
    const out = []; i++; ws();
    while (s[i] !== ']') { const r = flow(s, i); out.push(r[0]); i = r[1]; ws(); if (s[i] === ',') { i++; ws(); } else if (s[i] !== ']') throw new Error('bad inline list: ' + s); }
    return [out, i + 1];
  }
  if (s[i] === '{') {
    const out = {}; i++; ws();
    while (s[i] !== '}') {
      let k; if (s[i] === '"') { const e = quotedEnd(s, i); k = JSON.parse(s.slice(i, e)); i = e; } else { const st = i; while (s[i] !== ':' && s[i] !== undefined) i++; k = s.slice(st, i).trim(); }
      if (s[i] !== ':') throw new Error('bad inline map: ' + s); i++;
      const r = flow(s, i); out[k] = r[0]; i = r[1]; ws(); if (s[i] === ',') { i++; ws(); } else if (s[i] !== '}') throw new Error('bad inline map: ' + s);
    }
    return [out, i + 1];
  }
  if (s[i] === '"') { const e = quotedEnd(s, i); return [JSON.parse(s.slice(i, e)), e]; }
  if (s[i] === "'") { let j = i + 1; while (!(s[j] === "'" && s[j + 1] !== "'")) j += s[j] === "'" ? 2 : 1; return [s.slice(i + 1, j).replace(/''/g, "'"), j + 1]; }
  const st = i; while (i < s.length && !',]}'.includes(s[i])) i++;
  return [plain(s.slice(st, i).trim()), i];
}
function quotedEnd(s, i) { let j = i + 1; while (s[j] !== '"') { if (s[j] === undefined) throw new Error('unterminated string: ' + s); j += s[j] === '\\' ? 2 : 1; } return j + 1; }
function plain(t) {
  if (t === '' || t === '~' || t === 'null') return null;
  if (t === 'true') return true; if (t === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}
function scalar(t) {
  if (t[0] === '[' || t[0] === '{' || t[0] === '"' || t[0] === "'") { const r = flow(t, 0); if (t.slice(r[1]).trim()) throw new Error('trailing text: ' + t); return r[0]; }
  return plain(t);
}
const KEY = /^("(?:[^"\\]|\\.)*"|[^\s"'\[\]{},#:-][^:]*?|-[^\s:][^:]*?)\s*:(?:\s+(.*))?$/;
function parseYaml(src) {
  const lines = [];
  src.split(/\r?\n/).forEach((raw, n) => {
    const text = stripComment(raw).replace(/\s+$/, '');
    if (!text.trim()) return;
    if (/\t/.test(text.match(/^\s*/)[0])) throw new Error('line ' + (n + 1) + ': tab indentation');
    lines.push({ indent: text.match(/^ */)[0].length, text: text.trim(), n: n + 1 });
  });
  let pos = 0;
  const isItem = l => l.text === '-' || l.text.startsWith('- ');
  const block = () => isItem(lines[pos]) ? list(lines[pos].indent) : map(lines[pos].indent);
  function list(indent) {
    const out = [];
    while (pos < lines.length && lines[pos].indent === indent && isItem(lines[pos])) {
      const l = lines[pos], rest = l.text === '-' ? '' : l.text.slice(2).trim();
      if (!rest) { pos++; out.push(pos < lines.length && lines[pos].indent > indent ? block() : null); }
      else if (KEY.test(rest) && rest[0] !== '[' && rest[0] !== '{' && rest[0] !== '"' || /^"(?:[^"\\]|\\.)*"\s*:(\s|$)/.test(rest)) { lines[pos] = { indent: indent + (l.text.length - rest.length), text: rest, n: l.n }; out.push(map(lines[pos].indent)); }
      else { pos++; out.push(scalar(rest)); }
    }
    return out;
  }
  function map(indent) {
    const out = {};
    while (pos < lines.length && lines[pos].indent === indent && !isItem(lines[pos])) {
      const l = lines[pos], m = KEY.exec(l.text);
      if (!m) throw new Error('line ' + l.n + ': cannot read "' + l.text + '"');
      const key = m[1][0] === '"' ? JSON.parse(m[1]) : m[1].trim(), rest = (m[2] || '').trim();
      if (key in out) throw new Error('line ' + l.n + ': duplicate key ' + key);
      pos++;
      if (rest) out[key] = scalar(rest);
      else if (pos < lines.length && lines[pos].indent > indent) out[key] = block();
      else if (pos < lines.length && lines[pos].indent === indent && isItem(lines[pos])) out[key] = list(indent);
      else out[key] = null;
    }
    if (pos < lines.length && lines[pos].indent > indent) throw new Error('line ' + lines[pos].n + ': unexpected indentation');
    return out;
  }
  if (!lines.length) return {};
  const r = block();
  if (pos < lines.length) throw new Error('line ' + lines[pos].n + ': unexpected "' + lines[pos].text + '"');
  return r;
}

const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function build() {
  const data = {};
  for (const name of ['params', 'ui', 'flow']) data[name] = parseYaml(fs.readFileSync(path.join(DIR, name + '.yaml'), 'utf8'));
  return data;
}
function problems(data) { // missing keys, in flow.yaml and in the pages
  const out = [];
  const want = (k, where) => { if (typeof get(data.ui, k) !== 'string') out.push(where + ': ui key missing: ' + k); };
  const walk = (o, where) => { for (const [k, v] of Object.entries(o || {})) {
    if (['title', 'title_alt', 'instruction', 'status', 'label'].includes(k) && typeof v === 'string') want(v, where + '.' + k);
    else if (v && typeof v === 'object') walk(v, where + '.' + k); } };
  walk(data.flow.states, 'flow');
  for (const f of ['check.html', 'party.html', 'meter.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'app', f), 'utf8');
    for (const m of src.matchAll(/data-ssot(?:-[a-z]+)?="([^"]+)"/g)) for (const part of m[1].split(';')) want(part.includes(':') ? part.split(':')[1].trim() : part.trim(), f);
    for (const m of src.matchAll(/'((?:check|party|guide|detect)\.[a-zA-Z0-9_.-]*[a-zA-Z0-9_])'/g)) if (!/\.(html|php|js)$/.test(m[1])) want(m[1], f); // every literal key, also inside ternaries
  }
  return out;
}
module.exports = { parseYaml, build, problems };

if (require.main === module) {
  const data = build(), json = JSON.stringify(data, null, 1) + '\n', file = path.join(DIR, 'ssot.json');
  const bad = problems(data);
  if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (cur !== json) { console.error('app/ssot/ssot.json is stale: run node tools/build_ssot.js'); process.exit(1); }
    console.log('ssot.json is up to date');
  } else { fs.writeFileSync(file, json); console.log('wrote ' + path.relative(ROOT, file) + ' (' + json.length + ' bytes)'); }
}
