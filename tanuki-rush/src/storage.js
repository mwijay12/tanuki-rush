// Android persists the game in its private SQLite database via Flutter.
// Browsers keep using localStorage. On Android a small localStorage journal
// holds unacknowledged changes; SQLite is the authoritative committed copy.

export const SAVE_KEYS = Object.freeze([
  'tanuki-rush-v1', 'tanuki_steerDiv', 'tanuki_haptics', 'tanuki_intro',
]);
export const PENDING_KEY = 'tanuki_native_pending_v1';
const KEYS = new Set(SAVE_KEYS);
const MAX_PROGRESS_BYTES = 1024 * 1024;
const MAX_SETTING_BYTES = 4096;

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkedEntries(input) {
  if (!plainObject(input)) throw new Error('Invalid local save data');
  const out = Object.create(null);
  for (const [key, value] of Object.entries(input)) {
    if (!KEYS.has(key) || typeof value !== 'string') throw new Error('Invalid local save entry');
    const limit = key === 'tanuki-rush-v1' ? MAX_PROGRESS_BYTES : MAX_SETTING_BYTES;
    if (new TextEncoder().encode(value).length > limit) throw new Error('Local save is too large');
    if (key === 'tanuki-rush-v1') {
      let parsed;
      try { parsed = JSON.parse(value); } catch (_) { throw new Error('The progress save is damaged'); }
      if (!plainObject(parsed)) throw new Error('The progress save is damaged');
    }
    out[key] = value;
  }
  return out;
}

function readLegacy(web) {
  const entries = Object.create(null);
  for (const key of SAVE_KEYS) {
    const value = web.getItem(key);
    if (value !== null) entries[key] = value;
  }
  // Check in JS, which uses strict JSON parsing. An already-migrated database
  // must still open if its old (now non-authoritative) backup is damaged.
  let valid = true;
  try { checkedEntries(entries); } catch (_) { valid = false; }
  return { entries, valid };
}

function checkedRevision(value, allowZero = true) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error('Invalid local save revision');
  }
  return value;
}

