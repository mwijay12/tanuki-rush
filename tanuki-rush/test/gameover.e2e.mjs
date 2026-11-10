// Exercises crash/revive/retry in the offline bundle shipped inside the APK.
// Browser touch events cannot replace a physical Android WebView playthrough.
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

for (const [orientation, viewport] of [
  ['portrait', { width: 412, height: 915 }],
  ['landscape', { width: 915, height: 412 }],
]) test(`bundled game (${orientation}): crash, one free revive, fall and retry`, { timeout: 180_000 }, async () => {
  const server = await serveBundle();
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    });
    const context = await browser.newContext({ viewport, screen: viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => { localStorage.setItem('tanuki_intro', '1'); });
    await page.goto(`http://127.0.0.1:${server.address().port}/?debug&q=low`, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 60_000 });
    await page.locator('[data-start]').tap();
    await page.waitForFunction(() => window.__game?.state === 'countdown', null, { timeout: 30_000 });
    await page.evaluate(() => { window.__game.debugPaused = true; window.__game.simulate(3.2); });
    assert.equal(await page.evaluate(() => window.__game.state), 'play');

    // Activate an actual checkpoint, then collide with a parked car while
    // carrying leaves. Make the goal share that position to test collision
    // priority: a fatal hit must not accidentally finish or award the run.
    const before = await page.evaluate(() => {
      const g = window.__game, p = g.player;
      const cp = g.objects.checkpoints[0];
      p.reset(cp.s, { board: g.level.main.zoneName(cp.s) === 'board' });
      p.invuln = 2;
      g.objects.prevPC = null;
      g.objects.update(0, p, g.camera);
      const leaf = g.objects.leaves.findIndex((l) => l.s > cp.s + 5);
      const enemy = g.objects.enemies.findIndex((e) => e.s > cp.s + 5);
      const ring = 0;
      const goneCar = g.objects.cars.findIndex((c) => c.s > cp.s + 100);
      g.objects.leaves[leaf].alive = false;
      g.objects.enemies[enemy].alive = false;
      g.objects.rings[ring].awarded = true;
      g.objects.cars[goneCar].state = 'gone';
      g.objects.score = 1200;
      g.runTime = 33;
      g.leavesCollected = 18;
      g.enemiesDown = 2;
      g.events.emit('truckDown'); // bonus may not be paid again after rewind
      const car = g.objects.cars.find((c) => c.s > cp.s + 10 && c.state === 'parked');
      p.reset(car.s, { board: g.level.main.zoneName(car.s) === 'board', x: car.x });
      p.leaves = 12;
      p.boostGauge = 0.33;
      const expected = { score: g.objects.score, time: g.runTime, leaves: p.leaves, boost: p.boostGauge,
        collected: g.leavesCollected, enemies: g.enemiesDown, checkpoint: g.checkpoint.s,
        save: JSON.stringify(g.save), leaf, enemy, ring, goneCar };
      const goal = g.level.goalS;
      g.level.goalS = car.s;
      g.objects.prevPC = null;
      g.objects.update(0, p, g.camera);
      g.level.goalS = goal;
      return { ...expected, state: g.state, playerState: p.state, deaths: g.deaths };
    });
    assert.equal(before.state, 'crashing', 'a car should crash even with leaves');
    assert.equal(before.playerState, 'dead');
    assert.equal(before.deaths, 1);
    assert.equal(before.score, 3200);
    assert.ok(before.checkpoint > 0, 'checkpoint was activated through the real object update');
    await page.evaluate(() => window.__game.simulate(5));
    let current = await page.evaluate(() => {
      const g = window.__game;
      return { state: g.state, time: g.runTime, score: g.objects.score, save: JSON.stringify(g.save),
        finished: g.finishedRun, touchOn: g.hud.touchEl.classList.contains('on') };
    });
    assert.deepEqual(current, { state: 'gameover', time: before.time, score: before.score, save: before.save, finished: null, touchOn: false },
      'the run freezes without a completion award or automatic respawn');
    assert.equal(await page.locator('.gameover').getAttribute('role'), 'dialog');
    assert.equal(await page.locator('[data-gameover=revive]').isVisible(), true);
    assert.match(await page.locator('.gameover').innerText(), /ONE FREE REVIVE/);

    // Each button must be large enough, on-screen and not obscured by the old
    // steering layer. Playwright tap then exercises actual touch events.
    for (const action of ['revive', 'retry', 'title']) {
      const selector = `[data-gameover=${action}]`;
      const box = await page.locator(selector).boundingBox();
      assert.ok(box && box.width >= 48 && box.height >= 48, `${selector} should have a 48px touch target`);
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height,
        `${selector} should fit the ${orientation} screen: ${JSON.stringify(box)}`);
      assert.equal(await page.evaluate(({ x, y, selector }) => !!document.elementFromPoint(x, y)?.closest(selector),
        { x: box.x + box.width / 2, y: box.y + box.height / 2, selector }), true, `${selector} should not be covered`);
    }

    await page.locator('[data-gameover=revive]').tap();
    current = await page.evaluate((old) => {
      const g = window.__game;
      const duplicateTruckScore = g.objects.score;
      g.events.emit('truckDown');
      return { state: g.state, position: g.player.mainS, invuln: g.player.invuln,
        score: g.objects.score, duplicateTruckScore, time: g.runTime, leaves: g.player.leaves, boost: g.player.boostGauge,
        collected: g.leavesCollected, enemies: g.enemiesDown, revivesUsed: g.revivesUsed,
        leafAlive: g.objects.leaves[old.leaf].alive, enemyAlive: g.objects.enemies[old.enemy].alive,
        ringAwarded: g.objects.rings[old.ring].awarded, carState: g.objects.cars[old.goneCar].state,
        touchOn: g.hud.touchEl.classList.contains('on'), secondRevive: g.revive(),
        music: g.audio.music.info.music };
    }, before);
    assert.equal(current.state, 'play');
    assert.equal(current.position, before.checkpoint);
    assert.ok(current.invuln >= 2, 'revival includes a short collision grace period');
    assert.equal(current.score, before.score);
    assert.equal(current.score, current.duplicateTruckScore, 'the truck bonus cannot be paid twice');
    assert.equal(current.time, before.time);
    assert.equal(current.leaves, before.leaves);
    assert.equal(current.boost, before.boost);
    assert.equal(current.collected, before.collected);
    assert.equal(current.enemies, before.enemies);
    assert.equal(current.revivesUsed, 1);
    assert.equal(current.leafAlive, false);
    assert.equal(current.enemyAlive, false);
    assert.equal(current.ringAwarded, true);
    assert.equal(current.carState, 'gone');
    assert.equal(current.touchOn, true);
    assert.equal(current.secondRevive, false, 'repeat taps cannot create extra revives');
    assert.equal(current.music, 'stage');

    // Revisiting an already-awarded ring still launches, but cannot pay twice.
    const ringCheck = await page.evaluate((old) => {
      const g = window.__game, p = g.player, r = g.objects.rings[old.ring];
      for (const other of g.objects.rings) other.cool = 100;
      r.cool = 0;
      p.reset(r.s, { board: false, x: r.x || 0 });
      p.invuln = 2.2;
      r.pos.copy(p.pos);
      g.objects.prevPC = null;
      let triggered = 0;
      const off = g.events.on('dashRing', () => triggered++);
      const score = g.objects.score;
      g.objects.update(0, p, g.camera);
      off();
      return { triggered, before: score, after: g.objects.score };
    }, before);
    assert.equal(ringCheck.triggered, 1);
    assert.equal(ringCheck.after, ringCheck.before, 'the same ring does not pay a second time');

    // Fail by falling while BOOST is held; both held touch and the loop must
    // be released. A second failure shows only retry/title, with no auto-revive.
    await page.evaluate((old) => {
      const g = window.__game;
      g.player.reset(old.checkpoint, { board: false });
      g.player.leaves = old.leaves;
      g.player.boostGauge = 0.5;
    }, before);
    const cdp = await context.newCDPSession(page);
    const boostBox = await page.locator('.tbtn.boost').boundingBox();
    assert.ok(boostBox);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: boostBox.x + boostBox.width / 2, y: boostBox.y + boostBox.height / 2 }] });
    await page.evaluate(() => window.__game.frame(1 / 60, true));
    assert.equal(await page.evaluate(() => window.__game.player.boosting), true);
    const failState = await page.evaluate(() => {
      const g = window.__game;
      g.player.die('fall');
      return { state: g.state, boostLoop: g.audio._want.boost, touchBoost: g.input.touch.boost };
    });
    assert.deepEqual(failState, { state: 'crashing', boostLoop: false, touchBoost: false });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.evaluate(() => window.__game.simulate(5));
    assert.equal(await page.evaluate(() => window.__game.state), 'gameover');
    assert.equal(await page.locator('[data-gameover=revive]').count(), 0);
    assert.match(await page.locator('.gameover').innerText(), /REVIVE USED/);
    assert.equal(await page.evaluate(() => window.__game.revive()), false);
    assert.equal(await page.evaluate(() => JSON.stringify(window.__game.save)), before.save, 'failed runs award no completion rewards');

    await page.locator('[data-gameover=retry]').tap();
    await page.waitForFunction(() => window.__game.state === 'countdown', null, { timeout: 30_000 });
    current = await page.evaluate((old) => {
      const g = window.__game;
      return { position: g.player.mainS, start: g.level.startS, score: g.objects.score, time: g.runTime,
        leaves: g.player.leaves, revivesUsed: g.revivesUsed, leafAlive: g.objects.leaves[old.leaf].alive,
        enemyAlive: g.objects.enemies[old.enemy].alive, ringAwarded: g.objects.rings[old.ring].awarded,
        carState: g.objects.cars[old.goneCar].state, truckBonusAwarded: g.truckBonusAwarded,
        boostLoop: g.audio._want.boost };
    }, before);
    assert.equal(current.position, current.start);
    assert.deepEqual({ score: current.score, time: current.time, leaves: current.leaves, revivesUsed: current.revivesUsed },
      { score: 0, time: 0, leaves: 0, revivesUsed: 0 });
    assert.equal(current.leafAlive, true);
    assert.equal(current.enemyAlive, true);
    assert.equal(current.ringAwarded, false);
    assert.equal(current.carState, 'parked');
    assert.equal(current.truckBonusAwarded, false);
    assert.equal(current.boostLoop, false);

    // A truck collision uses the same rules, and a fresh run has a fresh revive.
    const truckCrash = await page.evaluate(() => {
      const g = window.__game;
      g.simulate(3.2);
      const p = g.player, tr = g.truck;
      p.leaves = 9;
      p.invuln = 0;
      tr.state = 'chase'; tr.s = p.mainS - 9; tr.x = p.mainX; tr.hitCool = 0;
      tr.update(0, p);
      return { state: g.state, playerState: p.state, deaths: g.deaths };
    });
    assert.deepEqual(truckCrash, { state: 'crashing', playerState: 'dead', deaths: 1 });
    await page.evaluate(() => window.__game.simulate(2));
    assert.equal(await page.locator('[data-gameover=revive]').isVisible(), true, 'a new run restores the free revive');
    await page.locator('[data-gameover=retry]').tap(); // decline the available revive
    await page.waitForFunction(() => window.__game.state === 'countdown', null, { timeout: 30_000 });
    assert.equal(await page.evaluate(() => window.__game.revivesUsed), 0);

    // Keyboard activation must honor the focused choice, not silently spend
    // the default revive when Enter is pressed on TITLE or RETRY.
    await page.evaluate(() => {
      const g = window.__game;
      g.simulate(3.2);
      g.player.die('fall');
      g.simulate(2);
    });
    await page.locator('[data-gameover=title]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.__game.state), 'title');

    // A revived run is still a valid completion: the frozen run should record
    // one miss and receive its normal finish reward exactly once.
    await page.locator('[data-start]').tap();
    await page.waitForFunction(() => window.__game.state === 'countdown', null, { timeout: 30_000 });
    const tokensBefore = await page.evaluate(() => {
      const g = window.__game;
      g.simulate(3.2);
      g.runTime = 45;
      g.objects.score = 1600;
      g.player.leaves = 20;
      g.leavesCollected = 20;
      g.player.die('fall');
      g.simulate(2);
      return g.save.tokens;
    });
    await page.locator('[data-gameover=revive]').tap();
    const finish = await page.evaluate(() => {
      const g = window.__game;
      g.player.reset(g.level.goalS, { board: false });
      g.player.invuln = 2.2;
      g.objects.prevPC = null;
      g.objects.update(0, g.player, g.camera);
      const frozen = g.finishedRun && { ...g.finishedRun };
      g.simulate(3.4);
      const tokens = g.save.tokens;
      g._results(); // repeat calls must not pay again
      return { state: g.state, frozen, tokens, afterSecondResults: g.save.tokens };
    });
    assert.equal(finish.state, 'results');
    assert.equal(finish.frozen.deaths, 1);
    assert.equal(finish.frozen.time, 45);
    assert.equal(finish.frozen.collected, 20);
    assert.ok(finish.tokens > tokensBefore, 'a completed revived run earns its finish reward');
    assert.equal(finish.afterSecondResults, finish.tokens, 'completion rewards are not duplicated');
    assert.deepEqual(errors, [], `no uncaught browser errors: ${errors.join('; ')}`);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
