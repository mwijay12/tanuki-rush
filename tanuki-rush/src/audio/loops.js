// loops.js — continuous, parameter-driven sound loops: wind, rail grind,
// boost jet and the chasing truck's diesel engine.
//
// Each loop is built lazily the first time it becomes audible, then runs
// forever at zero gain when idle (a handful of cheap nodes). All parameter
// changes use setTargetAtTime, so per-frame calls from the game are smooth.

import { clamp } from './dsp.js';

const EPS = 0.004; // ignore changes smaller than this (the game may call us every frame)

export class LoopBank {
  constructor(ctx, dest, noise, curves) {
    this.ctx = ctx;
    this.dest = dest;
    this.noise = noise;
    this.curves = curves;
    this.loops = {};
    this.last = {};
  }

  // --- node helpers ----------------------------------------------------------

  _gain(v, nodes) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    nodes.push(g);
    return g;
  }

  _filter(type, f, q, nodes) {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    nodes.push(b);
    return b;
  }

  _osc(type, f, nodes) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.start();
    nodes.push(o);
    return o;
  }

  _noise(nodes) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start(this.ctx.currentTime, Math.random() * Math.max(0, this.noise.duration - 0.1));
    nodes.push(s);
    return s;
  }

  _changed(key, value) {
    const prev = this.last[key];
    if (prev !== undefined && Math.abs(prev - value) < EPS && !(value === 0 && prev !== 0)) return false;
    this.last[key] = value;
    return true;
  }

  // --- wind ------------------------------------------------------------------

  _buildWind() {
    const n = [];
    const src = this._noise(n);
    const hp = this._filter('highpass', 120, 0.5, n);
    const lp = this._filter('lowpass', 400, 0.5, n);
    const bp = this._filter('bandpass', 900, 1.4, n); // whistling band at high speed
    const bpGain = this._gain(0, n);
    const out = this._gain(0, n);
    src.connect(hp);
    hp.connect(lp);
    lp.connect(out);
    hp.connect(bp);
    bp.connect(bpGain);
    bpGain.connect(out);
    out.connect(this.dest);
    // Gusts: slow LFOs on the cutoff and on the level.
    const lfo = this._osc('sine', 0.23, n);
    const lfoCut = this._gain(150, n);
    lfo.connect(lfoCut);
    lfoCut.connect(lp.frequency);
    const lfo2 = this._osc('sine', 0.61, n);
    const lfoAmp = this._gain(0, n);
    lfo2.connect(lfoAmp);
    lfoAmp.connect(out.gain);
    return { lp, bp, bpGain, out, lfoCut, lfoAmp, nodes: n };
  }

  setWind(x) {
    x = clamp(x);
    if (!this.loops.wind && x <= 0) return;
    if (!this._changed('wind', x)) return;
    const w = this.loops.wind || (this.loops.wind = this._buildWind());
    const now = this.ctx.currentTime;
    const level = 0.42 * Math.pow(x, 1.5);
    w.out.gain.setTargetAtTime(level, now, 0.12);
    w.lfoAmp.gain.setTargetAtTime(level * 0.25, now, 0.12);
    w.lp.frequency.setTargetAtTime(350 + 5200 * Math.pow(x, 1.4), now, 0.15);
    w.lfoCut.gain.setTargetAtTime(150 + 700 * x, now, 0.3);
    w.bp.frequency.setTargetAtTime(700 + 2600 * x, now, 0.2);
    w.bpGain.gain.setTargetAtTime(0.35 * x * x, now, 0.2);
  }

  // --- rail grind --------------------------------------------------------------

  _buildGrind() {
    const n = [];
    const src = this._noise(n);
    const noiseGain = this._gain(4, n); // narrow resonant bands are quiet: make up level
    const bands = [[1900, 9], [3500, 14], [5200, 6]].map(([f, q]) => {
      const b = this._filter('bandpass', f, q, n);
      src.connect(b);
      b.connect(noiseGain);
      return b;
    });
    // Low wheel/board rumble
    const saw = this._osc('sawtooth', 70, n);
    const sawLp = this._filter('lowpass', 900, 1, n);
    const sawGain = this._gain(0.25, n);
    saw.connect(sawLp);
    sawLp.connect(sawGain);
    // Metal squeal with a little wobble
    const squeal = this._osc('sine', 2650, n);
    const sqGain = this._gain(0.05, n);
    const wob = this._osc('sine', 9, n);
    const wobDepth = this._gain(25, n);
    wob.connect(wobDepth);
    wobDepth.connect(squeal.detune);
    squeal.connect(sqGain);
    // Scrape "chatter": amplitude modulation by a square LFO
    const mod = this._gain(0.65, n);
    const am = this._osc('square', 23, n);
    const amDepth = this._gain(0.35, n);
    am.connect(amDepth);
    amDepth.connect(mod.gain);
    noiseGain.connect(mod);
    sawGain.connect(mod);
    sqGain.connect(mod);
    const hp = this._filter('highpass', 250, 0.7, n);
    const out = this._gain(0, n);
    mod.connect(hp);
    hp.connect(out);
    out.connect(this.dest);
    return { bands, saw, squeal, am, out, nodes: n };
  }

  setGrind(active, x = 0.5) {
    x = clamp(x);
    if (!this.loops.grind && !active) return;
    const onChanged = this._changed('grindOn', active ? 1 : 0);
    const xChanged = this._changed('grindX', x);
    if (!onChanged && !xChanged) return;
    const g = this.loops.grind || (this.loops.grind = this._buildGrind());
    const now = this.ctx.currentTime;
    g.out.gain.setTargetAtTime(active ? 0.3 + 0.12 * x : 0, now, active ? 0.02 : 0.06);
    const k = 0.8 + 0.6 * x;
    [1900, 3500, 5200].forEach((f, i) => g.bands[i].frequency.setTargetAtTime(f * k, now, 0.05));
    g.saw.frequency.setTargetAtTime(55 + 60 * x, now, 0.05);
    g.squeal.frequency.setTargetAtTime(2400 + 900 * x, now, 0.05);
    g.am.frequency.setTargetAtTime(18 + 20 * x, now, 0.05);
  }

  // --- boost jet -----------------------------------------------------------------

  _buildBoost() {
    const n = [];
    const src = this._noise(n);
    const lp = this._filter('lowpass', 900, 0.8, n);
    const bp = this._filter('bandpass', 700, 1.5, n);
    const bpGain = this._gain(0.8, n);
    const noiseGain = this._gain(0.9, n);
    src.connect(lp);
    lp.connect(noiseGain);
    src.connect(bp);
    bp.connect(bpGain);
    bpGain.connect(noiseGain);
    // Beating low saws = engine roar
    const s1 = this._osc('sawtooth', 52, n);
    const s2 = this._osc('sawtooth', 52.7, n);
    const sLp = this._filter('lowpass', 320, 1, n);
    const sGain = this._gain(0.35, n);
    s1.connect(sLp);
    s2.connect(sLp);
    sLp.connect(sGain);
    // Flutter
    const mix = this._gain(0.88, n);
    const fl = this._osc('sine', 16, n);
    const flDepth = this._gain(0.12, n);
    fl.connect(flDepth);
    flDepth.connect(mix.gain);
    noiseGain.connect(mix);
    sGain.connect(mix);
    const drv = this.ctx.createWaveShaper();
    drv.curve = this.curves.drive;
    n.push(drv);
    const out = this._gain(0, n);
    mix.connect(drv);
    drv.connect(out);
    out.connect(this.dest);
    return { lp, s1, s2, out, nodes: n };
  }

  setBoost(active) {
    if (!this.loops.boost && !active) return;
    if (!this._changed('boost', active ? 1 : 0)) return;
    const b = this.loops.boost || (this.loops.boost = this._buildBoost());
    const now = this.ctx.currentTime;
    if (active) {
      b.out.gain.setTargetAtTime(0.36, now, 0.05);
      b.lp.frequency.setTargetAtTime(2800, now, 0.25); // rev-up sweep
      b.s1.frequency.setTargetAtTime(60, now, 0.3);
      b.s2.frequency.setTargetAtTime(60.8, now, 0.3);
    } else {
      b.out.gain.setTargetAtTime(0, now, 0.15);
      b.lp.frequency.setTargetAtTime(900, now, 0.2);
      b.s1.frequency.setTargetAtTime(52, now, 0.3);
      b.s2.frequency.setTargetAtTime(52.7, now, 0.3);
    }
  }

  // --- chasing truck ----------------------------------------------------------------

  _buildTruck() {
    const n = [];
    // Firing pulse (sawtooth at the cylinder firing rate) + sub + second harmonic
    const fire = this._osc('sawtooth', 30, n);
    const fireLp = this._filter('lowpass', 220, 2, n);
    const fireGain = this._gain(0.6, n);
    fire.connect(fireLp);
    fireLp.connect(fireGain);
    const sub = this._osc('sine', 30, n);
    const subGain = this._gain(0.5, n);
    sub.connect(subGain);
    const harm = this._osc('square', 60, n);
    const harmLp = this._filter('lowpass', 400, 1, n);
    const harmGain = this._gain(0.15, n);
    harm.connect(harmLp);
    harmLp.connect(harmGain);
    // Diesel clatter: band-passed noise chopped at the firing rate
    const src = this._noise(n);
    const nbp = this._filter('bandpass', 1400, 0.9, n);
    const clat = this._gain(0.5, n);
    const am = this._osc('square', 30, n);
    const amDepth = this._gain(0.5, n);
    am.connect(amDepth);
    amDepth.connect(clat.gain);
    const clatGain = this._gain(0.12, n);
    src.connect(nbp);
    nbp.connect(clat);
    clat.connect(clatGain);
    const mix = this._gain(1, n);
    for (const g of [fireGain, subGain, harmGain, clatGain]) g.connect(mix);
    const drv = this.ctx.createWaveShaper();
    drv.curve = this.curves.drive;
    n.push(drv);
    const lp = this._filter('lowpass', 300, 0.7, n);
    const out = this._gain(0, n);
    mix.connect(drv);
    drv.connect(lp);
    lp.connect(out);
    out.connect(this.dest);
    return { fire, sub, harm, am, lp, out, nodes: n };
  }

  setTruck(x) {
    x = clamp(x);
    if (!this.loops.truck && x <= 0) return;
    if (!this._changed('truck', x)) return;
    const tr = this.loops.truck || (this.loops.truck = this._buildTruck());
    const now = this.ctx.currentTime;
    const f = 26 + 16 * x; // closer = revving harder
    tr.fire.frequency.setTargetAtTime(f, now, 0.3);
    tr.sub.frequency.setTargetAtTime(f, now, 0.3);
    tr.harm.frequency.setTargetAtTime(f * 2, now, 0.3);
    tr.am.frequency.setTargetAtTime(f, now, 0.3);
    tr.lp.frequency.setTargetAtTime(260 + 1300 * x * x, now, 0.3);
    tr.out.gain.setTargetAtTime(0.75 * Math.pow(x, 1.3), now, 0.15);
  }

  /** Fade every loop out (used when the engine is disposed). */
  silenceAll() {
    const now = this.ctx.currentTime;
    for (const l of Object.values(this.loops)) l.out.gain.setTargetAtTime(0, now, 0.05);
    this.last = {};
  }

  dispose() {
    for (const l of Object.values(this.loops)) {
      for (const nd of l.nodes) {
        try { if (nd.stop) nd.stop(); } catch (e) { /* ignore */ }
        try { nd.disconnect(); } catch (e) { /* ignore */ }
      }
    }
    this.loops = {};
  }
}
