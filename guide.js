// Guide state machine of check.html. Pure logic: reads flow.yaml (as JSON) and a snapshot of the page state,
// returns which state to show and which buttons it has. No DOM, no text: titles and labels are ui keys.
// Implemented names must match ssot/flow.yaml; tests/guide.test.cjs checks that they do.
(function (g) {
  const PRED = {
    always: () => true,
    detect_mode: e => !!e.detectMode,
    phones_below_min: (e, P) => e.live < P.phones.min_for_map && !e.skipped.join,
    phones_at_min: (e, P) => e.live >= P.phones.min_for_map,
    phones_uncalibrated: e => (e.touchActive || e.uncal > 0) && e.live >= 2,
  };
  const ACTIONS = ['detect', 'skip_join', 'back_home', 'join_next', 'touch_measure', 'skip_phone', 'skip_all',
    'back_to_join', 'cancel_run', 'measure_run', 'back_to_touch', 'back_to_calibration'];
  // env: { live, uncal, touchActive, run: null|'touch'|'measure', detectMode, forced, skipped: { join } }
  function select(flow, env, P) {
    if (PRED[flow.states.detect.entry](env, P)) return { id: 'detect', busy: false };
    if (env.run) return { id: env.run === 'touch' ? 'touch-calibrate' : 'measure', busy: true };
    if (env.forced && flow.states[env.forced]) return { id: env.forced, busy: false };
    for (const id of flow.order) if (PRED[flow.states[id].entry](env, P)) return { id, busy: false };
    return { id: flow.initial, busy: false };
  }
  function view(flow, env, P) {
    const sel = select(flow, env, P), st = flow.states[sel.id], src = sel.busy ? st.busy : st;
    const pr = src.primary && (!src.primary.show || PRED[src.primary.show](env, P)) ? src.primary : null;
    return {
      id: sel.id, busy: sel.busy, step: st.step, total: flow.steps_total,
      title: src.title, titleAlt: src.title_alt || null, instruction: src.instruction, status: src.status || null,
      primary: pr ? { id: pr.id, label: pr.label, enabled: pr.enabled ? !!PRED[pr.enabled](env, P) : true } : null,
      secondary: (src.secondary || []).map(a => ({ id: a.id, label: a.label, href: a.href || null })),
    };
  }
  g.Guide = { select, view, PRED: Object.keys(PRED), ACTIONS };
  if (typeof module !== 'undefined') module.exports = g.Guide;
})(typeof window !== 'undefined' ? window : globalThis);
