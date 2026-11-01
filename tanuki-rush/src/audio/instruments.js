// instruments.js — synthesizer voices used by the music player.
//
// Every instrument owns a small "channel" (input gain -> optional panner -> bus,
// plus reverb / delay sends). A `bus` is { out, rev, dly } provided by the
// playback that owns the instrument, so a whole song can be faded or torn down
// at once. Voices are created per note, start from zero gain (no clicks), and
// disconnect themselves once their oscillators have stopped.

import { mtof, envADSR, envPerc, cleanupWhenDone, makeDriveCurve } from './dsp.js';

// ---------------------------------------------------------------------------
// Small node helpers
// ---------------------------------------------------------------------------

export function makeGain(ctx, value = 1) {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

function makeOsc(ctx, type, freq, detune = 0) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  if (detune) o.detune.value = detune;
  return o;
}

function makeFilter(ctx, type, freq, q = 0.7, gainDb = 0) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  if (gainDb) f.gain.value = gainDb;
  return f;
}

/** input gain -> [stereo panner] -> bus.out, with optional reverb / delay sends. */
export function makeChannel(ctx, bus, { level = 1, pan = 0, rev = 0, dly = 0 } = {}) {
  const input = makeGain(ctx, level);
  const nodes = [input];
  let head = input;
  if (pan && typeof ctx.createStereoPanner === 'function') {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    input.connect(p);
    head = p;
    nodes.push(p);
  }
  head.connect(bus.out);
  if (rev > 0 && bus.rev) {
    const g = makeGain(ctx, rev);
    input.connect(g);
    g.connect(bus.rev);
    nodes.push(g);
  }
  if (dly > 0 && bus.dly) {
    const g = makeGain(ctx, dly);
    input.connect(g);
    g.connect(bus.dly);
    nodes.push(g);
  }
  return { input, nodes };
}

/** Base class: keeps the node list for disposal. */
class Instrument {
  constructor(ctx) {
    this.ctx = ctx;
    this.nodes = [];
  }

  dispose() {
    for (const n of this.nodes) {
      try { n.disconnect(); } catch (e) { /* ignore */ }
    }
    this.nodes = [];
  }
}

// ---------------------------------------------------------------------------
// Drums (pre-rendered buffers)
// ---------------------------------------------------------------------------

const DRUM_GAIN = {
  kick: 0.34, snare: 0.52, hatC: 0.45, hatO: 0.35, crash: 0.35, ride: 0.3,
  tomH: 0.4, tomM: 0.42, tomL: 0.45, shaker: 0.25, swell: 0.3,
};

export class DrumKit extends Instrument {
  constructor(ctx, buffers, bus, level = 1) {
    super(ctx);
    this.buffers = buffers;
    const ch = makeChannel(ctx, bus, { level });
    this.input = ch.input;
    this.nodes.push(...ch.nodes);
    this.rev = makeGain(ctx, 0.2); // snare / toms reverb send
    this.rev.connect(bus.rev);
    this.nodes.push(this.rev);
    this.layers = {};
    this.openHat = null;
  }

  /** Gain node for an intensity layer (created silent). */
  layer(name) {
    if (!this.layers[name]) {
      const g = makeGain(this.ctx, 0);
      g.connect(this.input);
      this.layers[name] = g;
      this.nodes.push(g);
    }
    return this.layers[name];
  }

  play(name, time, vel = 1, layerName, offset = 0) {
    const buf = this.buffers[name];
    if (!buf) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const level = vel * (DRUM_GAIN[name] || 0.5);
    const g = makeGain(ctx, level);
    if (offset > 0) {
      // Starting mid-buffer: fade in so we never start on a non-zero sample.
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(level, time + 0.012);
    }
    src.connect(g);
    g.connect(layerName ? this.layer(layerName) : this.input);
    if (name === 'snare' || name.startsWith('tom')) g.connect(this.rev);
    // A closed hat chokes a ringing open hat, like on a real kit.
    if (name === 'hatC' && this.openHat) {
      this.openHat.gain.setTargetAtTime(0, time, 0.012);
      this.openHat = null;
    }
    if (name === 'hatO') this.openHat = g;
    src.start(time, offset);
    cleanupWhenDone([src], [g]);
  }
}

