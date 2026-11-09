import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeStreak, awardRun, dailyMissions, dayDiff, equippedTrail, missionStatus,
  normalizeProgress, selectTrail, tickStreak, tierInfo, TRAILS,
} from '../src/progression.js';

const perfectRun = { collected: 100, enemies: 20, time: 100, total: 50000, deaths: 0 };

test('daily missions are deterministic, distinct and change over time', () => {
  const ids = (day) => dailyMissions(day).map((m) => `${m.id}:${m.label}:${m.reward}`);
  assert.deepEqual(ids('2026-11-08'), ids('2026-11-08'));
  assert.equal(new Set(dailyMissions('2026-11-08').map((m) => m.id)).size, 3);
  assert.equal(dailyMissions('2026-11-08')[0].id, 'finish');
  assert.notDeepEqual(ids('2026-11-08'), ids('2026-11-09'));
});

test('one completed run awards base tokens and each mission only once per day', () => {
  const save = {};
  const first = awardRun(save, perfectRun, '2026-11-08');
  assert.equal(first.base, 35);
  assert.equal(first.newlyCompleted.length, 3);
  assert.equal(save.tokens, first.base + first.bonus);
  assert.ok(missionStatus(save, '2026-11-08').every((m) => m.done));
  const second = awardRun(save, perfectRun, '2026-11-08');
  assert.equal(second.bonus, 0);
  assert.equal(second.newlyCompleted.length, 0);
  assert.equal(save.tokens, first.total + second.base);
  assert.ok(missionStatus(save, '2026-11-09').every((m) => !m.done));
  const tomorrow = awardRun(save, perfectRun, '2026-11-09');
  assert.equal(tomorrow.newlyCompleted.length, 3);
});

test('a modest run only earns missions whose conditions it meets', () => {
  const save = {};
  const award = awardRun(save, { collected: 0, enemies: 0, time: 500, total: 0, deaths: 9 }, '2026-11-08');
  assert.deepEqual(award.newlyCompleted.map((m) => m.id), ['finish']);
  assert.equal(award.base, 15);
  assert.equal(award.bonus, 20);
});

test('trail purchases debit once, stay owned, and cannot overspend', () => {
  const save = { tokens: 80 };
  assert.equal(selectTrail(save, 'violet').reason, 'insufficient');
  assert.equal(save.tokens, 80);
  assert.equal(selectTrail(save, 'not-a-trail').reason, 'unknown');
  assert.equal(selectTrail(save, 'sunset').purchased, true);
  assert.equal(save.tokens, 0);
  assert.equal(equippedTrail(save).id, 'sunset');
  assert.equal(selectTrail(save, 'sky').purchased, false);
  assert.equal(selectTrail(save, 'sunset').purchased, false);
  assert.equal(save.tokens, 0);
  assert.equal(save.ownedTrails.filter((id) => id === 'sunset').length, 1);
  assert.equal(TRAILS.every((t) => Number.isInteger(t.color)), true);
});

test('old and partially corrupt saves get safe defaults without losing records', () => {
  const save = { bestTime: 123, tokens: -2, ownedTrails: ['mint', 'missing', 'mint'], equippedTrail: 'missing' };
  normalizeProgress(save);
  assert.deepEqual(save, { bestTime: 123, tokens: 0, ownedTrails: ['sky', 'mint'], equippedTrail: 'sky' });
});

test('calendar-day streaks work across DST, months and clock changes', () => {
  assert.equal(dayDiff('2026-03-08', '2026-03-09'), 1);
  assert.equal(dayDiff('2026-12-31', '2027-01-01'), 1);
  const save = {};
  assert.equal(tickStreak(save, '2026-11-08'), 1);
  assert.equal(tickStreak(save, '2026-11-08'), 1);
  assert.equal(tickStreak(save, '2026-11-09'), 2);
  assert.equal(activeStreak(save, '2026-11-10'), 2);
  assert.equal(activeStreak(save, '2026-11-11'), 0);
  assert.equal(activeStreak(save, '2026-11-07'), 0);
  assert.equal(tickStreak(save, '2026-11-11'), 1);
  assert.equal(save.bestStreak, 2);
});

test('rank thresholds show a useful next target', () => {
  assert.deepEqual(tierInfo(22000), { rank: 'B', next: 'A', need: 9000, progress: 0 });
  assert.equal(tierInfo(40000).rank, 'S');
  assert.equal(tierInfo(40000).next, null);
});
