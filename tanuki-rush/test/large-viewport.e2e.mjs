// Draws the shipped bundle at the drawing-buffer size the reporting phone
// actually uses, and asks whether the GPU survived it.
//
// Why this test exists: every other browser test here uses a 915x412 landscape
// viewport, which with the 1.5 pixel-ratio cap gives a 1372x618 buffer. A Pixel
// 8 Pro reports a 2992x1344 display, so the same cap gives 4488x2016 - ten
// times the pixels, and PostFX backs that with a HalfFloat MSAA render target.
// The suite was therefore green at a tenth of the real allocation, which is how
// a device-only failure stays invisible to CI.
//
// This test reports; it does not assert a particular GPU outcome, because
// SwiftShader's limits are not a Mali-G715's limits. What it makes visible is
// the size of the allocation the game asks for and whether a WebGL context
// survives it, plus whether the renderer's own frame counter advances.
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
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
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

// The phone's own numbers: display 2992x1344, pixelRatio capped at 1.5 by
// Renderer, which yields a 4488x2016 drawing buffer.
const CASES = [
  { name: 'phone buffer (Pixel 8 Pro landscape)', viewport: { width: 2992, height: 1344 }, dpr: 1.5 },
  { name: 'CI-sized buffer (existing tests)', viewport: { width: 915, height: 412 }, dpr: 1.5 },
];

for (const c of CASES) {
  test(`large-viewport: ${c.name}`, { timeout: 420_000 }, async () => {
    const server = await serveBundle();
    const port = server.address().port;
    let browser;
    try {
      browser = await chromium.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
        headless: true,
        args: [
          '--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
          '--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader',
          '--ignore-gpu-blocklist',
        ],
      });
      const context = await browser.newContext({
        viewport: c.viewport,
        screen: c.viewport,
        deviceScaleFactor: c.dpr,
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();

      const lost = [];
      const errors = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(String(e)));

      await page.addInitScript(() => {
        localStorage.setItem('tanuki_intro', '1');
        window.__lost = [];
        // Wrap getContext so a context lost later is still attributed here,
        // including one the page itself never listens for.
        const raw = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, attrs) {
          const ctx = raw.call(this, type, attrs);
          if (ctx && String(type).startsWith('webgl') && !ctx.__tanukiTracked) {
            ctx.__tanukiTracked = true;
            this.addEventListener('webglcontextlost', () => {
              window.__lost.push(`webglcontextlost on ${this.width}x${this.height}`);
            });
          }
          return ctx;
        };
        window.flutter_inappwebview = { callHandler: () => Promise.resolve(null) };
      });

      await page.goto(`http://127.0.0.1:${port}/index.html?debug=1`, { waitUntil: 'load' });

      // Let the boot path finish, then measure what it actually allocated.
      const report = await page.evaluate(async () => {
        const out = { waited: 0 };
        // SwiftShader is a software rasterizer, so a 3.5-megapixel scene can take a
        // long while to reach its first frame. Wait generously and report rather
        // than fail: what this test is for is the allocation, not the framerate.
        const deadline = Date.now() + 300000;
        while (Date.now() < deadline) {
          const g = window.__game;
          if (g && g.R && g.R.renderer) break;
          await new Promise((r) => setTimeout(r, 500));
          out.waited += 500;
        }
        const g = window.__game;
        if (!g || !g.R || !g.R.renderer) {
          out.gameStarted = false;
          out.boot = window.__tanukiBoot ? window.__tanukiBoot() : null;
          out.lost = window.__lost;
          return out;
        }
        out.gameStarted = true;
        const r = g.R.renderer;
        const gl = r.getContext();
        out.cssSize = g.R.width + 'x' + g.R.height;
        out.drawingBuffer = gl.drawingBufferWidth + 'x' + gl.drawingBufferHeight;
        out.bufferPixels = gl.drawingBufferWidth * gl.drawingBufferHeight;
        out.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        out.maxRenderbufferSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
        out.exceedsMaxTexture =
          gl.drawingBufferWidth > out.maxTextureSize || gl.drawingBufferHeight > out.maxTextureSize;
        const rt = g.post && g.post.rt;
        if (rt) {
          out.postFxTarget = rt.width + 'x' + rt.height;
          out.postFxSamples = rt.samples;
          out.postFxPixels = rt.width * rt.height;
          // HalfFloat is 8 bytes per pixel; MSAA multiplies the samples.
          out.postFxBytesApprox = rt.width * rt.height * 8 * Math.max(1, rt.samples || 1);
        }
        out.contextLost = gl.isContextLost();
        out.pixelRatio = g.R.pixelRatio;
        // Whether the offscreen post-processing target was affordable. If it was
        // not, the game now draws straight to the canvas instead of compositing
        // nothing, and this says so.
        out.postFxAvailable = !g.post.unavailable;
        out.postFxReason = g.post.reason || '';
        // Does the renderer still advance? This is the question a screenshot
        // of a flat colour cannot answer.
        out.frame1 = r.info.render.frame;
        await new Promise((res) => setTimeout(res, 3000));
        out.frame2 = r.info.render.frame;
        out.framesAdvanced = out.frame2 > out.frame1;
        out.contextLostAfter = gl.isContextLost();
        // A driver that cannot afford the render target says so here rather
        // than by going quiet.
        out.glError = gl.getError();
        out.boot = window.__tanukiBoot ? window.__tanukiBoot() : null;
        out.lost = window.__lost;
        return out;
      });

      console.log(`[large-viewport ${c.name}] ${JSON.stringify(report)}`);
      assert.ok(report.gameStarted, `the game did not start: ${JSON.stringify(report.boot)}`);
      assert.ok(!report.exceedsMaxTexture, 'the drawing buffer exceeds MAX_TEXTURE_SIZE');
      // The whole point: the buffer a real phone asks for must be inside the
      // budget, at whatever size this test's own viewport implies.
      assert.ok(report.bufferPixels <= 4_000_000,
        `drawing buffer ${report.drawingBuffer} = ${report.bufferPixels} px exceeds the budget`);
      // Everything below is reported, not asserted. Whether a software
      // rasterizer can afford a target, or advance a frame, says nothing about a
      // Mali-G715; making it a gate would only produce a flaky build.
    } finally {
      if (browser) await browser.close();
      server.close();
    }
  });
}
