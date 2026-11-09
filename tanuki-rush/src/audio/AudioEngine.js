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
    this._visibilityHandler = null;
    this._stateHandler = null;
    this._healthTimer = null;
    this._clock = null;
    this._resumeAttempt = null;
    this._lastRecoveryRetry = -Infinity;
    this._resetPromise = null;
    this._generation = 0;
    this._disposed = false;
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
    this._disposed = false;
    if (this.ready) return this._resumeCtx().then(() => true);
    if (!this._initPromise) {
      const initializing = this._init().catch((err) => {
        warnOnce(this, 'init failed', err);
        return false;
      });
      this._initPromise = initializing;
      initializing.then((ok) => {
        if (!ok && this._initPromise === initializing) this._initPromise = null;
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
    try {
      this._build();
      this.ready = true;
      this._installUnlock();
      this._installRecovery(ctx);
      this._applyWanted();
      if (this._paused) {
        // A manual reset can be requested from Settings while the game is paused.
        // Do not let the newly created graph play until the game resumes.
        if (ctx.state === 'running') {
          try {
            const suspending = Promise.resolve(ctx.suspend()).catch(() => {});
            await new Promise((resolve) => {
              const timer = setTimeout(resolve, 300);
              suspending.then(() => { clearTimeout(timer); resolve(); });
            });
          } catch (_) { /* the pause gain is still zero */ }
        }
      } else {
        await this._resumeCtx();
      }
      return true;
    } catch (err) {
      // A partially built device must not stay marked ready; otherwise the
      // health check cannot retry if restoring the music or loops failed.
      if (this.ctx === ctx) await this._releaseContext();
      throw err;
    }
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
    this.pauseGain = gain(this._paused ? 0 : 1);
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

  /** Later gestures can unlock a context that the browser would not auto-resume. */
  _installUnlock() {
    if (this._unlock || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    this._unlock = () => this._checkAudio(true);
    for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, this._unlock, true);
  }

  _installRecovery(ctx) {
    // An Android WebView can suspend or close its audio device independently of
    // the game. The old engine only tried to resume on a new finger-down, and
    // could never recover a closed context at all.
    this._stateHandler = () => {
      if (this.ctx !== ctx || !this.ready) return;
      if (ctx.state === 'running') {
        this._clock = null;
        if (!this._paused) this._ramp(this.pauseGain, 1, 0.02);
      } else {
        this._checkAudio();
      }
    };
    if (ctx.addEventListener) ctx.addEventListener('statechange', this._stateHandler);
    else ctx.onstatechange = this._stateHandler;

    if (!this._visibilityHandler) {
      this._visibilityHandler = () => { this._clock = null; this._checkAudio(true); };
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this._visibilityHandler);
      if (typeof window !== 'undefined') window.addEventListener('tanuki:app-resumed', this._visibilityHandler);
    }
    if (this._healthTimer === null) this._healthTimer = setInterval(() => this._checkAudio(), 2000);
  }

  /** Check state and the audio clock only while the game is visible and unpaused. */
  _checkAudio(forceResume = false, now = typeof performance !== 'undefined' ? performance.now() : Date.now()) {
    const ctx = this.ctx;
    if (this._disposed || this._paused || (typeof document !== 'undefined' && document.hidden)) {
      this._clock = null;
      return;
    }
    if (!this.ready || !ctx) {
      this._clock = null;
      // If rebuilding failed temporarily, keep trying. The health timer exists
      // only after audio was previously initialized; avoid a tight failure loop.
      if (this._healthTimer !== null && !this._resetPromise && !this._initPromise &&
          (forceResume || now - this._lastRecoveryRetry >= 5000)) {
        this._lastRecoveryRetry = now;
        void this.reset();
      }
      return;
    }
    if (ctx.state === 'closed') {
      this._clock = null;
      void this.reset();
      return;
    }
    if (ctx.state !== 'running') {
      this._clock = null;
      void this._resumeCtx(forceResume);
      return;
    }
    // Some WebViews can report "running" even though their audio clock has
    // stopped. Rebuild only after a prolonged stall during audible music;
    // intentional mute, pause, hidden tabs and track transitions are exempt.
    if (!this._want.music || this._muted || this._vol.master <= 0) {
      this._clock = null;
      return;
    }
    const t = ctx.currentTime;
    if (!this._clock || this._clock.ctx !== ctx || t > this._clock.time + 0.01) {
      this._clock = { ctx, time: t, advancedAt: now };
    } else if (now - this._clock.advancedAt >= 8000) {
      this._clock = null;
      void this.reset();
    }
  }

  _resumeCtx(force = false) {
    const ctx = this.ctx;
    if (!ctx || this._disposed || this._paused || ctx.state === 'running' || ctx.state === 'closed' ||
        (typeof document !== 'undefined' && document.hidden)) return Promise.resolve();
    // A browser can leave resume() pending until a user gesture. Do not pile up
    // background requests, but let a fresh gesture retry even if one is pending.
    if (this._resumeAttempt && !force) return Promise.resolve();
    // A genuine user gesture must not be suppressed by a recent lifecycle
    // event: some browsers require that very gesture to unlock audio.
    let p;
    try { p = ctx.resume(); } catch (_) { return Promise.resolve(); }
    const attempt = Promise.resolve(p).catch(() => {});
    this._resumeAttempt = attempt;
    attempt.then(() => { if (this._resumeAttempt === attempt) this._resumeAttempt = null; });
    // Never block callers if autoplay policy holds the promise open.
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 300);
      attempt.then(() => { clearTimeout(timer); resolve(); });
    });
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

  /** Recreate a dead audio device without restarting the game or changing settings. */
  reset() {
    if (this._disposed) return Promise.resolve(false);
    if (this._resetPromise) return this._resetPromise;
    const generation = this._generation;
    const reset = (async () => {
      await this._releaseContext();
      if (this._disposed || generation !== this._generation) return false;
      return this.init(); // _want, mute, volumes and paused state are preserved
    })().catch((err) => { warnOnce(this, 'audio reset failed', err); return false; });
    this._resetPromise = reset;
    reset.then(() => { if (this._resetPromise === reset) this._resetPromise = null; });
    return reset;
  }

  async _releaseContext() {
    const ctx = this.ctx;
    this.ctx = null; // Ignore late statechange callbacks from the old device.
    this.ready = false;
    this._initPromise = null;
    this._clock = null;
    this._resumeAttempt = null;
    clearTimeout(this._pauseTimer);
    this._pauseTimer = null;
    if (ctx && this._stateHandler) {
      if (ctx.removeEventListener) ctx.removeEventListener('statechange', this._stateHandler);
      else if (ctx.onstatechange === this._stateHandler) ctx.onstatechange = null;
    }
    this._stateHandler = null;
    try { this.music?.dispose(); } catch (_) { /* best effort */ }
    try { this.loops?.dispose(); } catch (_) { /* best effort */ }
    this.music = null;
    this.loops = null;
    this._voices = [];
    if (ctx && ctx.state !== 'closed') {
      try {
        const closing = Promise.resolve(ctx.close()).catch(() => {});
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 1000);
          closing.then(() => { clearTimeout(timer); resolve(); });
        });
      } catch (_) { /* A broken device must not prevent creating a replacement. */ }
    }
  }

  /** Close the AudioContext and release everything (e.g. on hot reload). */
  async dispose() {
    this._disposed = true;
    this._generation += 1; // Do not resurrect an in-flight reset after disposal.
    clearInterval(this._healthTimer);
    this._healthTimer = null;
    if (this._unlock && typeof window !== 'undefined') {
      for (const ev of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(ev, this._unlock, true);
    }
    if (this._visibilityHandler) {
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this._visibilityHandler);
      if (typeof window !== 'undefined') window.removeEventListener('tanuki:app-resumed', this._visibilityHandler);
    }
    this._unlock = null;
    this._visibilityHandler = null;
    await this._releaseContext();
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
    if (!this._muted) this._checkAudio(true);
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
    if (this._paused) return;
    this._paused = true;
    this._clock = null;
    const ctx = this.ctx;
    if (!ctx) return; // A reset already in progress will build a silent, paused graph.
    this._ramp(this.pauseGain, 0, 0.015);
    clearTimeout(this._pauseTimer);
    this._pauseTimer = setTimeout(() => {
      this._pauseTimer = null;
      if (!this._paused || this.ctx !== ctx || ctx.state !== 'running') return;
      try {
        const p = ctx.suspend();
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* ignore */ }
    }, 90);
  }

  resume() {
    if (!this._paused) { this._checkAudio(true); return; }
    this._paused = false;
    clearTimeout(this._pauseTimer);
    this._pauseTimer = null;
    const ctx = this.ctx;
    if (!ctx) return; // An in-flight reset reads the new paused state.
    if (ctx.state === 'closed') { void this.reset(); return; }
    const fadeIn = () => {
      if (!this._paused && this.ctx === ctx) this._ramp(this.pauseGain, 1, 0.02);
    };
    if (ctx.state === 'running') fadeIn();
    else this._resumeCtx(true).then(fadeIn);
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
