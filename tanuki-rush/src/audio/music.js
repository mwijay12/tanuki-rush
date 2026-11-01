// music.js — plays compiled songs: one Playback per running song/jingle,
// crossfades between them, and blends intensity layers into the stage track.

import { compileSong } from './compile.js';
import { SONGS, JINGLES, PATTERNS } from './songs.js';
import { Sequencer } from './sequencer.js';
import { DrumKit, Bass, Guitar, Lead, Bell, Pluck, Pad, EPiano, Brass, makeGain } from './instruments.js';
import { clamp, smoothstep } from './dsp.js';

// Channel levels (songs can override any of these in their `mix` field).
const DEFAULT_MIX = {
  drums: 0.8, bass: 0.3, gtr: 0.11, lead: 0.5, lead2: 0.28, bell: 0.32, bellLead: 0.8,
  arp: 0.35, pad: 0.2, ep: 0.2, stab: 0.2, leadCut: 1,
};

/** Smoothly move a gain param to 0 from whatever value it currently has. */
function rampToZero(param, now, sec) {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(now);
  } else {
    const v = param.value;
    param.cancelScheduledValues(now);
    param.setValueAtTime(v, now);
  }
  param.linearRampToValueAtTime(0, now + Math.max(0.02, sec));
}

// ---------------------------------------------------------------------------
// Playback: one running instance of a song (its own mix bus, instruments, sequencer)
// ---------------------------------------------------------------------------

class Playback {
  constructor(sys, song) {
    const ctx = sys.ctx;
    this.sys = sys;
    this.ctx = ctx;
    this.song = song;
    this.mix = { ...DEFAULT_MIX, ...song.mix };
    this.inst = {};
    this.layerLevel = {};
    this.layerHold = {};
    this.drive = 0;
    this.stopping = false;
    this.stopAt = Infinity;
    this.disposed = false;
    this.position = { section: '', bar: 0 };

    // Per-playback bus: dry out, reverb send (shared convolver), tempo-synced delay.
    this.out = makeGain(ctx, 0);
    this.out.connect(sys.out);
    this.revSend = makeGain(ctx, 1);
    this.revSend.connect(sys.reverb);
    this.dlyIn = makeGain(ctx, 1);
    const delay = ctx.createDelay(2);
    delay.delayTime.value = Math.min(1.9, song.stepDur * 3); // dotted eighth
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 3200;
    const dhp = ctx.createBiquadFilter();
    dhp.type = 'highpass';
    dhp.frequency.value = 350;
    const fb = makeGain(ctx, 0.3);
    const wet = makeGain(ctx, 0.8);
    this.dlyIn.connect(delay);
    delay.connect(dlp);
    dlp.connect(dhp);
    dhp.connect(fb);
    fb.connect(delay);
    dhp.connect(wet);
    wet.connect(this.out);
    this.busNodes = [this.out, this.revSend, this.dlyIn, delay, dlp, dhp, fb, wet];
    this.bus = { out: this.out, rev: this.revSend, dly: this.dlyIn };
  }

  /** Instruments are created lazily, the first time the score uses them. */
  get(name) {
    let inst = this.inst[name];
    if (inst) return inst;
    const { ctx, bus, mix } = this;
    switch (name) {
      case 'drums': inst = new DrumKit(ctx, this.sys.kit, bus, mix.drums); break;
      case 'bass': inst = new Bass(ctx, bus, mix.bass); break;
      case 'gtr': inst = new Guitar(ctx, bus, mix.gtr); break;
      case 'lead': inst = new Lead(ctx, bus, { level: mix.lead, cut: mix.leadCut }); break;
      case 'lead2': inst = new Lead(ctx, bus, { level: mix.lead2, pan: 0.2, rev: 0.25, dly: 0.12, cut: mix.leadCut * 0.85 }); break;
      case 'bell': inst = new Bell(ctx, bus, { level: mix.bell }); break;
      case 'bellLead': inst = new Bell(ctx, bus, { level: mix.bellLead, pan: 0.1, rev: 0.35, dly: 0.3 }); break;
      case 'arp': inst = new Pluck(ctx, bus, { level: mix.arp }); break;
      case 'pad': inst = new Pad(ctx, bus, { level: mix.pad }); break;
      case 'ep': inst = new EPiano(ctx, bus, { level: mix.ep }); break;
      case 'stab': inst = new Brass(ctx, bus, { level: mix.stab }); break;
      default: return null;
    }
    if (this.drive && inst.setDrive) inst.setDrive(this.drive, ctx.currentTime);
    this.inst[name] = inst;
    return inst;
  }

  start(t0, fadeIn) {
    const now = this.ctx.currentTime;
    const g = this.out.gain;
    g.setValueAtTime(0, now);
    g.linearRampToValueAtTime(1, Math.max(now + 0.005, t0 + fadeIn));
    this.seq = new Sequencer(this.ctx, this.song.stepDur, (step, time) => this.onStep(step, time));
    this.seq.start(t0);
  }

  /** Global step -> position in the song (handles the loop), or -1 when a jingle has ended. */
  posOf(step) {
    const { song } = this;
    const total = song.totalBars * 16;
    if (step < total) return step;
    if (!song.loop) return -1;
    const loopStart = song.loopBar * 16;
    return loopStart + ((step - loopStart) % (total - loopStart));
  }

