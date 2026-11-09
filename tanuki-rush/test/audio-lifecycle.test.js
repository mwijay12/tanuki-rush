import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../src/audio/AudioEngine.js';

// Exercise recovery decisions without a physical sound device. The browser
// integration test separately checks that real Web Audio samples are produced.
class FakeAudioContext extends EventTarget {
  static instances = [];
  constructor() {
    super();
    this.state = 'running';
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.resumeCalls = 0;
    this.deferSuspend = false;
    FakeAudioContext.instances.push(this);
  }
  change(state) { this.state = state; this.dispatchEvent(new Event('statechange')); }
  resume() { this.resumeCalls++; this.change('running'); return Promise.resolve(); }
  suspend() {
    if (this.deferSuspend) return new Promise((resolve) => {
      this.finishSuspend = () => { this.change('suspended'); resolve(); };
    });
    this.change('suspended');
    return Promise.resolve();
  }
  close() { this.change('closed'); return Promise.resolve(); }
}

function gain(value) {
  return { gain: { value, setTargetAtTime(v) { this.value = v; } } };
}

function setup(t) {
  const saved = { AudioContext: globalThis.AudioContext, window: globalThis.window, document: globalThis.document };
  FakeAudioContext.instances = [];
  globalThis.AudioContext = FakeAudioContext;
  globalThis.window = new EventTarget();
  globalThis.document = new EventTarget();
  globalThis.document.hidden = false;
  const engine = new AudioEngine();
  engine._build = function () {
    this.pauseGain = gain(this._paused ? 0 : 1);
    this.masterGain = gain(this._muted ? 0 : this._vol.master);
    this.musicVol = gain(this._vol.music);
    this.sfxVol = gain(this._vol.sfx);
    this.music = {
      current: null, intensity: 0,
      setIntensity(x) { this.intensity = x; },
      play(name) { this.current = name; },
      stop() { this.current = null; },
      dispose() { this.disposed = true; },
      get info() { return { music: this.current }; },
    };
    this.loops = {
      setWind(x) { this.wind = x; }, setGrind(active, x) { this.grind = [active, x]; },
      setBoost(active) { this.boost = active; }, setTruck(x) { this.truck = x; },
      dispose() { this.disposed = true; },
    };
  };
  t.after(async () => {
    await engine.dispose();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  });
  return engine;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('an unexpected suspension resumes automatically, but a real pause stays silent', async (t) => {
  const audio = setup(t);
  await audio.init();
  audio.playMusic('stage');
  const ctx = audio.ctx;
  await ctx.suspend();
  assert.equal(ctx.state, 'running');
  assert.equal(ctx.resumeCalls, 1);
  assert.equal(audio.music.current, 'stage');

  audio.pause();
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(ctx.state, 'suspended');
  assert.equal(ctx.resumeCalls, 1, 'health checks must not undo a deliberate pause');
  globalThis.window.dispatchEvent(new Event('pointerdown'));
  assert.equal(ctx.state, 'suspended');
  audio.resume();
  await tick();
  assert.equal(ctx.state, 'running');
  assert.equal(audio.pauseGain.gain.value, 1);
});

test('visible and native-resume events recover audio without overriding a hidden page', async (t) => {
  const audio = setup(t);
  await audio.init();
  const ctx = audio.ctx;
  globalThis.document.hidden = true;
  await ctx.suspend();
  assert.equal(ctx.state, 'suspended');
  globalThis.window.dispatchEvent(new Event('tanuki:app-resumed'));
  assert.equal(ctx.state, 'suspended', 'must not grab audio while hidden');
  globalThis.document.hidden = false;
  globalThis.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(ctx.state, 'running');
});

test('a later user gesture can retry a resume promise that remains pending', async (t) => {
  const audio = setup(t);
  await audio.init();
  const ctx = audio.ctx;
  ctx.resume = function () {
    this.resumeCalls++;
    if (this.resumeCalls === 1) return new Promise(() => {});
    this.change('running');
    return Promise.resolve();
  };
  ctx.change('suspended');
  assert.equal(ctx.state, 'suspended');
  globalThis.window.dispatchEvent(new Event('pointerdown'));
  assert.equal(ctx.state, 'running');
  assert.equal(ctx.resumeCalls, 2);
});

test('a foreground event cannot suppress an immediately following unlock gesture', async (t) => {
  const audio = setup(t);
  await audio.init();
  const ctx = audio.ctx;
  ctx.resume = function () {
    this.resumeCalls++;
    if (this.resumeCalls < 3) return new Promise(() => {});
    this.change('running');
    return Promise.resolve();
  };
  ctx.change('suspended'); // automatic resume is held pending by the browser
  globalThis.window.dispatchEvent(new Event('tanuki:app-resumed')); // also pending
  globalThis.window.dispatchEvent(new Event('pointerdown')); // must retain user activation
  assert.equal(ctx.resumeCalls, 3);
  assert.equal(ctx.state, 'running');
});

test('a closed audio context is recreated with the current music, controls and mute state', async (t) => {
  const audio = setup(t);
  await audio.init();
  audio.playMusic('stage');
  audio.setMusicIntensity(0.7);
  audio.setWind(0.6);
  audio.setBoost(true);
  audio.setMasterVolume(0.5);
  audio.setMuted(true);
  const old = audio.ctx;
  await old.close();
  if (audio._resetPromise) await audio._resetPromise;
  await tick();
  assert.notEqual(audio.ctx, old);
  assert.equal(audio.ctx.state, 'running');
  assert.equal(audio.music.current, 'stage');
  assert.equal(audio.music.intensity, 0.7);
  assert.equal(audio.loops.wind, 0.6);
  assert.equal(audio.loops.boost, true);
  assert.equal(audio._vol.master, 0.5);
  assert.equal(audio._muted, true);
  assert.equal(audio.masterGain.gain.value, 0, 'recovery must not unmute the user');
});

test('reset while paused remains paused and resumes music only when the player resumes', async (t) => {
  const audio = setup(t);
  await audio.init();
  audio.playMusic('stage');
  audio.pause();
  const old = audio.ctx;
  assert.equal(await audio.reset(), true);
  assert.notEqual(audio.ctx, old);
  assert.equal(audio._paused, true);
  assert.equal(audio.ctx.state, 'suspended');
  assert.equal(audio.pauseGain.gain.value, 0);
  assert.equal(audio.music.current, 'stage');
  audio.resume();
  await tick();
  assert.equal(audio.ctx.state, 'running');
  assert.equal(audio.pauseGain.gain.value, 1);
});

test('pausing while a reset is in flight also keeps the replacement context paused', async (t) => {
  const audio = setup(t);
  await audio.init();
  audio.playMusic('stage');
  const old = audio.ctx;
  let finishClose;
  old.close = () => new Promise((resolve) => { finishClose = () => { old.change('closed'); resolve(); }; });
  const resetting = audio.reset();
  audio.pause();
  finishClose();
  assert.equal(await resetting, true);
  assert.notEqual(audio.ctx, old);
  assert.equal(audio._paused, true);
  assert.equal(audio.ctx.state, 'suspended');
  assert.equal(audio.pauseGain.gain.value, 0);
});

test('a late suspend after a quick pause/resume cannot strand audio', async (t) => {
  const audio = setup(t);
  await audio.init();
  audio.playMusic('stage');
  const ctx = audio.ctx;
  ctx.deferSuspend = true;
  audio.pause();
  await new Promise((resolve) => setTimeout(resolve, 110));
  assert.equal(typeof ctx.finishSuspend, 'function');
  audio.resume();
  ctx.finishSuspend();
  await tick();
  assert.equal(ctx.state, 'running');
  assert.equal(audio._paused, false);
});

test('a genuinely stalled running clock is rebuilt; hidden and muted audio is left alone', async (t) => {
  const audio = setup(t);
  await audio.init();
  audio.playMusic('stage');
  const old = audio.ctx;
  globalThis.document.hidden = true;
  audio._checkAudio(false, 1000);
  audio._checkAudio(false, 20_000);
  assert.equal(audio.ctx, old);
  globalThis.document.hidden = false;
  audio.setMuted(true);
  audio._checkAudio(false, 21_000);
  audio._checkAudio(false, 30_000);
  assert.equal(audio.ctx, old);
  audio.setMuted(false);
  audio._clock = null; // use the synthetic wall clock consistently below
  audio._checkAudio(false, 31_000);
  old.currentTime = 1;
  audio._checkAudio(false, 39_000);
  assert.equal(audio.ctx, old, 'a moving audio clock must not be reset');
  audio._checkAudio(false, 46_999);
  assert.equal(audio.ctx, old);
  audio._checkAudio(false, 47_000);
  if (audio._resetPromise) await audio._resetPromise;
  assert.notEqual(audio.ctx, old);
  assert.equal(audio.music.current, 'stage');
});

test('a failed replacement is retried with backoff instead of leaving audio permanently dead', async (t) => {
  const audio = setup(t);
  await audio.init();
  audio.playMusic('stage');
  const build = audio._build;
  let attempt = 0;
  audio._warned['init failed'] = true;
  audio._build = function () {
    attempt++;
    if (attempt === 1) throw new Error('device temporarily unavailable');
    build.call(this);
    if (attempt === 2) this.music.play = () => { throw new Error('restoring music failed'); };
  };
  assert.equal(await audio.reset(), false);
  assert.equal(audio.ready, false);
  assert.equal(audio.ctx, null);
  audio._checkAudio(false, 10_000);
  assert.equal(await audio._resetPromise, false);
  assert.equal(audio.ready, false, 'partially built graph must be released');
  assert.equal(audio.ctx, null);
  const attempts = FakeAudioContext.instances.length;
  audio._checkAudio(false, 14_999);
  assert.equal(FakeAudioContext.instances.length, attempts, 'background retries are rate-limited');
  audio._checkAudio(false, 15_000);
  assert.equal(await audio._resetPromise, true);
  assert.equal(audio.ctx.state, 'running');
  assert.equal(audio.music.current, 'stage');
});

test('a pending reset cannot resurrect an engine after dispose', async (t) => {
  const audio = setup(t);
  await audio.init();
  const ctx = audio.ctx;
  let finishClose;
  ctx.close = () => new Promise((resolve) => { finishClose = () => { ctx.change('closed'); resolve(); }; });
  const resetting = audio.reset();
  await audio.dispose();
  finishClose();
  assert.equal(await resetting, false);
  assert.equal(audio.ctx, null);
  globalThis.window.dispatchEvent(new Event('pointerdown'));
  await tick();
  assert.equal(FakeAudioContext.instances.length, 1);
});