function readJournal(web) {
  const raw = web.getItem(PENDING_KEY);
  if (raw === null) return null;
  let data;
  try { data = JSON.parse(raw); } catch (_) { throw new Error('The pending-save journal is damaged'); }
  if (!plainObject(data)) throw new Error('The pending-save journal is damaged');
  const entries = checkedEntries(data.entries);
  if (!Object.keys(entries).length) throw new Error('The pending-save journal is empty');
  return { revision: checkedRevision(data.revision, false), entries };
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The local database did not respond')), ms);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export class GameStorage {
  constructor({ onStatus = () => {}, retryMs = 2000, timeoutMs = 10000 } = {}) {
    this.onStatus = onStatus;
    this.retryMs = retryMs;
    this.timeoutMs = timeoutMs;
    this.native = false;
    this.initialized = false;
    this.web = null;
    this.bridge = null;
    this.values = Object.create(null);
    this.pending = Object.create(null);
    this.revision = 0;
    this.invalidKeys = new Set();
    this._flushPromise = null;
    this._retryTimer = null;
    this._disposed = false;
    this.status = 'loading';
  }

  _status(status) {
    if (this.status === status) return;
    this.status = status;
    this.onStatus(status);
  }

  /** Must finish before constructing the game or reading any preferences. */
  async initialize({ native = false, webStorage = null, bridge = null } = {}) {
    this.native = !!native;
    this.web = webStorage;
    this.bridge = bridge;
    this._disposed = false;
    if (!this.native) {
      this.initialized = true;
      this._status(this.web ? 'saved' : 'error');
      return;
    }
    if (!this.web || !this.bridge || typeof this.bridge.callHandler !== 'function') {
      throw new Error('The Android local database is unavailable');
    }
    // Do not mark migration complete if the old origin cannot be read, and do
    // not replace a bad save with defaults. The original keys are never deleted.
    const legacy = readLegacy(this.web);
    const pending = readJournal(this.web);
    const reply = await withTimeout(this.bridge.callHandler('localStoreBootstrap', { legacy, pending }), this.timeoutMs);
    if (!reply || reply.ok !== true) throw new Error('Could not open the Android local database');
    const values = checkedEntries(reply.entries);
    const revision = checkedRevision(reply.revision);
    if (pending && revision < pending.revision) throw new Error('Pending progress was not restored');
    // Migration and journal replay committed as one SQLite transaction. If
    // clearing the journal fails, stop: a retry is safe and does not lose it.
    this.web.removeItem(PENDING_KEY);
    this.values = values;
    this.pending = Object.create(null);
    this.revision = revision;
    this.initialized = true;
    this._status('saved');
  }

  getItem(key) {
    if (!KEYS.has(key)) throw new Error('Unknown save key');
    if (Object.hasOwn(this.values, key)) return this.values[key];
    if (this.native) return null;
    try { return this.web?.getItem(key) ?? null; }
    catch (_) { return null; }
  }

  setItem(key, value) {
    if (!this.initialized) throw new Error('Local storage is not initialized');
    let entry;
    try {
      entry = checkedEntries({ [key]: String(value) })[key];
      if (this.native && this.revision >= Number.MAX_SAFE_INTEGER) throw new Error('Save revision exhausted');
    } catch (_) {
      this.invalidKeys.add(key);
      this._status('error');
      return false;
    }
    this.invalidKeys.delete(key);
    this.values[key] = entry;
    if (!this.native) {
      this.pending[key] = entry;
      void this.flush();
      return true;
    }
    this.pending[key] = entry;
    this.revision++;
    // Journal BEFORE dispatch. If updating it fails, do not send a new write:
    // an older journal could otherwise overwrite a newer DB on the next start.
    try {
      this._writeJournal(this.pending, this.revision);
      this._status(this.invalidKeys.size ? 'error' : 'saving');
      void this.flush();
    } catch (_) {
      this._status('error');
      this._scheduleRetry();
    }
    return true;
  }

  _writeJournal(entries, revision) {
    if (Object.keys(entries).length) this.web.setItem(PENDING_KEY, JSON.stringify({ revision, entries }));
    else this.web.removeItem(PENDING_KEY);
  }

  /** Retry pending changes in order. Returns false without discarding them. */
  flush() {
    if (this._disposed) return Promise.resolve(false);
    if (!this.native) {
      try {
        if (!this.web) throw new Error('Browser storage is unavailable');
        for (const [key, value] of Object.entries(this.pending)) {
          this.web.setItem(key, value);
          delete this.pending[key];
        }
        if (this._retryTimer !== null) clearTimeout(this._retryTimer);
        this._retryTimer = null;
        this._status(this.invalidKeys.size ? 'error' : 'saved');
        return Promise.resolve(this.invalidKeys.size === 0);
      } catch (_) {
        this._status('error');
        this._scheduleRetry();
        return Promise.resolve(false);
      }
    }
    if (this._flushPromise) return this._flushPromise;
    let succeeded = false;
    const task = (async () => {
      try {
        this._writeJournal(this.pending, this.revision);
        while (Object.keys(this.pending).length) {
          const batch = { ...this.pending };
          const revision = this.revision;
          const reply = await withTimeout(this.bridge.callHandler('localStoreWrite', { revision, entries: batch }), this.timeoutMs);
          if (!reply || reply.ok !== true || checkedRevision(reply.revision) !== revision) {
            throw new Error('Local database write failed or conflicted');
          }
          const remaining = { ...this.pending };
          for (const [key, value] of Object.entries(batch)) {
            if (remaining[key] === value) delete remaining[key];
          }
          // A newer write queued in flight stays in the journal. Do not clear
          // in-memory pending data until the journal update succeeds as well.
          this._writeJournal(remaining, this.revision);
          this.pending = Object.assign(Object.create(null), remaining);
        }
        succeeded = true;
        if (this._retryTimer !== null) clearTimeout(this._retryTimer);
        this._retryTimer = null;
        this._status(this.invalidKeys.size ? 'error' : 'saved');
        return this.invalidKeys.size === 0;
      } catch (_) {
        this._status('error');
        this._scheduleRetry();
        return false;
      }
    })();
    this._flushPromise = task;
    task.finally(() => {
      if (this._flushPromise === task) this._flushPromise = null;
      if (succeeded && Object.keys(this.pending).length && !this._disposed) void this.flush();
    });
    return task;
  }

  _scheduleRetry() {
    if (this._retryTimer !== null || this._disposed) return;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      void this.flush();
    }, this.retryMs);
    this._retryTimer?.unref?.(); // Node unit tests should not keep the process alive.
  }

  dispose() {
    this._disposed = true;
    if (this._retryTimer !== null) clearTimeout(this._retryTimer);
    this._retryTimer = null;
  }
}

