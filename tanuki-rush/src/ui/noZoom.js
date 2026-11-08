// Keeps phones from zooming the page while you play.
// iOS Safari ignores user-scalable=no, and touch-action alone did not stop it either: two thumbs
// moving at once (steer + JUMP/BOOST) read as a pinch, and a quick double tap on JUMP
// (jump → homing attack) as double-tap-to-zoom. So touches on the game itself cancel every
// browser gesture, and pinch / double tap are blocked on the menus as well.
// Pointer events still fire when touch events are cancelled, so the touch controls keep working.

const MENU = '.screen'; // title / pause / results: taps there must still become clicks

export function preventPageZoom(doc = document) {
  const cancel = (e) => { if (e.cancelable) e.preventDefault(); };
  const inMenu = (e) => e.target instanceof Element && e.target.closest(MENU) !== null;

  // In play (touch controls, 3D view): no browser gestures at all.
  doc.addEventListener('touchstart', (e) => { if (!inMenu(e)) cancel(e); }, { passive: false });

  // Pinch that starts on a menu: WebKit's gesture events, and any move with two or more fingers.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) doc.addEventListener(type, cancel, { passive: false });
  doc.addEventListener('touchmove', (e) => { if (e.touches.length > 1) cancel(e); }, { passive: false });

  // Double-tap zoom on a menu: only suppress a quick repeat on the same
  // target. A gameplay finger released just before opening PAUSE must not
  // cancel the first tap on RESUME (nor should two different menu buttons).
  let lastMenuTap = null;
  doc.addEventListener('touchend', (e) => {
    if (!inMenu(e) || e.touches.length || e.changedTouches.length !== 1) { lastMenuTap = null; return; }
    const target = e.target.closest('button, a') || e.target.closest(MENU);
    const point = e.changedTouches[0];
    if (lastMenuTap && lastMenuTap.target === target && e.timeStamp - lastMenuTap.time < 300 &&
        Math.hypot(point.clientX - lastMenuTap.x, point.clientY - lastMenuTap.y) < 24) cancel(e);
    lastMenuTap = { target, time: e.timeStamp, x: point.clientX, y: point.clientY };
  }, { passive: false });
  doc.addEventListener('dblclick', cancel);
}
