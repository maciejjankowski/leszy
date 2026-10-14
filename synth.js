// Synthetic rotor sound: a harmonic comb with a little wobble and propeller-beat AM.
// Used by the emitter page (out of the speaker) and the sensor self-test (straight into the analyser).
function makeDrone(ctx, f0 = 300, harmonics = 14) {
  const out = ctx.createGain(); out.gain.value = 0.6;
  const am = ctx.createGain(); am.gain.value = 1; am.connect(out);
  const beat = ctx.createOscillator(), beatDepth = ctx.createGain();
  beat.frequency.value = 6; beatDepth.gain.value = 0.25; beat.connect(beatDepth); beatDepth.connect(am.gain); beat.start();
  const wob = ctx.createOscillator(), wobDepth = ctx.createGain();
  wob.frequency.value = 0.4; wob.start(); wob.connect(wobDepth);
  const oscs = [];
  for (let k = 1; k <= harmonics; k++) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f0 * k; g.gain.value = 0.35 / Math.pow(k, 0.7);
    const wk = ctx.createGain(); wk.gain.value = k; wobDepth.connect(wk); wk.connect(o.frequency); // all harmonics drift together
    o.connect(g); g.connect(am); o.start(); oscs.push(o);
  }
  const noise = ctx.createBufferSource(), nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = nb.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.04;
  noise.buffer = nb; noise.loop = true; noise.connect(out); noise.start();
  const api = {
    output: out,
    setF0(f) { oscs.forEach((o, i) => o.frequency.setTargetAtTime(f * (i + 1), ctx.currentTime, 0.05)); wobDepth.gain.value = f * 0.008; },
    setGain(v) { out.gain.setTargetAtTime(v, ctx.currentTime, 0.05); },
    stop() { [...oscs, beat, wob, noise].forEach(o => { try { o.stop(); } catch (e) {} }); out.disconnect(); },
  };
  api.setF0(f0);
  return api;
}
