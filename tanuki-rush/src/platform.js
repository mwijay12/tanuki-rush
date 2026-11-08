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
let _wakeWanted = false;

/** Keep the screen awake only while a run is active, where supported. */
export async function keepAwake(on) {
  _wakeWanted = !!on;
  try {
    if (on) {
      if (_wake || typeof navigator === 'undefined' || !navigator.wakeLock) return;
      const lock = await navigator.wakeLock.request('screen');
      if (!_wakeWanted) { await lock.release(); return; }
      _wake = lock;
      lock.addEventListener?.('release', () => { if (_wake === lock) _wake = null; });
    } else if (_wake) {
      const lock = _wake;
      _wake = null;
      await lock.release();
    }
  } catch (_) {
    _wake = null; // unsupported, hidden or denied; the game still works
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (_wakeWanted && document.visibilityState === 'visible' && _wake === null) keepAwake(true);
  });
}

// ------------------------------------------------------------ notifications
/** Optional native reminders. Never request permission without a player action. */
export function scheduleStreakReminder(streak) {
  const b = bridge();
  if (b) { try { Promise.resolve(b.callHandler('scheduleStreakReminder', { streak })).catch(() => {}); } catch (_) {} }
}

export function cancelStreakReminder() {
  const b = bridge();
  if (b) { try { Promise.resolve(b.callHandler('cancelStreakReminder')).catch(() => {}); } catch (_) {} }
}

export async function requestNotifications() {
  const b = bridge();
  if (!b) return false;
  try { return !!(await b.callHandler('requestNotifications')); } catch (_) { return false; }
}
