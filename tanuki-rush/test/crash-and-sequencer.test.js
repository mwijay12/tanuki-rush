import test from 'node:test';
import assert from 'node:assert/strict';
import { Events } from '../src/core/Events.js';
import { Player } from '../src/player/Player.js';
import { Sequencer } from '../src/audio/sequencer.js';

function player() {
  // Damage only requires the player's state and event emitter, not a 3D scene.
  const p = Object.create(Player.prototype);
  Object.assign(p, { state: 'ground', invuln: 0, leaves: 27, boosting: false, ball: false, events: new Events() });
  return p;
}

test('a crash ends the attempt even with collected leaves, and emits death only once', () => {
  const p = player();
  const deaths = [];
  p.events.on('death', (event) => deaths.push(event.reason));
  assert.equal(p.hurt(), true);
  assert.equal(p.state, 'dead');
  assert.equal(p.leaves, 27, 'leaves remain available if the player revives');
  assert.equal(p.hurt(), false);
  p.die('fall');
  assert.deepEqual(deaths, ['hit']);
});

test('a revive grace period blocks collision damage and a crash stops the boost loop', () => {
  const p = player();
  const events = [];
  p.events.on('boostEnd', () => events.push('boostEnd'));
  p.events.on('death', () => events.push('death'));
  p.invuln = 1;
  assert.equal(p.hurt(), false);
  assert.equal(p.state, 'ground');
  p.invuln = 0;
  p.boosting = true;
  assert.equal(p.hurt(), true);
  assert.equal(p.boosting, false);
  assert.deepEqual(events, ['boostEnd', 'death']);
  p.state = 'goal';
  p.die('fall');
  assert.equal(p.state, 'goal', 'the finish cannot turn into a crash');
});

test('music is scheduled far enough ahead for a short main-thread stall and skips only a long one', (t) => {
  const ctx = { state: 'running', currentTime: 0 };
  const notes = [];
  const seq = new Sequencer(ctx, 0.1, (step, time) => notes.push({ step, time }));
  t.after(() => seq.stop());
  seq.start(0.05);
  assert.deepEqual(notes.map((n) => Number(n.time.toFixed(2))), [0.05, 0.15, 0.25]);
  ctx.currentTime = 0.26; // no JS ticks for 260 ms
  seq.tick();
  assert.equal(seq.skipped, 0);
  assert.deepEqual(notes.slice(0, 6).map((n) => Number(n.time.toFixed(2))), [0.05, 0.15, 0.25, 0.35, 0.45, 0.55]);
  ctx.currentTime = 2;
  seq.tick();
  assert.ok(seq.skipped > 0, 'a long interruption skips stale notes instead of playing a burst');
  assert.ok(notes.at(-1).time > 2);
});