function htmlWarning(show) {
  if (typeof document === 'undefined') return;
  const old = document.getElementById('local-storage-warning');
  if (!show) { old?.remove(); return; }
  if (old) return;
  const box = document.createElement('div');
  box.id = 'local-storage-warning';
  box.setAttribute('role', 'alert');
  box.style.cssText = 'position:fixed;top:8px;left:8px;right:8px;z-index:9998;display:flex;gap:12px;align-items:center;justify-content:center;background:#6b2020;color:white;padding:9px 12px;border-radius:10px;font:700 13px/1.3 sans-serif';
  const text = document.createElement('span');
  text.textContent = 'Hifadhi imeshindikana / Save failed. Progress may be lost.';
  const button = document.createElement('button');
  button.textContent = 'RETRY';
  button.style.cssText = 'padding:8px;border:0;border-radius:6px;font-weight:700';
  button.addEventListener('click', () => { void gameStorage.flush(); });
  box.append(text, button);
  document.body.appendChild(box);
}

function notifyStatus(status) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('tanuki:storage-status', { detail: { status } }));
  if (status !== 'error') htmlWarning(false);
  if (!gameStorage.native) { if (status === 'error') htmlWarning(true); return; }
  try {
    const call = window.flutter_inappwebview?.callHandler('localStoreStatus', { status });
    if (!call) throw new Error('Native status UI unavailable');
    withTimeout(call, 2000).catch(() => { if (gameStorage.status === 'error') htmlWarning(true); });
  } catch (_) {
    if (status === 'error') htmlWarning(true);
  }
}

export const gameStorage = new GameStorage({ onStatus: notifyStatus });

/** Wait for flutter_inappwebview's platform-ready event on older WebViews. */
async function waitForNativeBridge(timeoutMs = 10000) {
  const current = () => window.flutter_inappwebview;
  if (typeof current()?.callHandler === 'function') return current();
  return new Promise((resolve, reject) => {
    let timer;
    const ready = () => {
      const bridge = current();
      if (typeof bridge?.callHandler !== 'function') return;
      clearTimeout(timer);
      window.removeEventListener('flutterInAppWebViewPlatformReady', ready);
      resolve(bridge);
    };
    window.addEventListener('flutterInAppWebViewPlatformReady', ready);
    timer = setTimeout(() => {
      window.removeEventListener('flutterInAppWebViewPlatformReady', ready);
      reject(new Error('The Android storage bridge did not start'));
    }, timeoutMs);
    ready(); // Avoid missing an event between the first check and subscription.
  });
}

export async function initializeGameStorage() {
  const native = new URLSearchParams(location.search).get('native') === '1';
  let webStorage;
  try { webStorage = window.localStorage; } catch (_) { webStorage = null; }
  const bridge = native ? await waitForNativeBridge() : null;
  await gameStorage.initialize({ native, webStorage, bridge });
  if (native) {
    const retry = () => { void gameStorage.flush(); };
    window.addEventListener('tanuki:app-resumed', retry);
    window.addEventListener('tanuki:storage-retry', retry);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) retry(); });
  }
}