// ---------------------------------------------------------------------------
// Bass: saw through a plucky low-pass + sine for weight, mild drive
// ---------------------------------------------------------------------------

export class Bass extends Instrument {
  constructor(ctx, bus, level = 0.5) {
    super(ctx);
    const ch = makeChannel(ctx, bus, { level });
    this.pre = makeGain(ctx, 1.2);
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeDriveCurve(1.6, 0.05);
    const lp = makeFilter(ctx, 'lowpass', 3200, 0.6);
    this.pre.connect(shaper);
    shaper.connect(lp);
    lp.connect(ch.input);
    this.input = this.pre;
    this.nodes.push(...ch.nodes, this.pre, shaper, lp);
  }

  setDrive(x, time) {
    this.pre.gain.setTargetAtTime(1.2 + 0.5 * x, time, 0.3);
  }

  play(ev, time, stepDur) {
    const ctx = this.ctx;
    const f = mtof(ev.m);
    const dur = ev.x ? 0.035 : Math.max(0.05, ev.d * stepDur - 0.015);
    const saw = makeOsc(ctx, 'sawtooth', f);
    const sine = makeOsc(ctx, 'sine', f);
    const lp = makeFilter(ctx, 'lowpass', 1000, 5); // note: LP/HP Q is in dB in Web Audio
    const c0 = ev.x ? 450 : 650 + 1700 * ev.v;
    lp.frequency.setValueAtTime(c0, time);
    lp.frequency.setTargetAtTime(ev.x ? 200 : 320 + f * 2, time, 0.07);
    const sub = makeGain(ctx, 0.85);
    const g = ctx.createGain();
    saw.connect(lp);
    lp.connect(g);
    sine.connect(sub);
    sub.connect(g);
    g.connect(this.input);
    const end = envADSR(g.gain, time, dur, 0.4 * ev.v, 0.003, 0.2, 0.75, 0.04);
    saw.start(time);
    sine.start(time);
    saw.stop(end);
    sine.stop(end);
    cleanupWhenDone([saw, sine], [lp, sub, g]);
  }
}

// ---------------------------------------------------------------------------
// Distorted guitar: detuned saw power chords -> WaveShaper -> cabinet EQ, Haas stereo
// ---------------------------------------------------------------------------

export class Guitar extends Instrument {
  constructor(ctx, bus, level = 0.26) {
    super(ctx);
    this.baseDrive = 3.2;
    this.input = makeGain(ctx, 1);
    this.pre = makeGain(ctx, this.baseDrive);
    const tight = makeFilter(ctx, 'highpass', 110, 0.7);
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeDriveCurve(2.8, 0.08);
    shaper.oversample = '2x';
    const dc = makeFilter(ctx, 'highpass', 70, 0.7);
    const mid = makeFilter(ctx, 'peaking', 1500, 0.8, 4);
    const scoop = makeFilter(ctx, 'peaking', 420, 1.0, -3);
    const cab1 = makeFilter(ctx, 'lowpass', 5000, 0.9);
    const cab2 = makeFilter(ctx, 'lowpass', 7500, 0.5);
    const post = makeGain(ctx, 0.55);
    this.input.connect(this.pre);
    this.pre.connect(tight);
    tight.connect(shaper);
    shaper.connect(dc);
    dc.connect(mid);
    mid.connect(scoop);
    scoop.connect(cab1);
    cab1.connect(cab2);
    cab2.connect(post);
    // Haas-effect double tracking: dry left, 13 ms late right.
    const left = makeChannel(ctx, bus, { level, pan: -0.6 });
    const right = makeChannel(ctx, bus, { level, pan: 0.6 });
    const haas = ctx.createDelay(0.05);
    haas.delayTime.value = 0.013;
    post.connect(left.input);
    post.connect(haas);
    haas.connect(right.input);
    this.nodes.push(this.input, this.pre, tight, shaper, dc, mid, scoop, cab1, cab2, post, haas, ...left.nodes, ...right.nodes);
  }

