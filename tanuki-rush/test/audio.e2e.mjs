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
    const cdp = await context.newCDPSession(page);
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