  onStep(step, time) {
    if (this.disposed || time >= this.stopAt) return false;
    const pos = this.posOf(step);
    if (pos < 0) {
      // Non-looping song finished: let the tail ring, then clean up.
      const wait = time - this.ctx.currentTime + (this.song.tail || 2);
      setTimeout(() => this.dispose(), Math.max(0, wait) * 1000);
      return false;
    }
    const bar = this.song.bars[pos >> 4];
    const s = pos & 15;
    if (s === 0) this.position = { section: bar.section, bar: bar.index + 1 };
    if (s % 4 === 0) this.applyIntensity(time); // intensity follows on the next beat
    for (const ev of bar.steps[s]) this.trigger(ev, time);
    return true;
  }

  trigger(ev, time) {
    if (ev.L && !this.layerActive(ev.L, time)) return;
    const sd = this.song.stepDur;
    try {
      if (ev.i === 'drum') {
        this.get('drums').play(ev.n, time, ev.v, ev.L);
      } else if (ev.i === 'swell') {
        const buf = this.sys.kit.swell;
        if (buf) this.get('drums').play('swell', time, 1, undefined, Math.max(0, buf.duration - ev.steps * sd));
      } else {
        const inst = this.get(ev.i);
        if (inst) inst.play(ev, time, sd);
      }
    } catch (e) {
      // Never let one bad note kill the scheduler.
      if (!this.warned) console.warn('[audio] note failed', ev, e);
      this.warned = true;
    }
  }

  layerActive(name, time) {
    return (this.layerLevel[name] || 0) > 0.01 || time < (this.layerHold[name] || 0);
  }

  /** Blend intensity layers + guitar/bass drive towards the current intensity. */
  applyIntensity(time) {
    const layers = this.song.layers;
    if (!layers) return;
    const x = this.sys.intensity;
    for (const [name, [a, b]] of Object.entries(layers)) {
      const lvl = x <= a ? 0 : smoothstep(a, b, x);
      const prev = this.layerLevel[name] || 0;
      if (Math.abs(lvl - prev) < 0.002) continue;
      if (lvl < prev) this.layerHold[name] = time + 1.5; // keep notes flowing while fading out
      this.layerLevel[name] = lvl;
      const node = name === 'arp' ? this.get('arp').input : this.get('drums').layer(name);
      node.gain.setTargetAtTime(lvl, time, 0.25);
    }
    if (Math.abs(x - this.drive) > 0.01) {
      this.drive = x;
      for (const k of ['gtr', 'bass']) if (this.inst[k]) this.inst[k].setDrive(x, time);
    }
  }

  fadeOut(sec) {
    if (this.stopping || this.disposed) return;
    this.stopping = true;
    const now = this.ctx.currentTime;
    const fade = Math.max(0.02, sec);
    rampToZero(this.out.gain, now, fade);
    rampToZero(this.revSend.gain, now, fade);
    this.stopAt = now + fade;
    setTimeout(() => this.dispose(), (fade + 0.5) * 1000);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.seq) this.seq.stop();
    for (const inst of Object.values(this.inst)) inst.dispose();
    for (const n of this.busNodes) {
      try { n.disconnect(); } catch (e) { /* ignore */ }
    }
    this.inst = {};
    if (this.sys.current === this) {
      this.sys.current = null;
      this.sys.currentName = null;
    }
  }
}

// ---------------------------------------------------------------------------
// MusicSystem: the public face used by AudioEngine
// ---------------------------------------------------------------------------

export class MusicSystem {
  /**
   * @param {AudioContext} ctx
   * @param {{ out: AudioNode, reverb: AudioNode, kit: Record<string, AudioBuffer> }} io
   */
  constructor(ctx, { out, reverb, kit }) {
    this.ctx = ctx;
    this.out = out;
    this.reverb = reverb;
    this.kit = kit;
    this.cache = {};
    this.current = null;
    this.currentName = null;
    this.intensity = 0;
  }

  static get names() {
    return { music: Object.keys(SONGS), jingles: Object.keys(JINGLES) };
  }

  compiled(name) {
    if (!this.cache[name]) {
      const def = SONGS[name] || JINGLES[name];
      if (!def) return null;
      this.cache[name] = compileSong(def, PATTERNS);
    }
    return this.cache[name];
  }

  /** Start a looping song, crossfading from whatever is playing. No-op if already playing. */
  play(name) {
    if (!SONGS[name]) return;
    const cur = this.current;
    if (cur && !cur.stopping && !cur.disposed && this.currentName === name) return;
    this._start(name, cur ? 0.8 : 0, cur ? 0.25 : 0.01);
  }

  playJingle(name) {
    if (!JINGLES[name]) return;
    this._start(name, name === 'clear' ? 0.35 : 0.25, 0.005);
  }

  _start(name, fadeOld, fadeIn) {
    const song = this.compiled(name);
    if (!song) return;
    if (this.current) this.current.fadeOut(fadeOld);
    const pb = new Playback(this, song);
    this.current = pb;
    this.currentName = name;
    pb.start(this.ctx.currentTime + 0.06, fadeIn);
  }

  stop(fade = 0.5) {
    if (this.current) this.current.fadeOut(fade);
    this.current = null;
    this.currentName = null;
  }

  setIntensity(x) {
    this.intensity = clamp(x);
  }

  get info() {
    const pb = this.current;
    return {
      music: pb && !pb.disposed ? this.currentName : null,
      section: pb ? pb.position.section : '',
      bar: pb ? pb.position.bar : 0,
      intensity: this.intensity,
      skippedSteps: pb && pb.seq ? pb.seq.skipped : 0,
    };
  }

  dispose() {
    if (this.current) this.current.dispose();
    this.current = null;
  }
}