  setDrive(x, time) {
    this.pre.gain.setTargetAtTime(this.baseDrive * (1 + 0.9 * x), time, 0.3);
  }

  play(ev, time, stepDur) {
    const ctx = this.ctx;
    const mute = ev.mute;
    const lp = makeFilter(ctx, 'lowpass', mute ? 600 + 350 * ev.v : 3400, mute ? 1.3 : 0.7);
    const g = ctx.createGain();
    lp.connect(g);
    g.connect(this.input);
    const end = mute
      ? envPerc(g.gain, time, 0.3 * ev.v, 0.002, 0.045)
      : envADSR(g.gain, time, Math.max(0.05, ev.d * stepDur - 0.01), 0.3 * ev.v, 0.004, 0.7, 0.6, 0.07);
    const oscs = [];
    ev.n.forEach((m, k) => {
      const f = mtof(m);
      const st = time + k * 0.005; // down-strum
      for (const det of [-7, 7]) {
        const o = makeOsc(ctx, 'sawtooth', f, det);
        o.connect(lp);
        o.start(st);
        o.stop(end + 0.02);
        oscs.push(o);
      }
    });
    cleanupWhenDone(oscs, [lp, g]);
  }
}

// ---------------------------------------------------------------------------
// Lead: two detuned saws + sub square, filter envelope, delayed vibrato, glide
// ---------------------------------------------------------------------------

export class Lead extends Instrument {
  constructor(ctx, bus, { level = 0.28, pan = 0, rev = 0.2, dly = 0.22, cut = 1 } = {}) {
    super(ctx);
    const ch = makeChannel(ctx, bus, { level, pan, rev, dly });
    this.input = ch.input;
    this.nodes.push(...ch.nodes);
    this.cut = cut;
    this.lastF = 0;
  }

  play(ev, time, stepDur) {
    const ctx = this.ctx;
    const f = mtof(ev.m);
    const dur = Math.max(0.06, ev.d * stepDur - 0.012);
    const o1 = makeOsc(ctx, 'sawtooth', f, -7);
    const o2 = makeOsc(ctx, 'sawtooth', f, 7);
    const o3 = makeOsc(ctx, 'square', f / 2);
    const sub = makeGain(ctx, 0.25);
    const lp = makeFilter(ctx, 'lowpass', 3000, 1.6);
    const base = Math.min(9000, (2000 + 2800 * ev.v) * this.cut);
    lp.frequency.setValueAtTime(base * 1.8, time);
    lp.frequency.setTargetAtTime(base, time + 0.01, 0.09);
    const g = ctx.createGain();
    o1.connect(lp);
    o2.connect(lp);
    o3.connect(sub);
    sub.connect(lp);
    lp.connect(g);
    g.connect(this.input);

    // Portamento into notes marked with "/" in the score.
    if (ev.g && this.lastF > 0 && Math.abs(this.lastF - f) > 1) {
      for (const [o, k] of [[o1, 1], [o2, 1], [o3, 0.5]]) {
        o.frequency.setValueAtTime(this.lastF * k, time);
        o.frequency.exponentialRampToValueAtTime(f * k, time + 0.075);
      }
    }
    this.lastF = f;

    const end = envADSR(g.gain, time, dur, 0.3 * ev.v, 0.006, 0.3, 0.8, 0.1);
    const srcs = [o1, o2, o3];
    const extra = [lp, g, sub];
    // Delayed vibrato on held notes (detune in cents).
    if (dur > 0.28) {
      const lfo = makeOsc(ctx, 'sine', 5.5);
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0, time);
      depth.gain.setValueAtTime(0, time + 0.16);
      depth.gain.linearRampToValueAtTime(15, time + 0.45);
      lfo.connect(depth);
      depth.connect(o1.detune);
      depth.connect(o2.detune);
      depth.connect(o3.detune);
      lfo.start(time);
      lfo.stop(end);
      srcs.push(lfo);
      extra.push(depth);
    }
    for (const o of [o1, o2, o3]) {
      o.start(time);
      o.stop(end);
    }
    cleanupWhenDone(srcs, extra);
  }
}

