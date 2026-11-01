// voice.js — a one-shot SFX "voice": owns every node of one sound effect,
// provides small building blocks, and cleans itself up when its sources end.

import { clamp, envPerc, cleanupWhenDone } from './dsp.js';

export class Voice {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} dest  SFX bus input
   * @param {object} o  { t, pitch, volume, pan, noise, kit, revBus, crunch, drive }
   */
  constructor(ctx, dest, o) {
    this.ctx = ctx;
    this.t = o.t;
    this.p = o.pitch;
    this.noise = o.noise;
    this.kit = o.kit || {};
    this.revBus = o.revBus || null;
    this.curves = o.curves || {};
    this.sources = [];
    this.nodes = [];
    this.end = o.t;
    this.killed = false;
    this.out = ctx.createGain();
    this.out.gain.value = o.volume;
    this.nodes.push(this.out);
    // Output panner (always created when supported so effects like `whoosh` can sweep it).
    this.panValue = clamp(o.pan || 0, -1, 1);
    this.panParam = null;
    let head = this.out;
    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = this.panValue;
      this.out.connect(p);
      this.nodes.push(p);
      this.panParam = p.pan;
      head = p;
    }
    head.connect(dest);
  }

  _src(node, t0, t1) {
    this.sources.push(node);
    this.end = Math.max(this.end, t1);
    return node;
  }

  /** Oscillator started at t0 and stopped at t1 (not connected). */
  osc(type, freq, t0 = this.t, t1 = t0 + 0.5) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.start(t0);
    o.stop(t1);
    return this._src(o, t0, t1);
  }

  /** Looping white-noise source (random start offset so repeats never sound identical). */
  noiseSrc(t0 = this.t, t1 = t0 + 0.5, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(t0, Math.random() * Math.max(0, this.noise.duration - 0.05));
    s.stop(t1);
    return this._src(s, t0, t1);
  }

  /** Play a pre-rendered kit buffer (e.g. 'crash'). */
  buffer(name, t0 = this.t, rate = 1) {
    const buf = this.kit[name];
    if (!buf) return null;
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate;
    s.start(t0);
    return this._src(s, t0, t0 + buf.duration / rate);
  }

  gain(v = 0) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    this.nodes.push(g);
    return g;
  }

  filter(type, freq, q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    this.nodes.push(f);
    return f;
  }

  shaper(curveName) {
    const w = this.ctx.createWaveShaper();
    w.curve = this.curves[curveName];
    this.nodes.push(w);
    return w;
  }

  panner(pan = 0) {
    if (typeof this.ctx.createStereoPanner !== 'function') return this.gain(1);
    const p = this.ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    this.nodes.push(p);
    return p;
  }

  /** Percussive envelope gain (connected to `dest`, default the voice output). */
  env(peak, a = 0.003, tc = 0.1, t0 = this.t, dest = this.out) {
    const g = this.gain(0);
    envPerc(g.gain, t0, peak, a, tc);
    g.connect(dest);
    return g;
  }

  /** Attack / hold / release envelope gain. */
  envHold(peak, a, hold, tc, t0 = this.t, dest = this.out) {
    const g = this.gain(0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.setValueAtTime(peak, t0 + a + hold);
    g.gain.setTargetAtTime(0, t0 + a + hold, tc);
    g.connect(dest);
    return g;
  }

  /** Reverb send from `node` (no-op if the engine has no SFX reverb). */
  send(node, amount) {
    if (!this.revBus || amount <= 0) return;
    const g = this.gain(amount);
    node.connect(g);
    g.connect(this.revBus);
  }

  /** Exponential frequency sweep helper (values are clamped to stay > 0). */
  sweep(param, from, to, t0, dur) {
    param.setValueAtTime(Math.max(1e-3, from), t0);
    param.exponentialRampToValueAtTime(Math.max(1e-3, to), t0 + Math.max(0.005, dur));
  }

  // --- reusable sound blocks -------------------------------------------------

  /** Glassy two-operator FM chime. */
  bell(freq, t0, peak, tc, { ratio = 3.5, index = 1.2, dest = this.out, flick = 0 } = {}) {
    const end = t0 + tc * 7 + 0.01;
    const car = this.osc('sine', freq, t0, end);
    if (flick) this.sweep(car.frequency, freq * flick, freq, t0, 0.02);
    const mod = this.osc('sine', freq * ratio, t0, end);
    const idx = this.gain(0);
    idx.gain.setValueAtTime(freq * index, t0);
    idx.gain.setTargetAtTime(freq * 0.08, t0, tc * 0.4);
    mod.connect(idx);
    idx.connect(car.frequency);
    car.connect(this.env(peak, 0.0015, tc, t0, dest));
    return end;
  }

  /** Pitch-dropping sine thump / boom. */
  boom(f0, f1, t0, peak, tc, dest = this.out, sweepDur = 0.08) {
    const end = t0 + tc * 7 + 0.02;
    const o = this.osc('sine', f0, t0, end);
    this.sweep(o.frequency, f0, f1, t0, sweepDur);
    o.connect(this.env(peak, 0.002, tc, t0, dest));
    return o;
  }

  /** Band-passed noise whoosh with a centre-frequency sweep. */
  whoosh(f0, f1, t0, dur, peak, { q = 1, a = 0.01, tc = 0.08, type = 'bandpass', dest = this.out } = {}) {
    const end = t0 + dur + tc * 7;
    const n = this.noiseSrc(t0, end);
    const f = this.filter(type, f0, q);
    this.sweep(f.frequency, f0, f1, t0, dur);
    n.connect(f);
    f.connect(this.envHold(peak, a, Math.max(0, dur - a), tc, t0, dest));
    return f;
  }

  /** Called once the effect has been built: disconnect everything when sources end. */
  finish() {
    cleanupWhenDone(this.sources, this.nodes);
  }

  /** Voice stealing: fade out fast and stop early. */
  kill(now) {
    if (this.killed) return;
    this.killed = true;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setTargetAtTime(0, now, 0.008);
    for (const s of this.sources) {
      try { s.stop(now + 0.06); } catch (e) { /* already stopped */ }
    }
    this.end = Math.min(this.end, now + 0.06);
  }
}
