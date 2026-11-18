import { Game } from './Game.js';
import { installDebugTools } from './core/debugTools.js';
import { preventPageZoom } from './ui/noZoom.js';
import { initializeGameStorage } from './storage.js';
import { initializeHaptics } from './platform.js';
import { bootStage, bootNote, getBootStage } from './core/bootTracer.js';

preventPageZoom();
bootStage('storage');

function fail(err, storage = false) {
  console.error(err);
  // The loading screen has the same background colour as this overlay and no
  // z-index of its own, so a failure could be hidden behind it and read as "the
  // app is showing its navy window background" - the exact misreading this bug
  // was chased through. Remove it, and use colours that appear nowhere else in
  // the game so a failure can never be mistaken for a working screen.
  document.querySelectorAll('.loading').forEach((n) => n.remove());
  const stage = typeof getBootStage === 'function' ? getBootStage() : null;
  const d = document.createElement('div');
  d.setAttribute('role', 'alert');
  d.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;gap:14px;align-items:center;justify-content:center;background:#d8231d;color:#fff;font:700 16px/1.5 sans-serif;text-align:center;padding:24px;z-index:9999';
  const message = document.createElement('div');
  message.textContent = storage
    ? 'Hifadhi ya simu haikufunguka. Maendeleo hayajafutwa. Angalia nafasi na ujaribu tena. / Could not open device storage. Saved data was not deleted. Check free space and retry.'
    : 'The game could not start. Please check WebGL2 support or try another device.';
  d.appendChild(message);
  if (stage) {
    const where = document.createElement('div');
    where.textContent = `Failed in stage: ${stage.stage} after ${(stage.totalMs / 1000).toFixed(1)}s. ${err && err.message ? err.message : ''}`.trim();
    where.style.cssText = 'font:600 13px/1.5 monospace;color:#ffe14f;max-width:90vw';
    d.appendChild(where);
  }
  if (storage) {
    const retry = document.createElement('button');
    retry.textContent = 'Jaribu tena / Retry';
    retry.style.cssText = 'border:0;border-radius:8px;background:#ffc629;color:#111;padding:12px 20px;font:700 16px sans-serif;cursor:pointer';
    retry.addEventListener('click', () => location.reload());
    d.appendChild(retry);
    // Flutter presents the same error natively when the bridge is available.
    // This HTML fallback also works if the bridge itself failed to start.
    try { Promise.resolve(window.flutter_inappwebview?.callHandler('localStoreStartupError')).catch(() => {}); } catch (_) {}
  }
  document.body.appendChild(d);
}

async function boot() {
  try {
    await initializeGameStorage();
    initializeHaptics();
  } catch (error) {
    fail(error, true);
    return;
  }
  try {
    bootStage('build-world');
    const game = new Game(document.getElementById('app'));
    const params = new URLSearchParams(location.search);
    if (params.has('debug') || params.has('bot')) { window.__game = game; installDebugTools(game); }
    await game.start();
  } catch (error) {
    // Record where the boot died before the overlay replaces the page, so a
    // report from the field says which stage failed instead of only that it did.
    bootNote(`start failed: ${error && error.message ? error.message : error}`);
    console.error('[tanuki-web] boot failed in stage', window.__tanukiBoot ? window.__tanukiBoot().stage : '?', error);
    fail(error);
  }
}

void boot();
