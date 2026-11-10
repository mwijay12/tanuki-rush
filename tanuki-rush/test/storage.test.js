import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameStorage, PENDING_KEY } from '../src/storage.js';

class WebStore {
  constructor(initial = {}) { this.data = new Map(Object.entries(initial)); this.failRead = false; this.failWrite = false; }
  getItem(key) { if (this.failRead) throw new Error('unavailable'); return this.data.get(key) ?? null; }
  setItem(key, value) { if (this.failWrite) throw new Error('quota'); this.data.set(key, String(value)); }
  removeItem(key) { if (this.failWrite) throw new Error('quota'); this.data.delete(key); }
}

// Same revision and atomic-bootstrap contract as Android's SQLite helper.
// Kotlin/Robolectric tests exercise the actual database implementation too.
class NativeDB {
  constructor() { this.entries = {}; this.revision = 0; this.migrated = false; this.calls = []; this.failWrites = false; }
  async callHandler(name, payload) {
    this.calls.push({ name, payload: structuredClone(payload) });
    if (name === 'localStoreBootstrap') {
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
    throw new Error('unexpected handler');
  }
  apply({ revision, entries }) {
    if (revision > this.revision) {
      Object.assign(this.entries, entries);
      this.revision = revision;
    }
  }
}

const progress = (tokens) => JSON.stringify({ tokens, ownedTrails: ['sky'] });
const newStore = () => new GameStorage({ retryMs: 60_000, timeoutMs: 1000 });
const startNative = (store, web, db) => store.initialize({ native: true, webStorage: web, bridge: db });

test('browser continues to use localStorage, including retry after a write failure', async () => {
  const web = new WebStore({ 'tanuki-rush-v1': progress(10), tanuki_haptics: '0' });
  const store = newStore();
  await store.initialize({ webStorage: web });
  assert.equal(store.getItem('tanuki-rush-v1'), progress(10));
  assert.equal(store.getItem('tanuki_haptics'), '0');
  web.failWrite = true;
  store.setItem('tanuki-rush-v1', progress(20));
  assert.equal(store.status, 'error');
  assert.equal(store.getItem('tanuki-rush-v1'), progress(20), 'unsaved value remains in memory');
  assert.equal(web.getItem('tanuki-rush-v1'), progress(10));
  web.failWrite = false;
  assert.equal(await store.flush(), true);
  assert.equal(web.getItem('tanuki-rush-v1'), progress(20));
  const restart = newStore();
  await restart.initialize({ webStorage: web });
  assert.equal(restart.getItem('tanuki-rush-v1'), progress(20));
  store.dispose(); restart.dispose();
});

test('migrates all original keys once without deleting them; SQLite wins on later starts', async () => {
  const original = {
    'tanuki-rush-v1': progress(65), tanuki_steerDiv: '26', tanuki_haptics: '0', tanuki_intro: '1',
  };
  const web = new WebStore(original);
  const db = new NativeDB();
  const first = newStore();
  await startNative(first, web, db);
  assert.deepEqual({ ...db.entries }, original);
  assert.equal(first.getItem('tanuki_steerDiv'), '26');
  assert.equal(first.getItem('tanuki_haptics'), '0');
  assert.deepEqual(Object.fromEntries(web.data), original, 'legacy backup is retained');
  first.setItem('tanuki-rush-v1', progress(100));
  assert.equal(await first.flush(), true);
  first.dispose();

  web.setItem('tanuki-rush-v1', '{broken old backup');
  web.setItem('tanuki_haptics', '1');
  const second = newStore();
  await startNative(second, web, db);
  assert.equal(second.getItem('tanuki-rush-v1'), progress(100));
  assert.equal(second.getItem('tanuki_haptics'), '0');
  assert.equal(db.calls.at(-1).payload.legacy.valid, false);
  second.dispose();
});

test('damaged or unreadable legacy data blocks first start rather than replacing progress', async () => {
  const db = new NativeDB();
  const web = new WebStore({ 'tanuki-rush-v1': '{bad json', tanuki_intro: '1' });
  const first = newStore();
  await assert.rejects(startNative(first, web, db), /database/);
  assert.equal(db.migrated, false);
  assert.equal(web.getItem('tanuki-rush-v1'), '{bad json');
  web.failRead = true;
  const second = newStore();
  await assert.rejects(startNative(second, web, db), /unavailable/);
  assert.equal(db.migrated, false);
  first.dispose(); second.dispose();
});

test('coalesces ordered writes without removing a newer pending value on an old acknowledgement', async () => {
  const web = new WebStore();
  const db = new NativeDB();
  const store = newStore();
  await startNative(store, web, db);
  let release;
  const call = db.callHandler.bind(db);
  db.callHandler = (name, payload) => name === 'localStoreWrite' && !release
    ? new Promise((resolve) => { release = () => resolve(call(name, payload)); })
    : call(name, payload);
  store.setItem('tanuki-rush-v1', progress(1));
  store.setItem('tanuki-rush-v1', progress(2));
  store.setItem('tanuki_haptics', '0');
  const journal = JSON.parse(web.getItem(PENDING_KEY));
  assert.equal(journal.revision, 3);
  assert.deepEqual(journal.entries, { 'tanuki-rush-v1': progress(2), tanuki_haptics: '0' });
  release();
  assert.equal(await store.flush(), true);
  assert.equal(db.entries['tanuki-rush-v1'], progress(2));
  assert.equal(db.entries.tanuki_haptics, '0');
  assert.equal(db.revision, 3);
  assert.equal(web.getItem(PENDING_KEY), null);
  assert.equal(store.status, 'saved');
  store.dispose();
});

test('failed native writes survive restart via journal replay and remain idempotent', async () => {
  const web = new WebStore({ 'tanuki-rush-v1': progress(3) });
  const db = new NativeDB();
  const first = newStore();
  await startNative(first, web, db);
  db.failWrites = true;
  first.setItem('tanuki-rush-v1', progress(99));
  assert.equal(await first.flush(), false);
  assert.equal(first.status, 'error');
  assert.equal(db.entries['tanuki-rush-v1'], progress(3));
  const savedJournal = web.getItem(PENDING_KEY);
  assert.ok(savedJournal);
  first.dispose();
  const second = newStore();
  await startNative(second, web, db);
  assert.equal(second.getItem('tanuki-rush-v1'), progress(99));
  assert.equal(web.getItem(PENDING_KEY), null);
  web.setItem(PENDING_KEY, savedJournal); // crash before journal cleanup
  second.dispose();
  const third = newStore();
  await startNative(third, web, db);
  assert.equal(third.getItem('tanuki-rush-v1'), progress(99));
  assert.equal(db.revision, 1);
  assert.equal(web.getItem(PENDING_KEY), null);
  third.dispose();
});

test('if journal cleanup fails after commit, replay is safe and preserves the committed progress', async () => {
  const web = new WebStore();
  const db = new NativeDB();
  const store = newStore();
  await startNative(store, web, db);
  const call = db.callHandler.bind(db);
  db.callHandler = async (name, payload) => {
    const result = await call(name, payload);
    if (name === 'localStoreWrite') web.failWrite = true; // DB committed, cleanup cannot
    return result;
  };
  store.setItem('tanuki-rush-v1', progress(70));
  assert.equal(await store.flush(), false);
  assert.equal(store.status, 'error');
  assert.equal(db.entries['tanuki-rush-v1'], progress(70));
  assert.ok(web.getItem(PENDING_KEY));
  store.dispose();
  web.failWrite = false;
  const restart = newStore();
  await startNative(restart, web, db);
  assert.equal(restart.getItem('tanuki-rush-v1'), progress(70));
  assert.equal(db.revision, 1);
  assert.equal(web.getItem(PENDING_KEY), null);
  restart.dispose();
});

test('journal failure prevents an unsafe database write; retry persists it', async () => {
  const web = new WebStore();
  const db = new NativeDB();
  const store = newStore();
  await startNative(store, web, db);
  web.failWrite = true;
  store.setItem('tanuki-rush-v1', progress(12));
  assert.equal(store.status, 'error');
  assert.equal(db.calls.filter((x) => x.name === 'localStoreWrite').length, 0);
  assert.equal(store.getItem('tanuki-rush-v1'), progress(12));
  web.failWrite = false;
  assert.equal(await store.flush(), true);
  assert.equal(db.entries['tanuki-rush-v1'], progress(12));
  assert.equal(web.getItem(PENDING_KEY), null);
  store.dispose();
});

test('a timed-out old write cannot overwrite a newer revision if it arrives late', async () => {
  const web = new WebStore();
  const db = new NativeDB();
  const store = new GameStorage({ retryMs: 60_000, timeoutMs: 15 });
  await startNative(store, web, db);
  let release;
  const call = db.callHandler.bind(db);
  db.callHandler = (name, payload) => name === 'localStoreWrite' && !release
    ? new Promise((resolve) => { release = () => resolve(call(name, payload)); })
    : call(name, payload);
  store.setItem('tanuki-rush-v1', progress(1));
  assert.equal(await store.flush(), false);
  store.setItem('tanuki-rush-v1', progress(2));
  assert.equal(await store.flush(), true);
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(db.entries['tanuki-rush-v1'], progress(2));
  assert.equal(db.revision, 2);
  store.dispose();
});

test('corrupt journal, corrupt database responses, and invalid writes do not silently reset saves', async () => {
  const db = new NativeDB();
  const web = new WebStore({ [PENDING_KEY]: '{bad' });
  const first = newStore();
  await assert.rejects(startNative(first, web, db), /journal/);
  assert.equal(db.calls.length, 0);
  assert.equal(web.getItem(PENDING_KEY), '{bad');
  web.removeItem(PENDING_KEY);
  db.migrated = true;
  db.entries['tanuki-rush-v1'] = '[]';
  const second = newStore();
  await assert.rejects(startNative(second, web, db), /damaged/);
  db.entries['tanuki-rush-v1'] = progress(5);
  const third = newStore();
  await startNative(third, web, db);
  assert.equal(third.setItem('tanuki-rush-v1', 'not json'), false);
  assert.equal(third.status, 'error');
  assert.equal(await third.flush(), false);
  assert.equal(db.entries['tanuki-rush-v1'], progress(5));
  third.setItem('tanuki-rush-v1', progress(6));
  assert.equal(await third.flush(), true);
  assert.equal(third.status, 'saved');
  first.dispose(); second.dispose(); third.dispose();
});