// ---------------------------------------------------------------------------
// Bell: two-operator FM chime (sparkle arpeggios and the bridge melody)
// ---------------------------------------------------------------------------

export class Bell extends Instrument {
  constructor(ctx, bus, { level = 0.1, pan = 0.3, rev = 0.3, dly = 0.2 } = {}) {
    super(ctx);
    const ch = makeChannel(ctx, bus, { level, pan, rev, dly });
    this.input = ch.input;
    this.nodes.push(...ch.nodes);
  }

  play(ev, time, stepDur) {
    const ctx = this.ctx;
    const f = mtof(ev.m);
    const dur = ev.d * stepDur;
    const car = makeOsc(ctx, 'sine', f);
    const mod = makeOsc(ctx, 'sine', f * 3.5);
    const idx = ctx.createGain();
    idx.gain.setValueAtTime(f * 1.3, time);
    idx.gain.setTargetAtTime(f * 0.12, time, 0.1);
    mod.connect(idx);
    idx.connect(car.frequency);
    const shimmer = makeOsc(ctx, 'sine', f * 2);
    const sg = ctx.createGain();
    envPerc(sg.gain, time, 0.07 * ev.v, 0.002, 0.07);
    shimmer.connect(sg);
    const g = ctx.createGain();
    car.connect(g);
    sg.connect(g);
    g.connect(this.input);
    const end = envPerc(g.gain, time, 0.3 * ev.v, 0.002, Math.min(0.45, 0.1 + dur * 0.25));
    for (const o of [car, mod, shimmer]) {
      o.start(time);
      o.stop(end);
    }
    cleanupWhenDone([car, mod, shimmer], [idx, sg, g]);
  }
}

// ---------------------------------------------------------------------------
// Pluck: resonant saw/square pluck for the 16th-note intensity arpeggio
// ---------------------------------------------------------------------------

export class Pluck extends Instrument {
  constructor(ctx, bus, { level = 0.1, pan = -0.3, rev = 0.05, dly = 0.15 } = {}) {
    super(ctx);
    const ch = makeChannel(ctx, bus, { level, pan, rev, dly });
    this.out = ch.input;
    // Layer gain in front of the channel: the music player fades it with intensity.
    this.input = makeGain(ctx, 0);
    this.input.connect(this.out);
    this.nodes.push(...ch.nodes, this.input);
  }

  play(ev, time) {
    const ctx = this.ctx;
    const f = mtof(ev.m);
    const o1 = makeOsc(ctx, 'sawtooth', f, -5);
    const o2 = makeOsc(ctx, 'square', f, 5);
    const lp = makeFilter(ctx, 'lowpass', 4000, 8); // resonant (Q in dB)
    lp.frequency.setValueAtTime(Math.min(9000, f * 9), time);
    lp.frequency.setTargetAtTime(f * 1.4 + 300, time, 0.05);
    const g = ctx.createGain();
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(g);
    g.connect(this.input);
    const end = envPerc(g.gain, time, 0.22 * ev.v, 0.002, 0.07);
    for (const o of [o1, o2]) {
      o.start(time);
      o.stop(end);
    }
    cleanupWhenDone([o1, o2], [lp, g]);
  }
}

// ---------------------------------------------------------------------------
// Pad: soft detuned saw chord with a slow filter bloom
// ---------------------------------------------------------------------------

export class Pad extends Instrument {
  constructor(ctx, bus, { level = 0.09, rev = 0.35 } = {}) {
    super(ctx);
    const ch = makeChannel(ctx, bus, { level, rev });
    this.input = ch.input;
    this.nodes.push(...ch.nodes);
  }

