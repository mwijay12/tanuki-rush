// Exercises the shipped game and native-storage bridge contract in Chromium.
// Android's actual SQLite and Flutter channel are tested separately in CI.
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

async function waitFor(predicate, message) {
  const until = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() >= until) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const launch = () => chromium.launch({
  executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

class NativeBridge {
  constructor() {
    this.entries = {}; this.revision = 0; this.migrated = false;
    this.failWrites = false; this.failBootstrap = false; this.statuses = []; this.details = 0; this.startupErrors = 0;
  }
  apply(journal) {
    if (journal.revision > this.revision) {
      Object.assign(this.entries, journal.entries);
      this.revision = journal.revision;
    }
  }
  async call(name, payload) {
    if (name === 'localStoreBootstrap') {
      if (this.failBootstrap) return { ok: false };
      if (!this.migrated) {
        if (!payload.legacy.valid) return { ok: false };
        this.entries = { ...payload.legacy.entries, ...this.entries };
        this.migrated = true;
      }
      if (payload.pending) this.apply(payload.pending);
      return { ok: true, entries: { ...this.entries }, revision: this.revision };
    }
    if (name === 'localStoreWrite') {
      if (this.failWrites) return { ok: false };
      this.apply(payload);
      return { ok: true, revision: this.revision };
    }
    if (name === 'localStoreStatus') this.statuses.push(payload.status);
    if (name === 'showStorageInfo') this.details++;
    if (name === 'localStoreStartupError') this.startupErrors++;
    return null;
  }
}

test('native bridge gates startup, migrates progress, saves settings and replays after a failed write', { timeout: 180_000 }, async () => {
  const server = await serveBundle();
  let browser;
  try {
    browser = await launch();
    const viewport = { width: 640, height: 360 };
    const context = await browser.newContext({ viewport, screen: viewport, isMobile: true, hasTouch: true });
    const db = new NativeBridge();
    let releaseBootstrap;
    let signalBootstrap;
    const bootstrapSeen = new Promise((resolve) => { signalBootstrap = resolve; });
    const bootstrapGate = new Promise((resolve) => { releaseBootstrap = resolve; });
    let first = true;
    await context.exposeBinding('__nativeCall', async (_, name, payload) => {
      if (name === 'localStoreBootstrap' && first) { first = false; signalBootstrap(); await bootstrapGate; }
      return db.call(name, payload);
    });
    await context.addInitScript(() => {
      if (!localStorage.getItem('__seeded')) {
        localStorage.setItem('tanuki-rush-v1', JSON.stringify({ tokens: 200, ownedTrails: ['sky'], bestRank: 'A' }));
        localStorage.setItem('tanuki_steerDiv', '26');
        localStorage.setItem('tanuki_haptics', '0');
        localStorage.setItem('tanuki_intro', '1');
        localStorage.setItem('__seeded', '1');
      }
      window.flutter_inappwebview = { callHandler: (name, payload) => window.__nativeCall(name, payload ?? null) };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?native=1&debug&q=low`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await bootstrapSeen;
    assert.equal(await page.evaluate(() => !!window.__game), false, 'game must wait for migration');
    releaseBootstrap();
    await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 60_000 });
    assert.equal(await page.evaluate(() => window.__game.save.tokens), 200);
    assert.equal(await page.evaluate(() => window.__game.hud.steerDiv), 26);
    assert.equal(await page.evaluate(() => localStorage.getItem('tanuki_haptics')), '0', 'old keys remain intact');
    await page.locator('[data-settings]').tap();
    assert.equal(await page.locator('[data-haptics]').textContent(), 'OFF', 'migrated haptics applied before UI');
    for (const selector of ['[data-device-storage]', '[data-reminders]', '.settings:not(.credits):not(.intro) [data-close]']) {
      const box = await page.locator(selector).boundingBox();
      assert.ok(box && box.y >= 0 && box.y + box.height <= viewport.height, `${selector} fits a small landscape phone`);
    }
    await page.locator('[data-device-storage]').tap();
    await waitFor(() => db.details === 1, 'native storage details were not requested');
    await page.locator('[data-haptics]').tap();
    await page.locator('[data-sens="-1"]').tap();
    await waitFor(() => db.entries.tanuki_haptics === '1' && db.entries.tanuki_steerDiv === '50', 'settings were not saved');
    await page.locator('.settings:not(.credits):not(.intro) [data-close]').tap();
    await page.locator('[data-shop]').tap();
    await page.locator('[data-trail="sunset"]').tap();
    await waitFor(() => JSON.parse(db.entries['tanuki-rush-v1']).tokens === 120, 'purchase was not saved');
    await page.locator('[data-shop-back]').tap();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 60_000 });
    assert.equal(await page.evaluate(() => window.__game.save.tokens), 120, 'SQLite, not stale localStorage, wins');
    assert.ok(await page.evaluate(() => window.__game.save.ownedTrails.includes('sunset')));
    assert.equal(await page.evaluate(() => window.__game.hud.steerDiv), 50);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('tanuki-rush-v1')).tokens), 200);

    db.failWrites = true;
    await page.locator('[data-settings]').tap();
    await page.locator('[data-haptics]').tap();
    await waitFor(() => db.statuses.includes('error'), 'failed write was not reported');
    assert.ok(await page.evaluate(() => localStorage.getItem('tanuki_native_pending_v1')), 'failed write remains journaled');
    db.failWrites = false;
    await page.reload({ waitUntil: 'domcontentloaded' }); // simulate app/WebView restart
    await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 60_000 });
    assert.equal(db.entries.tanuki_haptics, '0', 'pending journal replayed at startup');
    assert.equal(await page.evaluate(() => localStorage.getItem('tanuki_native_pending_v1')), null);
    await page.locator('[data-settings]').tap();
    assert.equal(await page.locator('[data-haptics]').textContent(), 'OFF');
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('native database startup failure shows retry without starting an empty game', { timeout: 60_000 }, async () => {
  const server = await serveBundle();
  let browser;
  try {
    browser = await launch();
    const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
    const db = new NativeBridge();
    db.failBootstrap = true;
    await context.exposeBinding('__nativeCall', (_, name, payload) => db.call(name, payload));
    await context.addInitScript(() => {
      localStorage.setItem('tanuki-rush-v1', '{"tokens":42}');
      window.flutter_inappwebview = { callHandler: (name, payload) => window.__nativeCall(name, payload ?? null) };
    });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/?native=1&debug&q=low`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('alert').waitFor();
    await waitFor(() => db.startupErrors === 1, 'native startup error was not reported');
    assert.equal(await page.evaluate(() => !!window.__game), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('tanuki-rush-v1')), '{"tokens":42}');
    assert.equal(await page.getByRole('button', { name: 'Jaribu tena / Retry' }).isVisible(), true);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
