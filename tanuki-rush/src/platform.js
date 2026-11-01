// Platform feel: haptics, screen wake-lock, and the bridge to the native
// Android shell. Everything degrades gracefully in a plain browser.
//
// When running inside the Flutter app, `window.flutter_inappwebview` exposes
// callHandler(name, ...args); on the web it is undefined and we fall back to
// the Web Vibration / Wake Lock APIs.

const bridge = () =>
  (typeof window !== 'undefined' && window.flutter_inappwebview) || null;

export const isNativeApp = () => !!bridge();

// Vibration fallback patterns (ms). Native impact feedback feels crisper, so we
// prefer the bridge when it exists.
const VIBRATE = {
  light: [10],
  medium: [22],
  heavy: [38],
  select: [8],
  success: [12, 45, 18],
  error: [55],
};

let hapticsOn = true;
export function setHaptics(on) {
  hapticsOn = !!on;
  try { localStorage.setItem('tanuki_haptics', hapticsOn ? '1' : '0'); } catch (_) {}
}
try {
  const saved = localStorage.getItem('tanuki_haptics');
  if (saved !== null) hapticsOn = saved === '1';
} catch (_) {}
export const hapticsEnabled = () => hapticsOn;

/** Fire a short haptic. `type` is one of VIBRATE's keys. */
export function haptic(type = 'light') {
  if (!hapticsOn) return;
  const b = bridge();
  if (b) { try { b.callHandler('haptic', type); return; } catch (_) {} }
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try { navigator.vibrate(VIBRATE[type] || VIBRATE.light); } catch (_) {}
  }
}

// ---------------------------------------------------------------- wake lock
let _wake = null;

/** Keep the screen awake during play. Uses the Screen Wake Lock API, which
 *  works in modern Chromium (and therefore the Android WebView). */
export async function keepAwake(on) {
  try {
    if (on) {
      if (_wake || typeof navigator === 'undefined' || !navigator.wakeLock) return;
      _wake = await navigator.wakeLock.request('screen');
      _wake.addEventListener?.('release', () => { _wake = null; });
    } else if (_wake) {
      await _wake.release();
      _wake = null;
    }
  } catch (_) {
    _wake = null; // user agent may reject when not visible; harmless
  }
}

// Re-acquire the lock when the tab returns to the foreground.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && _wake === null) keepAwake(true);
  });
}

// ------------------------------------------------------------ notifications
/** Ask the native shell to (re)schedule the daily streak reminder. No-op on
 *  the web, where scheduled local notifications are not available. */
export function scheduleStreakReminder(streak) {
  const b = bridge();
  if (!b) return;
  try { b.callHandler('scheduleStreakReminder', { streak }); } catch (_) {}
}

/** Ask the native shell to request notification permission (Android 13+). */
export function requestNotifications() {
  const b = bridge();
  if (!b) return Promise.resolve(false);
  try { return Promise.resolve(b.callHandler('requestNotifications')); } catch (_) { return Promise.resolve(false); }
}
