// Test real Web Audio in the same offline bundle shipped inside the APK.
// The deliberate suspend/close calls simulate failures; only a physical phone
// can confirm what happens on the user's Android WebView and audio hardware.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const webRoot = fileURLToPath(new URL('../../mobile/assets/web/', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };

async function serveBundle() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const pathname = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
      const filename = path.resolve(webRoot, '.' + pathname);
      if (!filename.startsWith(webRoot) || !(await stat(filename)).isFile()) throw new Error('not found');
      res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream' });
      res.end(await readFile(filename));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

test('bundled game produces music and effects after audio interruption and reset', { timeout: 180_000 }, async () => {
  const server = await serveBundle();
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    });
    const context = await browser.newContext({
      viewport: { width: 915, height: 412 }, screen: { width: 915, height: 412 },
      deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('tanuki_intro', '1');
      // Include the native-only reminder row when checking the settings layout.
      window.flutter_inappwebview = { callHandler: () => Promise.resolve(null) };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/?debug&q=low`, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 60_000 });
    await page.locator('[data-start]').tap();
    await page.waitForFunction(() => window.__game?.state === 'countdown', null, { timeout: 60_000 });
    await page.evaluate(() => { window.__game.debugPaused = true; window.__game.simulate(3.2); });
    await page.waitForFunction(() => {
      const g = window.__game;
      return g.state === 'play' && g.audio.ready && g.audio.ctx.state === 'running' && g.audio.music.info.music === 'stage';
    }, null, { timeout: 30_000 });

    // Capture real float samples from the game's Web Audio graph, not just
    // its state flags. Each tap is replaced when a context is rebuilt.
    const monitor = (node) => page.evaluate((name) => {
      window.__audioProbe?.stop();
      const a = window.__game.audio;
      const source = name.split('.').reduce((value, key) => value[key], a);
      const analyser = a.ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const probe = { peak: 0 };
      probe.timer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        for (const value of samples) probe.peak = Math.max(probe.peak, Math.abs(value));
      }, 20);
      probe.stop = () => {
        clearInterval(probe.timer);
        try { source.disconnect(analyser); } catch (_) { /* old context may be closed */ }
      };
      window.__audioProbe = probe;
    }, node);
    // Tap the named one-shot voice itself: ambient wind/other effects must not
    // accidentally make a silent JUMP or BOOST look successful.
    const monitorEffect = (name) => page.evaluate((wanted) => {
      window.__audioProbe?.stop();
      const audio = window.__game.audio;
      const analyser = audio.ctx.createAnalyser();
      analyser.fftSize = 1024;
      const samples = new Float32Array(analyser.fftSize);
      const sources = [];
      const probe = { peak: 0, started: false };
      const originalPlay = audio.play;
      audio.play = function (effect, ...args) {
        const previous = this._voices.at(-1);
        const result = originalPlay.call(this, effect, ...args);
        const voice = this._voices.at(-1);
        if (effect === wanted && voice && voice !== previous && voice.name === wanted) {
          probe.started = true;
          voice.out.connect(analyser);
          sources.push(voice.out);
        }
        return result;
      };
      probe.timer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        for (const value of samples) probe.peak = Math.max(probe.peak, Math.abs(value));
      }, 20);
      probe.stop = () => {
        clearInterval(probe.timer);
        audio.play = originalPlay;
        for (const source of sources) {
          try { source.disconnect(analyser); } catch (_) { /* voice may already be gone */ }
        }
      };
      window.__audioProbe = probe;
    }, name);
    const waitForSignal = async (label) => {
      await page.waitForFunction(() => window.__audioProbe?.peak > 0.002, null, { timeout: 12_000 });
      const peak = await page.evaluate(() => window.__audioProbe.peak);
      assert.ok(peak > 0.002, `${label} should generate audible samples (peak=${peak})`);
    };

    await monitor('musicVol');
    await waitForSignal('stage music');
    await monitor('pauseGain');
    await waitForSignal('master output');

    // Watch music, the real BOOST loop and the post-limiter output at the same
    // time. The worklet records on the audio thread, so it can detect gaps even
    // while the main thread is deliberately stalled. This exercises the bundled
    // graph, but cannot prove what the Pixel's speaker/WebView hardware outputs.
    const baselineStart = await page.evaluate(async () => {
      const a = window.__game.audio;
      const code = `
        class MixMeter extends AudioWorkletProcessor {
          constructor(options) {
            super(); this.key = options.processorOptions.key;
            this.sum = 0; this.peak = 0; this.count = 0; this.bad = 0;
          }
          process(inputs) {
            const channels = inputs[0];
            const length = channels[0]?.length || 128;
            for (let i = 0; i < length; i++) {
              let value = 0;
              for (const c of channels) value += c[i] / channels.length;
              if (!Number.isFinite(value)) { this.bad++; value = 0; }
              this.sum += value * value;
              this.peak = Math.max(this.peak, Math.abs(value));
              this.count++;
            }
            if (this.count >= sampleRate * 0.1) {
              this.port.postMessage({ key: this.key, time: currentTime, rms: Math.sqrt(this.sum / this.count), peak: this.peak, bad: this.bad });
              this.sum = 0; this.peak = 0; this.count = 0; this.bad = 0;
            }
            return true;
          }
        }
        registerProcessor('mix-meter', MixMeter);`;
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      try { await a.ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      const silent = a.ctx.createGain();
      silent.gain.value = 0;
      silent.connect(a.ctx.destination);
      const probe = { data: [], nodes: [], silent };
      probe.add = (key, source) => {
        const meter = new AudioWorkletNode(a.ctx, 'mix-meter', { processorOptions: { key } });
        meter.port.onmessage = (event) => probe.data.push(event.data);
        source.connect(meter);
        meter.connect(silent);
        probe.nodes.push({ source, meter });
      };
      probe.stop = () => {
        for (const { source, meter } of probe.nodes) {
          try { source.disconnect(meter); meter.disconnect(); meter.port.close(); } catch (_) { /* old device */ }
        }
        silent.disconnect();
      };
      probe.add('music', a.musicVol);
      probe.add('output', a.limiter);
      window.__mixProbe = probe;
      window.__mixContext = a.ctx;
      return a.ctx.currentTime;
    });
    await page.waitForTimeout(2300);
    const baselineEnd = await page.evaluate(() => window.__game.audio.ctx.currentTime);
    const cdp = await context.newCDPSession(page);
    const mixBox = await page.locator('.tbtn.boost').boundingBox();
    assert.ok(mixBox, 'boost touch button is present');
    const boostPoint = [{ id: 3, x: mixBox.x + mixBox.width / 2, y: mixBox.y + mixBox.height / 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: boostPoint });
    const boostStart = await page.evaluate(() => {
      const g = window.__game;
      g.frame(1 / 60, true);
      window.__mixProbe.add('boost', g.audio.loops.loops.boost.out);
      return g.audio.ctx.currentTime;
    });
    assert.equal(await page.evaluate(() => window.__game.player.boosting), true, 'the held touch starts BOOST');
    await page.waitForTimeout(1300);
    // A 220 ms rendering/GC pause should be covered by the music lookahead.
    await page.evaluate(() => { const end = performance.now() + 220; while (performance.now() < end) { /* simulate a busy frame */ } });
    await page.waitForTimeout(1700);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const boostEnd = await page.evaluate(() => {
      const g = window.__game;
      g.frame(1 / 60, true);
      return g.audio.ctx.currentTime;
    });
    assert.equal(await page.evaluate(() => window.__game.player.boosting), false);
    await page.waitForTimeout(1500);
    const afterEnd = await page.evaluate(() => window.__game.audio.ctx.currentTime);

    // Repeated quick presses should not poison the graph or leave BOOST stuck.
    for (let i = 0; i < 3; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: boostPoint });
      await page.evaluate(() => window.__game.frame(1 / 60, true));
      assert.equal(await page.evaluate(() => window.__game.player.boosting), true, `quick BOOST press ${i + 1} starts`);
      await page.waitForTimeout(300);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.evaluate(() => window.__game.frame(1 / 60, true));
      assert.equal(await page.evaluate(() => window.__game.player.boosting), false, `quick BOOST press ${i + 1} releases`);
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(500);
    const repeatEnd = await page.evaluate(() => window.__game.audio.ctx.currentTime);

    // Also exercise the running game with its real render loop and BOOST visual
    // effects, rather than only holding the audio loop in a frozen simulation.
    const liveStart = await page.evaluate(() => {
      const g = window.__game;
      g.player.reset(g.level.startS, { board: true });
      g.player.boostGauge = 1;
      g.player.invuln = 5;
      g.objects.clearTransient();
      window.__liveRunTime = g.runTime;
      g.debugPaused = false;
      return g.audio.ctx.currentTime;
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: boostPoint });
    await page.waitForFunction(() => window.__game.player.boosting, null, { timeout: 20_000 });
    await page.waitForTimeout(1800);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const live = await page.evaluate(() => {
      const g = window.__game;
      g.debugPaused = true;
      g.frame(1 / 60, true);
      return { end: g.audio.ctx.currentTime, elapsed: g.runTime - window.__liveRunTime, state: g.state, boosting: g.player.boosting };
    });
    assert.ok(live.elapsed > 0.1, 'gameplay actually advanced with rendering enabled');
    assert.equal(live.state, 'play');
    assert.equal(live.boosting, false);
    await page.waitForTimeout(850);
    const mix = await page.evaluate(() => {
      const a = window.__game.audio;
      const value = { data: window.__mixProbe.data, end: a.ctx.currentTime, state: a.ctx.state, sameContext: a.ctx === window.__mixContext, boostWanted: a._want.boost };
      window.__mixProbe.stop();
      return value;
    });
    assert.equal(mix.state, 'running');
    assert.equal(mix.sameContext, true);
    assert.equal(mix.boostWanted, false);
    const samples = (key, from, to) => mix.data.filter((s) => s.key === key && s.time > from && s.time < to);
    const average = (arr) => arr.reduce((sum, s) => sum + s.rms, 0) / arr.length;
    const checkSignal = (key, from, to, label) => {
      const values = samples(key, from + 0.3, to - 0.1);
      assert.ok(values.length >= (to - from - 0.4) * 6, `${label}: enough audio-thread samples (${values.length})`);
      assert.equal(values.reduce((sum, s) => sum + s.bad, 0), 0, `${label}: no invalid samples`);
      assert.ok(average(values) > 0.005, `${label}: audible average RMS`);
      let quiet = 0, longestQuiet = 0;
      for (const value of values) {
        quiet = value.rms < 0.001 ? quiet + 1 : 0;
        longestQuiet = Math.max(longestQuiet, quiet);
      }
      assert.ok(longestQuiet < 4, `${label}: no prolonged silent gap (${longestQuiet} bins)`);
      return values;
    };
    const baselineMusic = checkSignal('music', baselineStart, baselineEnd, 'music before BOOST');
    checkSignal('output', baselineStart, baselineEnd, 'output before BOOST');
    const heldMusic = checkSignal('music', boostStart, boostEnd, 'music while BOOST is held');
    checkSignal('output', boostStart, boostEnd, 'output while BOOST is held');
    const heldBoost = checkSignal('boost', boostStart, boostEnd, 'held BOOST effect');
    checkSignal('music', boostEnd, afterEnd, 'music after BOOST');
    checkSignal('output', boostEnd, afterEnd, 'output after BOOST');
    checkSignal('music', afterEnd, repeatEnd, 'music through repeated BOOST taps');
    checkSignal('output', afterEnd, repeatEnd, 'output through repeated BOOST taps');
    checkSignal('music', liveStart, live.end, 'music during rendered BOOST gameplay');
    checkSignal('output', liveStart, live.end, 'output during rendered BOOST gameplay');
    const boostTail = samples('boost', mix.end - 0.35, mix.end);
    assert.ok(boostTail.length > 0 && average(boostTail) < 0.003, 'BOOST loop fades away after release');
    assert.ok(average(heldBoost) < average(heldMusic) * 0.8,
      `BOOST should not drown out music (loop=${average(heldBoost).toFixed(3)}, music=${average(heldMusic).toFixed(3)})`);
    assert.ok(average(heldMusic) > average(baselineMusic) * 0.25, 'stage music remains present during BOOST');

    // Simulate an OS/WebView suspension without another user gesture.
    await page.evaluate(() => { window.__oldContext = window.__game.audio.ctx; return window.__oldContext.suspend(); });
    await page.waitForFunction(() => window.__game.audio.ctx === window.__oldContext && window.__oldContext.state === 'running', null, { timeout: 10_000 });
    await monitor('musicVol');
    await waitForSignal('music after suspension');

    // A closed device cannot be resumed: the engine must recreate the graph.
    await page.evaluate(() => window.__oldContext.close());
    await page.waitForFunction(() => {
      const a = window.__game.audio;
      return a.ready && a.ctx !== window.__oldContext && a.ctx.state === 'running' && a.music.info.music === 'stage';
    }, null, { timeout: 30_000 });
    await monitor('musicVol');
    await waitForSignal('music after device replacement');
    await monitor('pauseGain');
    await waitForSignal('master output after device replacement');

    // Verify actual touch inputs reach gameplay and produce their own samples.
    await monitorEffect('jump');
    await page.locator('.tbtn.jump').tap();
    await page.evaluate(() => window.__game.frame(1 / 60, true));
    assert.equal(await page.evaluate(() => window.__game.player.state), 'air');
    assert.equal(await page.evaluate(() => window.__audioProbe.started), true, 'jump voice was created');
    await waitForSignal('jump effect after device replacement');

    await monitorEffect('boostStart');
    const box = await page.locator('.tbtn.boost').boundingBox();
    assert.ok(box, 'boost button is present');
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ id: 1, x: box.x + box.width / 2, y: box.y + box.height / 2 }],
    });
    await page.evaluate(() => window.__game.frame(1 / 60, true));
    assert.equal(await page.evaluate(() => window.__game.player.boosting), true, 'held boost activates gameplay');
    assert.equal(await page.evaluate(() => window.__audioProbe.started), true, 'boost voice was created');
    await waitForSignal('boost start effect after device replacement');
    await monitor('loops.loops.boost.out');
    await waitForSignal('held boost loop after device replacement');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.evaluate(() => window.__game.frame(1 / 60, true));
    assert.equal(await page.evaluate(() => window.__game.player.boosting), false);

    // Jump near the end of the score: the stage song should loop back to A.
    await page.evaluate(() => {
      const pb = window.__game.audio.music.current;
      pb.seq.step = pb.song.totalBars * 16 - 2;
      pb.seq.t0 = pb.ctx.currentTime + 0.03 - pb.seq.step * pb.song.stepDur;
      pb.seq.tick();
    });
    await page.waitForFunction(() => {
      const music = window.__game.audio.music;
      return music.info.music === 'stage' && music.current.seq.running && music.info.section === 'A';
    }, null, { timeout: 10_000 });

    // Manual fallback is accessible while paused, without losing the run.
    const runBeforeReset = await page.evaluate(() => {
      const g = window.__game;
      g.pause();
      window.__oldContext = g.audio.ctx;
      return { time: g.runTime, position: g.player.mainS, score: g.objects.score, boost: g.player.boostGauge };
    });
    await page.waitForFunction(() => window.__game.audio.ctx.state === 'suspended', null, { timeout: 10_000 });
    await page.locator('[data-a=settings]').tap();
    await page.locator('[data-reset-audio]').tap();
    await page.waitForFunction(() => document.querySelector('[data-reset-audio]')?.textContent === 'DONE', null, { timeout: 30_000 });
    const paused = await page.evaluate(() => ({
      newContext: window.__game.audio.ctx !== window.__oldContext,
      audioState: window.__game.audio.ctx.state,
      gameState: window.__game.state,
      music: window.__game.audio.music.info.music,
      muted: window.__game.audio._muted,
    }));
    assert.deepEqual(paused, { newContext: true, audioState: 'suspended', gameState: 'paused', music: 'stage', muted: false });
    const runAfterReset = await page.evaluate(() => {
      const g = window.__game;
      return { time: g.runTime, position: g.player.mainS, score: g.objects.score, boost: g.player.boostGauge };
    });
    assert.deepEqual(runAfterReset, runBeforeReset, 'audio reset should not restart or change the run');
    await page.locator('.settings:not(.credits):not(.intro) [data-close]').tap();
    await page.locator('[data-a=resume]').tap();
    await page.waitForFunction(() => window.__game.state === 'play' && window.__game.audio.ctx.state === 'running', null, { timeout: 10_000 });
    await monitor('musicVol');
    await waitForSignal('music after manual reset and resume');
    await monitor('pauseGain');
    await waitForSignal('master output after manual reset and resume');

    // Recovery must never turn a user's intentional mute back on.
    await page.evaluate(() => {
      const a = window.__game.audio;
      a.setMuted(true);
      window.__oldContext = a.ctx;
      return a.ctx.close();
    });
    await page.waitForFunction(() => {
      const a = window.__game.audio;
      return a.ready && a.ctx !== window.__oldContext && a.ctx.state === 'running' && a.music.info.music === 'stage';
    }, null, { timeout: 30_000 });
    assert.equal(await page.evaluate(() => window.__game.audio._muted), true);
    await monitor('pauseGain');
    await page.waitForTimeout(700);
    assert.ok(await page.evaluate(() => window.__audioProbe.peak) < 0.0001, 'recovery should preserve mute');
    await page.evaluate(() => window.__game.audio.setMuted(false));
    await waitForSignal('music after the player unmutes');
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
