// Single source of truth loader. The YAML in ssot/ is the editable source; tools/build_ssot.js turns it into ssot/ssot.json,
// which this file fetches. Pages render every string through SSOT.t(key, vars) or data-ssot attributes.
//   SSOT.ready            promise, resolves when ssot.json is loaded and the static text is rendered
//   SSOT.t('a.b', {n: 2}) string with {n} filled in; {n|one|few|many} picks the Polish plural form
//   SSOT.p('a.b')         a parameter (number, list)
//   SSOT.flow             the guide state machine (flow.yaml)
//   data-ssot="key"                       element text
//   data-ssot-attr="placeholder:key;title:key2"   attributes
(function (g) {
  const S = { ui: {}, params: {}, flow: {}, loaded: false };
  const look = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
  const plural = (n, one, few, many) => { n = Math.abs(n); const m10 = n % 10, m100 = n % 100; return n === 1 ? one : (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) ? few : many; };
  S.t = (key, vars) => {
    const s = look(S.ui, key);
    if (typeof s !== 'string') { if (S.loaded && g.console) console.warn('SSOT: missing string ' + key); return '[' + key + ']'; }
    vars = vars || {};
    return s.replace(/\{([a-zA-Z0-9_]+)((?:\|[^|{}]*){3})?\}/g, (all, name, forms) => {
      if (!(name in vars)) return all;
      if (forms) { const f = forms.slice(1).split('|'); return plural(+vars[name], f[0], f[1], f[2]); }
      return String(vars[name]);
    });
  };
  S.p = path => look(S.params, path);
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  S.set = (el, key, vars) => { // text, with **bold** in static lines
    const s = S.t(key, vars);
    if (s.includes('**')) el.innerHTML = esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); else el.textContent = s;
  };
  S.apply = (root) => {
    root = root || document;
    for (const el of root.querySelectorAll('[data-ssot]')) S.set(el, el.getAttribute('data-ssot'));
    for (const el of root.querySelectorAll('[data-ssot-attr]'))
      for (const pair of el.getAttribute('data-ssot-attr').split(';')) { const i = pair.indexOf(':'); if (i > 0) el.setAttribute(pair.slice(0, i).trim(), S.t(pair.slice(i + 1).trim())); }
  };
  S.ready = fetch('ssot/ssot.json', { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(j => {
    S.ui = j.ui; S.params = j.params; S.flow = j.flow; S.loaded = true; S.apply(document); return S;
  }).catch(e => { document.body.textContent = 'ssot/ssot.json: ' + e.message; throw e; });
  g.SSOT = S;
})(typeof window !== 'undefined' ? window : globalThis);
