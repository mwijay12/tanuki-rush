import test from 'node:test';
import assert from 'node:assert/strict';
// Node has no `window`, so provide one before the module is loaded: the tracer
// only publishes its poll hook when a page global exists, and it must not
// throw when one does not.
if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
const { bootStage, bootNote, getBootStage, onBootSample } = await import('../src/core/bootTracer.js');

// The tracer runs inside a WebView that may already be unhealthy, so the
// guarantees that matter are: it never throws, a stage change is observable
// synchronously, and "stalled" becomes true on its own without anyone calling.

test('the stage advances and reports how long it has been there', () => {
  bootStage('shaders');
  const s = getBootStage();
  assert.equal(s.stage, 'shaders');
  assert.equal(s.stalled, false);
  assert.ok(s.ms >= 0 && s.ms < 5000, 'a fresh stage is not stalled');
  assert.ok(s.totalMs >= s.ms, 'total elapsed covers the current stage');
});

test('a note is attached without moving the stage on', () => {
  bootStage('first render');
  bootNote('shader compile over 8000ms, skipped');
  const s = getBootStage();
  assert.equal(s.stage, 'first render', 'the interesting question is where it stalled');
  assert.match(s.note, /over 8000ms/);
});

test('notes are capped so a long session cannot grow without bound', () => {
  for (let i = 0; i < 40; i += 1) bootNote(`n${i}`);
  assert.equal(getBootStage().note, 'n39');
});

test('listeners see every stage change and every sample', async () => {
  const seen = [];
  const stop = onBootSample((s) => seen.push(s.stage));
  bootStage('ready');
  assert.ok(seen.includes('ready'), 'publishing is synchronous');
  assert.ok(seen.length >= 1);
  stop();
  const before = seen.length;
  bootStage('after-unsubscribe');
  assert.equal(seen.length, before, 'unsubscribing really stops the listener');
});

test('a listener that throws cannot take the boot sequence down with it', () => {
  const stop = onBootSample(() => { throw new Error('broken listener'); });
  assert.doesNotThrow(() => bootStage('still-alive'));
  assert.equal(getBootStage().stage, 'still-alive');
  stop();
});

test('the tracer is reachable from the page for a Flutter-side poll', () => {
  assert.equal(typeof globalThis.window.__tanukiBoot, 'function');
  bootStage('polled');
  assert.equal(globalThis.window.__tanukiBoot().stage, 'polled');
});

test('a stalled stage says so, which is the whole reason this exists', async () => {
  // Freeze the clock rather than waiting six seconds in a test suite.
  const realNow = Date.now;
  try {
    bootStage('shaders');
    const base = realNow();
    Date.now = () => base + 9000;
    const s = getBootStage();
    assert.equal(s.stalled, true);
    assert.ok(s.ms >= 9000);
  } finally {
    Date.now = realNow;
  }
});
