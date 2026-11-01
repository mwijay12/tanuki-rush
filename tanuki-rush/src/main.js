import { Game } from './Game.js';
import { installDebugTools } from './core/debugTools.js';
import { preventPageZoom } from './ui/noZoom.js';

preventPageZoom();

function fail(err) {
  console.error(err);
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#0a1a44;color:#fff;font:700 18px/1.6 sans-serif;text-align:center;padding:24px;z-index:99';
  d.textContent = 'WebGL2 が使えないため起動できませんでした。別のブラウザやデバイスでお試しください。';
  document.body.appendChild(d);
}

try {
  const game = new Game(document.getElementById('app'));
  const params = new URLSearchParams(location.search);
  if (params.has('debug') || params.has('bot')) { window.__game = game; installDebugTools(game); }
  game.start().catch(fail);
} catch (e) {
  fail(e);
}
