// AudioEngine.js — public entry point of the TANUKI RUSH audio system.
//
// 100% procedural Web Audio: no audio files, no libraries, no network.
//
//   const audio = new AudioEngine();
//   button.addEventListener('click', () => audio.init());   // must follow a user gesture
//   audio.playMusic('stage'); audio.play('leaf', { pitch: 1.2 });
//
// Every method is a safe no-op before init() (or when Web Audio is missing) and
// never throws. Volumes / mute / music choice / loop states requested before
// init() are remembered and applied once the context exists.
//
// Signal flow
//   music playbacks -> musicIn -> musicComp -> musicVol --\
//   music reverb send -> convolver --------------> musicVol  >-> master -> pauseGain -> limiter -> out
//   sfx voices + loops -> sfxIn --------------------> sfxVol --/
//   sfx reverb send -> convolver -------------------> sfxVol

import { MusicSystem } from './music.js';
import { SFX, SFX_NAMES, SFX_LIMITS, SFX_GAIN } from './sfx.js';
import { Voice } from './voice.js';
import { LoopBank } from './loops.js';
import {
  clamp, num, makeNoiseBuffer, makeImpulseResponse, makeDriveCurve, makeCrunchCurve,
  renderDrumKit, toAudioBuffers,
} from './dsp.js';

const MUSIC_NAMES = ['title', 'stage'];
const JINGLE_NAMES = ['clear', 'fail'];
const MAX_SFX_VOICES = 32;

function warnOnce(engine, key, err) {
  if (engine._warned[key]) return;
  engine._warned[key] = true;
  if (typeof console !== 'undefined') console.warn(`[audio] ${key}`, err);
}

export class AudioEngine {
  static SFX_NAMES = SFX_NAMES;
  static MUSIC_NAMES = MUSIC_NAMES;
  static JINGLE_NAMES = JINGLE_NAMES;

  constructor() {
    /** true once init() has built the audio graph. */
    this.ready = false;
    this.ctx = null;
    this._vol = { master: 0.8, music: 0.7, sfx: 0.9 };
    this._muted = false;
    this._paused = false;
    this._want = { music: null, intensity: 0, wind: 0, grind: [false, 0.5], boost: false, truck: 0 };
    this._voices = [];
    this._initPromise = null;
    this._pauseTimer = null;
    this._warned = {};
    this._unlock = null;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Create (first call) or resume (later calls) the AudioContext.
   * Call it from a user gesture (click / key / touch) to satisfy autoplay policies.
   * Resolves to true when audio is available, false otherwise. Never rejects.
   */
  init() {
    if (this.ready) return this._resumeCtx().then(() => true);
    if (!this._initPromise) {
      this._initPromise = this._init().catch((err) => {
        warnOnce(this, 'init failed', err);
        this._initPromise = null;
        return false;
      });
    }
    return this._initPromise;
  }

  async _init() {
    const g = typeof globalThis !== 'undefined' ? globalThis : {};
    const AC = g.AudioContext || g.webkitAudioContext;
    if (!AC) return false;
    let ctx;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch (e) {
      ctx = new AC();
    }
    this.ctx = ctx;
    this._build();
    this.ready = true;
    this._installUnlock();
    this._applyWanted();
    await this._resumeCtx();
    return true;
  }

  /** Build the bus graph and pre-render shared buffers (drums, noise, reverb IR). */
  _build() {
    const ctx = this.ctx;
    const gain = (v) => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };

    // Master: volume/mute -> pause fader -> brick-wall-ish limiter -> speakers
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2.5;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;
    this.limiter.connect(ctx.destination);
    this.pauseGain = gain(1);
    this.pauseGain.connect(this.limiter);
    this.masterGain = gain(this._muted ? 0 : this._vol.master);
    this.masterGain.connect(this.pauseGain);

    // Music bus with gentle glue compression
    this.musicVol = gain(this._vol.music);
    this.musicVol.connect(this.masterGain);
    this.musicComp = ctx.createDynamicsCompressor();
    this.musicComp.threshold.value = -10;
    this.musicComp.knee.value = 8;
    this.musicComp.ratio.value = 3;
    this.musicComp.attack.value = 0.015;
    this.musicComp.release.value = 0.2;
    this.musicComp.connect(this.musicVol);
    // Input trim: DynamicsCompressorNode adds automatic makeup gain (~+3.5 dB with these
    // settings), and the music should sit a little under the SFX.
    this.musicIn = gain(0.5);
    this.musicIn.connect(this.musicComp);

    // SFX bus
    this.sfxVol = gain(this._vol.sfx);
    this.sfxVol.connect(this.masterGain);
    this.sfxIn = gain(1);
    this.sfxIn.connect(this.sfxVol);

    // Shared buffers
    this.noise = makeNoiseBuffer(ctx, 2);
    this.kit = toAudioBuffers(ctx, renderDrumKit(ctx.sampleRate));
    this.curves = { drive: makeDriveCurve(2.5), crunch: makeCrunchCurve(6) };
    const ir = makeImpulseResponse(ctx, 1.5, 2.8);

    // Small reverbs (sends) for music and SFX
    const verb = (dest, level) => {
      const input = gain(1);
      const conv = ctx.createConvolver();
      conv.buffer = ir;
      const ret = gain(level);
      input.connect(conv);
      conv.connect(ret);
      ret.connect(dest);
      return input;
    };
    this.musicRevIn = verb(this.musicVol, 0.5);
    this.sfxRevIn = verb(this.sfxVol, 0.45);

    this.music = new MusicSystem(ctx, { out: this.musicIn, reverb: this.musicRevIn, kit: this.kit });
    this.loops = new LoopBank(ctx, this.sfxIn, this.noise, this.curves);
  }

