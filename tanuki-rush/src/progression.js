// Retention logic: rank tiers, daily goal, and the daily streak.
// Everything here is offline and deterministic — no server, no account.

/** Local calendar day as YYYY-MM-DD (local time, not UTC). */
export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whole-day difference between two YYYY-MM-DD strings (b - a). */
export function dayDiff(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00`) - Date.parse(`${a}T00:00:00`)) / 86400000);
}

/** Small deterministic hash so "today" always maps to the same goal for everyone. */
export function seedFromStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function mmss(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Score thresholds for each rank. Keep in sync with Game._results().
export const RANK_TIERS = [
  { rank: 'D', min: 0 },
  { rank: 'C', min: 13000 },
  { rank: 'B', min: 22000 },
  { rank: 'A', min: 31000 },
  { rank: 'S', min: 40000 },
];

/**
 * Given a run total, return the current rank plus how far the next tier is.
 * This is the "one more run" hook: a visible gap to the next letter.
 */
export function tierInfo(total) {
  let idx = 0;
  for (let i = 0; i < RANK_TIERS.length; i++) if (total >= RANK_TIERS[i].min) idx = i;
  const cur = RANK_TIERS[idx];
  const next = RANK_TIERS[idx + 1] || null;
  const span = next ? next.min - cur.min : 1;
  return {
    rank: cur.rank,
    next: next ? next.rank : null,
    need: next ? Math.max(0, next.min - total) : 0,
    progress: next ? Math.min(1, Math.max(0, (total - cur.min) / span)) : 1,
  };
}

// Pool of daily goals. One is chosen per calendar day from the date seed.
const GOALS = [
  { id: 'leaves', gen: (s) => 40 + (s % 4) * 15, label: (n) => `Collect ${n} leaves in one run`, test: (r, n) => r.leaves >= n },
  { id: 'enemies', gen: (s) => 6 + (s % 5) * 2, label: (n) => `Take down ${n} enemies`, test: (r, n) => r.enemies >= n },
  { id: 'time', gen: (s) => 120 + (s % 4) * 10, label: (n) => `Finish under ${mmss(n)}`, test: (r, n) => r.time <= n },
  { id: 'score', gen: (s) => 22000 + (s % 4) * 6000, label: (n) => `Score over ${n.toLocaleString()}`, test: (r, n) => r.total >= n },
  { id: 'rank', gen: () => 0, label: () => 'Earn rank B or better', test: (r) => ['S', 'A', 'B'].includes(r.rank) },
];

/** The deterministic goal for a given day. `test(run)` checks a finished run. */
export function dailyGoal(dateStr = todayStr()) {
  const s = seedFromStr(dateStr);
  const g = GOALS[s % GOALS.length];
  const n = g.gen(Math.floor(s / 7));
  return { id: g.id, n, dateStr, label: g.label(n), test: (r) => g.test(r, n) };
}

/**
 * Advance the streak for "played today". Mutates `save` in place and returns
 * the current streak. Call once when a real run starts.
 *   same day    -> unchanged
 *   yesterday   -> +1
 *   older / none -> reset to 1
 */
export function tickStreak(save) {
  const today = todayStr();
  if (save.lastPlayDay === today) return save.streak || 1;
  if (save.lastPlayDay && dayDiff(save.lastPlayDay, today) === 1) save.streak = (save.streak || 0) + 1;
  else save.streak = 1;
  save.lastPlayDay = today;
  save.bestStreak = Math.max(save.bestStreak || 0, save.streak);
  return save.streak;
}

/** Streak to display on the title: 0 once a day has been missed. */
export function activeStreak(save) {
  if (!save.lastPlayDay) return 0;
  const d = dayDiff(save.lastPlayDay, todayStr());
  if (d <= 0) return save.streak || 0;
  if (d === 1) return save.streak || 0; // played yesterday — still alive today
  return 0;
}
