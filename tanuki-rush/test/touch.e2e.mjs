// Exercises the shipped, bundled game with real browser touch/pointer events.
// This complements, but cannot replace, the Android WebView settings test and
// testing the APK on a physical device.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const webRoot = fileURLToPath(new URL('../../mobile/assets/web/', import.meta.url));
const mime = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2',
};

async function serveBundle() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const pathname = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
      const filename = path.resolve(webRoot, '.' + pathname);
      if (!filename.startsWith(webRoot) || !(await stat(filename)).isFile()) throw new Error('not found');
      res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream' });
      res.end(await readFile(filename));
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

for (const [orientation, viewport] of [
  ['portrait', { width: 412, height: 915 }],
  ['landscape', { width: 915, height: 412 }],
]) test(`bundled game (${orientation}): steering, multitouch, jump and pause/resume`, { timeout: 180_000 }, async () => {
  const server = await serveBundle();
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    });
    const context = await browser.newContext({
      viewport,
      screen: viewport,
      deviceScaleFactor: 2.75,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('tanuki_intro', '1');
      // Exercise settings with the additional native-only reminder row.
      window.flutter_inappwebview = { callHandler: () => Promise.resolve(null) };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/?debug&q=low`, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 60_000 });
    await page.locator('[data-start]').tap();
    await page.waitForFunction(() => window.__game?.state === 'countdown', null, { timeout: 60_000 });
    // Enter play deterministically without waiting for the animated countdown.
    await page.evaluate(() => {
      window.__game.state = 'play';
      window.__game.hud.clearMessage();
      window.__game.debugPaused = true;
    });
    const cdp = await context.newCDPSession(page);
    const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    const p = (id, x, y) => ({ id, x, y });
    const frames = async (n) => page.evaluate((count) => {
      for (let i = 0; i < count; i++) window.__game.frame(1 / 60, true);
    }, n);
    const state = () => page.evaluate(() => ({
      steer: window.__game.input.touch.steer,
      boost: window.__game.input.touch.boost,
      jump: window.__game.input.touch.jump,
      x: window.__game.player.x,
      jumpState: window.__game.player.state,
      boosting: window.__game.player.boosting,
      gameState: window.__game.state,
      touchHidden: !window.__game.hud.touchEl.classList.contains('on'),
      scrollX: window.scrollX, scrollY: window.scrollY,
    }));
    const center = async (selector) => {
      const box = await page.locator(selector).boundingBox();
      assert.ok(box, `missing ${selector}`);
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };

    // Start near the TOP of the left half: the entire left half is a drag zone.
    const initial = await state();
    await touch('touchStart', [p(0, 95, 100)]);
    await touch('touchMove', [p(0, 165, 100)]);
    assert.equal((await state()).steer, 1, 'dragging right should steer right');
    await frames(18);
    assert.ok((await state()).x > initial.x + 0.5, 'dragging right should move the player');

    // A second finger must not steal the active steering pointer.
    await touch('touchStart', [p(0, 165, 100), p(2, 90, 350)]);
    await touch('touchMove', [p(0, 165, 100), p(2, 30, 350)]);
    assert.equal((await state()).steer, 1, 'another finger on the pad should not replace steering');
    await touch('touchEnd', []);
    assert.equal((await state()).steer, 0, 'lifting fingers should center steering');
    await touch('touchStart', [p(5, 95, 100)]);
    await touch('touchMove', [p(5, 155, 100)]);
    await touch('touchCancel', []);
    // CDP can acknowledge the cancellation before the renderer dispatches its
    // pointercancel event, especially during software WebGL rendering.
    await page.waitForFunction(() => window.__game.input.touch.steer === 0, null, { timeout: 5_000 });
    assert.equal((await state()).steer, 0, 'a canceled gesture should center steering');

    // Start the opposite-direction check from rest so lateral inertia from
    // the previous right turn cannot mask the resulting movement.
    await page.evaluate(() => window.__game.resetRun());
    const boost = await center('.tbtn.boost');
    await touch('touchStart', [p(0, 120, 350)]);
    await touch('touchMove', [p(0, 55, 350)]);
    const beforeLeft = await state();
    assert.equal(beforeLeft.steer, -1, 'dragging left should steer left');
    await touch('touchStart', [p(0, 55, 350), p(1, boost.x, boost.y)]);
    assert.equal((await state()).boost, true, 'boost must work while steering with another finger');
    await frames(18);
    const afterLeft = await state();
    assert.ok(afterLeft.x < beforeLeft.x - 0.5, `dragging left should move the player (${JSON.stringify({ beforeLeft, afterLeft })})`);
    assert.equal(afterLeft.boosting, true, 'held boost should activate in the game');
    await touch('touchEnd', []);
    assert.equal((await state()).steer, 0);
    assert.equal((await state()).boost, false);

    const jump = await center('.tbtn.jump');
    await page.touchscreen.tap(jump.x, jump.y);
    await frames(1);
    assert.equal((await state()).jumpState, 'air', 'a jump tap should reach the player');
    assert.equal((await state()).jump, false, 'jump should not remain held after release');

    // Pause while a finger is steering: controls must reset and menu buttons
    // must remain tappable even though the drag zone covers the left half.
    await touch('touchStart', [p(0, 120, 150)]);
    await touch('touchMove', [p(0, 180, 150)]);
    const pause = await center('.tbtn.pausebtn');
    await touch('touchStart', [p(0, 180, 150), p(1, pause.x, pause.y)]);
    await touch('touchEnd', [p(0, 180, 150)]);
    await frames(1);
    let current = await state();
    assert.equal(current.gameState, 'paused', 'pause button should open the menu');
    assert.equal(current.touchHidden, true, 'touch layer must not cover pause buttons');
    assert.equal(current.steer, 0, 'pausing must release held steering');
    await touch('touchEnd', []);
    await page.locator('[data-a=settings]').tap();
    assert.equal(await page.locator('[data-sensval]').isVisible(), true, 'settings should open while paused');
    await page.locator('[data-reset-audio]').tap();
    await page.waitForFunction(() => document.querySelector('[data-reset-audio]')?.textContent === 'DONE', null, { timeout: 30_000 });
    assert.equal((await state()).gameState, 'paused', 'resetting audio should not resume the run');
    await page.locator('.settings:not(.credits):not(.intro) [data-close]').tap();
    assert.equal(await page.locator('[data-sensval]').isVisible(), false, 'back should return to pause');
    await page.locator('[data-a=resume]').tap();
    current = await state();
    assert.equal(current.gameState, 'play', 'resume button should return to the game');
    assert.equal(current.touchHidden, false, 'touch controls should return after resume');

    await touch('touchStart', [p(3, 100, 100)]);
    await touch('touchMove', [p(3, 160, 100)]);
    assert.equal((await state()).steer, 1, 'steering should work again after pause');
    await touch('touchEnd', []);
    current = await state();
    assert.equal(current.steer, 0);
    assert.equal(current.scrollX, 0, 'touch controls must not scroll horizontally');
    assert.equal(current.scrollY, 0, 'touch controls must not scroll vertically');

    // Restarting from pause while BOOST is held must clear the old audio loop,
    // not carry its sound into the countdown or next run.
    const boostAgain = await center('.tbtn.boost');
    await touch('touchStart', [p(6, boostAgain.x, boostAgain.y)]);
    await frames(1);
    assert.equal((await state()).boosting, true);
    assert.equal(await page.evaluate(() => window.__game.audio._want.boost), true);
    const pauseAgain = await center('.tbtn.pausebtn');
    await touch('touchStart', [p(6, boostAgain.x, boostAgain.y), p(7, pauseAgain.x, pauseAgain.y)]);
    await touch('touchEnd', [p(6, boostAgain.x, boostAgain.y)]);
    await frames(1);
    assert.equal((await state()).gameState, 'paused');
    await touch('touchEnd', []);
    await page.locator('[data-a=restart]').tap();
    await page.waitForFunction(() => window.__game.state === 'countdown', null, { timeout: 30_000 });
    assert.equal(await page.evaluate(() => window.__game.audio._want.boost), false);
    assert.equal(await page.evaluate(() => window.__game.player.boosting), false);
    assert.equal(await page.evaluate(() => window.__game.input.touch.boost), false);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
