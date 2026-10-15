// The soundscape (spec 2026-10-15 alive §10): made live with Web Audio, no files: wind, birdsong by day, crickets at
// night, rain while a field rains, a tractor's hum while machines drive. Off by default (the Menu's Sound); a browser
// plays sound only after a click, so it starts on one. mixOf is the rule (pure); makeSound plays it.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const MASTER = 0.35;
const LAYERS = ['wind', 'birds', 'crickets', 'rain', 'engine'];

/**
 * Each layer's volume (0–1) for the moment: night (0 by day … 1), wind (its strength: 1 calm, more in rain), raining
 * (a field rains), moving (machines driving), still (Motion off: only a quiet wind).
 */
export function mixOf({ night = 0, wind = 1, raining = false, moving = 0, still = false } = {}) {
  if (still) return { wind: 0.15, birds: 0, crickets: 0, rain: 0, engine: 0 };
  return { wind: clamp(0.25 + (wind - 1) * 0.3, 0, 0.8), birds: night < 0.4 ? 0.5 * (1 - night) : 0, crickets: night > 0.6 ? 0.5 : 0, rain: raining ? 0.5 : 0, engine: (Math.min(3, moving) / 3) * 0.45 };
}

/**
 * The sounds, with the frame's AudioContext class (undefined: not available). Nothing is made until enable() (a click
 * in the farm); state() → 'off' | 'waiting' (enabled, the browser not yet letting it play) | 'running'.
 */
export function makeSound(Ctx) {
  let ctx = null, layers = null, mix = mixOf(), chirpTimer = 0, on = false;
  function build() {
    const master = ctx.createGain();
    master.gain.value = MASTER;
    master.connect(ctx.destination);
    const gains = {};
    for (const k of LAYERS) { const g = ctx.createGain(); g.gain.value = 0; g.connect(master); gains[k] = g; }
    // two seconds of white noise, looped: the wind (a low band, swelling) and the rain (a high hiss)
    const n = ctx.sampleRate * 2, buf = ctx.createBuffer(1, n, ctx.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    const noise = () => { const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.start(); return src; };
    const windBand = ctx.createBiquadFilter();
    windBand.type = 'bandpass'; windBand.frequency.value = 400; windBand.Q.value = 0.6;
    noise().connect(windBand); windBand.connect(gains.wind);
    const rainHiss = ctx.createBiquadFilter();
    rainHiss.type = 'highpass'; rainHiss.frequency.value = 2500;
    noise().connect(rainHiss); rainHiss.connect(gains.rain);
    // crickets: a high tone, its level pulsed by a 28 Hz square
    const tone = ctx.createOscillator(), pulse = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain();
    tone.frequency.value = 4600; pulse.gain.value = 0;
    lfo.type = 'square'; lfo.frequency.value = 28; depth.gain.value = 0.5;
    tone.connect(pulse); pulse.connect(gains.crickets); lfo.connect(depth); depth.connect(pulse.gain);
    tone.start(); lfo.start();
    // the engine: a low sawtooth through a lowpass, wobbling a little
    const engine = ctx.createOscillator(), low = ctx.createBiquadFilter(), wob = ctx.createOscillator(), wobDepth = ctx.createGain();
    engine.type = 'sawtooth'; engine.frequency.value = 55; low.type = 'lowpass'; low.frequency.value = 220;
    wob.frequency.value = 0.7; wobDepth.gain.value = 3;
    engine.connect(low); low.connect(gains.engine); wob.connect(wobDepth); wobDepth.connect(engine.frequency);
    engine.start(); wob.start();
    return { gains };
  }
  /** A bird's chirp (two quick rising notes) now and then, while birds are in the mix. */
  function chirp() {
    if (on && layers && mix.birds > 0 && ctx.state === 'running') {
      const t = ctx.currentTime;
      for (let k = 0; k < 2; k++) {
        const o = ctx.createOscillator(), g = ctx.createGain(), at = t + k * 0.12;
        o.frequency.setValueAtTime(2600 + Math.random() * 600, at); o.frequency.exponentialRampToValueAtTime(4200, at + 0.08);
        g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.6, at + 0.02); g.gain.linearRampToValueAtTime(0, at + 0.1);
        o.connect(g); g.connect(layers.gains.birds);
        o.start(at); o.stop(at + 0.12);
      }
    }
    schedule();
  }
  function schedule() {
    clearTimeout(chirpTimer);
    if (!on) return;
    chirpTimer = setTimeout(chirp, 2000 + Math.random() * 4000);
    chirpTimer?.unref?.(); // in Node (the tests), never keeps it alive
  }
  return {
    available: typeof Ctx === 'function',
    /** Sound on: made the first time, resumed after (call it from a click: browsers need one). */
    enable() {
      if (typeof Ctx !== 'function') return;
      on = true;
      if (!ctx) { ctx = new Ctx(); layers = build(); }
      ctx.resume?.();
      this.setMix(mix);
      schedule();
    },
    disable() { on = false; clearTimeout(chirpTimer); ctx?.suspend?.(); },
    /** Each layer eased to its volume over about a second. */
    setMix(m) {
      mix = m;
      if (layers) for (const k of LAYERS) layers.gains[k].gain.setTargetAtTime(m[k] ?? 0, ctx.currentTime, 0.4);
    },
    state: () => (!on ? 'off' : ctx?.state === 'running' ? 'running' : 'waiting'),
  };
}