  /** Resume on any later user gesture too (autoplay policies, iOS interruptions). */
  _installUnlock() {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    this._unlock = () => {
      const ctx = this.ctx;
      if (!ctx || this._paused || ctx.state === 'running' || ctx.state === 'closed') return;
      try {
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* ignore */ }
    };
    for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, this._unlock, true);
  }

  _resumeCtx() {
    const ctx = this.ctx;
    if (!ctx || this._paused || ctx.state === 'running' || ctx.state === 'closed') return Promise.resolve();
    let p;
    try {
      p = ctx.resume();
    } catch (e) {
      return Promise.resolve();
    }
    // resume() may stay pending until a user gesture happens: never block the caller on it.
    return Promise.race([
      Promise.resolve(p).catch(() => {}),
      new Promise((r) => setTimeout(r, 300)),
    ]);
  }

  /** Apply everything that was requested before init(). */
  _applyWanted() {
    const w = this._want;
    this.music.setIntensity(w.intensity);
    if (w.music) this.music.play(w.music);
    this.loops.setWind(w.wind);
    this.loops.setGrind(w.grind[0], w.grind[1]);
    this.loops.setBoost(w.boost);
    this.loops.setTruck(w.truck);
  }

  /** Close the AudioContext and release everything (e.g. on hot reload). */
  async dispose() {
    if (!this.ctx) return;
    try {
      this.music.dispose();
      this.loops.dispose();
      if (this._unlock && typeof window !== 'undefined') {
        for (const ev of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(ev, this._unlock, true);
      }
      await this.ctx.close();
    } catch (e) { /* ignore */ }
    this.ctx = null;
    this.ready = false;
    this._initPromise = null;
  }

  // -------------------------------------------------------------------------
  // Volume
  // -------------------------------------------------------------------------

  _ramp(node, value, tc = 0.03) {
    if (!this.ctx || !node) return;
    try {
      node.gain.setTargetAtTime(value, this.ctx.currentTime, tc);
    } catch (e) { warnOnce(this, 'gain ramp failed', e); }
  }

  /** Master volume, 0..1 (linear gain). */
  setMasterVolume(v) {
    this._vol.master = clamp(num(v, this._vol.master));
    this._ramp(this.masterGain, this._muted ? 0 : this._vol.master);
  }

  setMusicVolume(v) {
    this._vol.music = clamp(num(v, this._vol.music));
    this._ramp(this.musicVol, this._vol.music);
  }

  setSfxVolume(v) {
    this._vol.sfx = clamp(num(v, this._vol.sfx));
    this._ramp(this.sfxVol, this._vol.sfx);
  }

  setMuted(muted) {
    this._muted = !!muted;
    this._ramp(this.masterGain, this._muted ? 0 : this._vol.master, 0.02);
  }

  // -------------------------------------------------------------------------
  // Music
  // -------------------------------------------------------------------------

  /** 'title' | 'stage'. Crossfades from the current music; no-op if already playing. */
  playMusic(name) {
    if (!MUSIC_NAMES.includes(name)) return;
    this._want.music = name;
    if (!this.ready) return;
    try { this.music.play(name); } catch (e) { warnOnce(this, 'playMusic failed', e); }
  }

  stopMusic(fadeSeconds = 0.5) {
    this._want.music = null;
    if (!this.ready) return;
    try { this.music.stop(clamp(num(fadeSeconds, 0.5), 0, 10)); } catch (e) { warnOnce(this, 'stopMusic failed', e); }
  }

  /** 0..1. Stage music gains hats / arpeggio / percussion layers and guitar drive (applied per beat). */
  setMusicIntensity(x) {
    this._want.intensity = clamp(num(x, 0));
    if (this.ready) this.music.setIntensity(this._want.intensity);
  }

  /** 'clear' (victory fanfare, ~5 s) | 'fail' (short sting). Stops the current music first. */
  playJingle(name) {
    if (!this.ready || !JINGLE_NAMES.includes(name)) return;
    this._want.music = null;
    try { this.music.playJingle(name); } catch (e) { warnOnce(this, 'playJingle failed', e); }
  }

  // -------------------------------------------------------------------------
  // One-shot SFX
  // -------------------------------------------------------------------------

  /**
   * Play a sound effect.
   * @param {string} name one of AudioEngine.SFX_NAMES
   * @param {{volume?: number, pitch?: number, pan?: number}} [opts]
   */
  play(name, opts = {}) {
    if (!this.ready || this._paused) return;
    const build = SFX[name];
    const ctx = this.ctx;
    if (!build || !ctx || ctx.state !== 'running') return;
    try {
      const o = opts || {};
      const volume = clamp(num(o.volume, 1));
      if (volume <= 0.0001) return;
      const now = ctx.currentTime;
      this._reap(now);
      this._steal(name, now);
      const v = new Voice(ctx, this.sfxIn, {
        t: now,
        pitch: clamp(num(o.pitch, 1), 0.25, 4),
        volume: volume * (SFX_GAIN[name] || 1),
        pan: clamp(num(o.pan, 0), -1, 1),
        noise: this.noise,
        kit: this.kit,
        revBus: this.sfxRevIn,
        curves: this.curves,
      });
      v.name = name;
      build(v);
      v.finish();
      this._voices.push(v);
    } catch (e) {
      warnOnce(this, `sfx "${name}" failed`, e);
    }
  }

  _reap(now) {
    if (this._voices.length) this._voices = this._voices.filter((v) => v.end > now);
  }

  /** Voice limiting: per-effect cap (e.g. 6 leaves) plus a global cap. Oldest voices fade out. */
  _steal(name, now) {
    const limit = SFX_LIMITS[name] || 3;
    const same = this._voices.filter((v) => v.name === name && !v.killed);
    for (let i = 0; i <= same.length - limit; i++) same[i].kill(now);
    const alive = this._voices.filter((v) => !v.killed);
    for (let i = 0; i <= alive.length - MAX_SFX_VOICES; i++) alive[i].kill(now);
  }

  // -------------------------------------------------------------------------
  // Continuous loops
  // -------------------------------------------------------------------------

  /** 0..1 rushing wind driven by player speed (0 = silent). */
  setWind(x) {
    this._want.wind = clamp(num(x, 0));
    if (this.ready) this._loop('setWind', this._want.wind);
  }

  /** Metallic rail grind on/off; x = speed 0..1 (pitch / brightness). */
  setGrind(active, x = 0.5) {
    this._want.grind = [!!active, clamp(num(x, 0.5))];
    if (this.ready) this._loop('setGrind', ...this._want.grind);
  }

  /** Boost jet roar while boosting. */
  setBoost(active) {
    this._want.boost = !!active;
    if (this.ready) this._loop('setBoost', this._want.boost);
  }

  /** 0..1 proximity of the chasing truck (diesel rumble, 0 = silent). */
  setTruck(x) {
    this._want.truck = clamp(num(x, 0));
    if (this.ready) this._loop('setTruck', this._want.truck);
  }

  _loop(method, ...args) {
    try { this.loops[method](...args); } catch (e) { warnOnce(this, `${method} failed`, e); }
  }

  // -------------------------------------------------------------------------
  // Pause
  // -------------------------------------------------------------------------

  /** Game pause: fade out quickly, then suspend the whole AudioContext. */
  pause() {
    if (!this.ctx || this._paused) return;
    this._paused = true;
    const ctx = this.ctx;
    this._ramp(this.pauseGain, 0, 0.015);
    clearTimeout(this._pauseTimer);
    this._pauseTimer = setTimeout(() => {
      if (!this._paused || ctx.state !== 'running') return;
      try {
        const p = ctx.suspend();
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* ignore */ }
    }, 90);
  }

  resume() {
    if (!this.ctx || !this._paused) return;
    this._paused = false;
    clearTimeout(this._pauseTimer);
    const ctx = this.ctx;
    const fadeIn = () => {
      if (!this._paused) this._ramp(this.pauseGain, 1, 0.02);
    };
    if (ctx.state === 'running') {
      fadeIn();
      return;
    }
    try {
      Promise.resolve(ctx.resume()).then(fadeIn, fadeIn);
    } catch (e) {
      fadeIn();
    }
  }

  // -------------------------------------------------------------------------
  // Debug
  // -------------------------------------------------------------------------

  /** Snapshot for dev tools: context state, current song position, active voices. */
  getDebugInfo() {
    if (!this.ready) return { ready: false };
    return {
      ready: true,
      state: this.ctx.state,
      time: this.ctx.currentTime,
      sampleRate: this.ctx.sampleRate,
      paused: this._paused,
      ...this.music.info,
      sfxVoices: this._voices.filter((v) => !v.killed && v.end > this.ctx.currentTime).length,
    };
  }
}

export default AudioEngine;
