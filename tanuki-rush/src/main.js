import { Game } from './Game.js';
import { installDebugTools } from './core/debugTools.js';
import { preventPageZoom } from './ui/noZoom.js';
import { initializeGameStorage } from './storage.js';
import { initializeHaptics } from './platform.js';

preventPageZoom();

function fail(err, storage = false) {
  console.error(err);
  const d = document.createElement('div');
  d.setAttribute('role', 'alert');
  d.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;gap:16px;align-items:center;justify-content:center;background:#0a1a44;color:#fff;font:700 16px/1.5 sans-serif;text-align:center;padding:24px;z-index:9999';
  const message = document.createElement('div');
  message.textContent = storage
    ? 'Hifadhi ya simu haikufunguka. Maendeleo hayajafutwa. Angalia nafasi na ujaribu tena. / Could not open device storage. Saved data was not deleted. Check free space and retry.'
    : 'The game could not start. Please check WebGL2 support or try another device.';
  d.appendChild(message);
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
    const game = new Game(document.getElementById('app'));
    const params = new URLSearchParams(location.search);
    if (params.has('debug') || params.has('bot')) { window.__game = game; installDebugTools(game); }
    await game.start();
  } catch (error) {
    fail(error);
  }
}

void boot();