  play(ev, time, stepDur) {
    const ctx = this.ctx;
    const dur = ev.d * stepDur;
    const lp = makeFilter(ctx, 'lowpass', 900, 0.6);
    lp.frequency.setValueAtTime(900, time);
    lp.frequency.linearRampToValueAtTime(2000, time + Math.min(dur, 2));
    const g = ctx.createGain();
    lp.connect(g);
    g.connect(this.input);
    const end = envADSR(g.gain, time, dur, 0.16 * ev.v, 0.3, 0.8, 0.85, 0.45);
    const oscs = [];
    for (const m of ev.n) {
      for (const det of [-10, 10]) {
        const o = makeOsc(ctx, 'sawtooth', mtof(m), det);
        o.connect(lp);
        o.start(time);
        o.stop(end);
        oscs.push(o);
      }
    }
    cleanupWhenDone(oscs, [lp, g]);
  }
}

// ---------------------------------------------------------------------------
// Electric piano: FM tine (title screen comping)
// ---------------------------------------------------------------------------

export class EPiano extends Instrument {
  constructor(ctx, bus, { level = 0.2, pan = -0.15, rev = 0.15 } = {}) {
    super(ctx);
    const ch = makeChannel(ctx, bus, { level, pan, rev });
    this.input = ch.input;
    this.nodes.push(...ch.nodes);
  }

  play(ev, time, stepDur) {
    const ctx = this.ctx;
    const dur = Math.max(0.08, ev.d * stepDur - 0.01);
    const g = ctx.createGain();
    g.connect(this.input);
    const end = envADSR(g.gain, time, dur, 0.2 * ev.v, 0.003, 0.5, 0.45, 0.12);
    const srcs = [];
    const extra = [g];
    for (const m of ev.n) {
      const f = mtof(m);
      const car = makeOsc(ctx, 'sine', f);
      const mod = makeOsc(ctx, 'sine', f);
      const idx = ctx.createGain();
      idx.gain.setValueAtTime(f * 1.1, time);
      idx.gain.setTargetAtTime(f * 0.18, time, 0.25);
      mod.connect(idx);
      idx.connect(car.frequency);
      car.connect(g);
      car.start(time);
      mod.start(time);
      car.stop(end);
      mod.stop(end);
      srcs.push(car, mod);
      extra.push(idx);
    }
    cleanupWhenDone(srcs, extra);
  }
}

// ---------------------------------------------------------------------------
// Brass stab: saw ensemble with a "blown" filter swell (jingles)
// ---------------------------------------------------------------------------

export class Brass extends Instrument {
  constructor(ctx, bus, { level = 0.2, rev = 0.25 } = {}) {
    super(ctx);
    const ch = makeChannel(ctx, bus, { level, rev });
    this.input = ch.input;
    this.nodes.push(...ch.nodes);
  }

  play(ev, time, stepDur) {
    const ctx = this.ctx;
    const dur = Math.max(0.08, ev.d * stepDur - 0.02);
    const lp = makeFilter(ctx, 'lowpass', 700, 1.2);
    lp.frequency.setValueAtTime(700, time);
    lp.frequency.linearRampToValueAtTime(3800, time + 0.05);
    lp.frequency.setTargetAtTime(2200, time + 0.05, 0.2);
    const g = ctx.createGain();
    lp.connect(g);
    g.connect(this.input);
    const end = envADSR(g.gain, time, dur, 0.2 * ev.v, 0.02, 0.3, 0.75, 0.15);
    const oscs = [];
    for (const m of ev.n) {
      for (const det of [-6, 6]) {
        const o = makeOsc(ctx, 'sawtooth', mtof(m), det);
        o.connect(lp);
        o.start(time);
        o.stop(end);
        oscs.push(o);
      }
    }
    cleanupWhenDone(oscs, [lp, g]);
  }
}
