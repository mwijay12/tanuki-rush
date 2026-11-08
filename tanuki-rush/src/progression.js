// Offline progression. A run never needs an account or a network connection.
// The functions in this module are deliberately independent of the renderer so
// that dates, rewards and purchases can be tested without a browser.

/** Local calendar day as YYYY-MM-DD. */
export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whole calendar-day difference (b - a), independent of daylight saving. */
export function dayDiff(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export function seedFromStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function mmss(sec) {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

export const RANK_TIERS = [
  { rank: 'D', min: 0 },
  { rank: 'C', min: 13000 },
  { rank: 'B', min: 22000 },
  { rank: 'A', min: 31000 },
  { rank: 'S', min: 40000 },
];

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

// One achievable mission is always to finish a run; two different challenges
// rotate daily. Objectives are evaluated on a *finished* run, not cumulatively.
const CHALLENGES = [
  { id: 'leaves', target: (s) => 25 + (s % 4) * 10, label: (n) => `Collect ${n} leaves`, reward: 30, test: (r, n) => r.collected >= n },
  { id: 'enemies', target: (s) => 2 + (s % 3) * 2, label: (n) => `Defeat ${n} enemies`, reward: 35, test: (r, n) => r.enemies >= n },
  { id: 'time', target: (s) => 180 + (s % 3) * 15, label: (n) => `Finish under ${mmss(n)}`, reward: 40, test: (r, n) => r.time <= n },
  { id: 'score', target: (s) => 13000 + (s % 3) * 4500, label: (n) => `Score ${n.toLocaleString()} points`, reward: 35, test: (r, n) => r.total >= n },
  { id: 'clean', target: () => 1, label: () => 'Finish with at most 1 miss', reward: 35, test: (r, n) => r.deaths <= n },
];

/** Three deterministic, distinct missions for a local calendar day. */
export function dailyMissions(date = todayStr()) {
  const finish = { id: 'finish', date, label: 'Complete a run', reward: 20, test: () => true };
  const chosen = [...CHALLENGES]
    .sort((a, b) => seedFromStr(`${date}:${a.id}`) - seedFromStr(`${date}:${b.id}`))
    .slice(0, 2);
  return [finish, ...chosen.map((challenge) => {
    const target = challenge.target(seedFromStr(`${date}:${challenge.id}:target`));
    return {
      id: challenge.id, date, target, label: challenge.label(target), reward: challenge.reward,
      test: (run) => challenge.test(run, target),
    };
  })];
}

/** The completion list is scoped to the date, so rewards reset once per day. */
export function missionStatus(save, date = todayStr()) {
  const completed = save.missions?.date === date && Array.isArray(save.missions.completed)
    ? save.missions.completed : [];
  return dailyMissions(date).map((mission) => ({ ...mission, done: completed.includes(mission.id) }));
}

// Leaf tokens are not the leaves carried during a run. Trail colours are purely
// cosmetic: they change the boost particles, never speed or handling.
export const TRAILS = Object.freeze([
  { id: 'sky', name: 'Sky Spark', price: 0, swatch: '#85eaff', color: 0x9ff0ff, description: 'The classic blue boost' },
  { id: 'sunset', name: 'Sunset', price: 80, swatch: '#ff995b', color: 0xff8246, description: 'A warm orange glow' },
  { id: 'mint', name: 'Mint Rush', price: 140, swatch: '#79f2a9', color: 0x6fffa4, description: 'Fresh green sparks' },
  { id: 'violet', name: 'Violet Bolt', price: 200, swatch: '#c39aff', color: 0xb584ff, description: 'A flash of purple' },
]);

/** Bring older and partially corrupt saves up to the current shape in place. */
export function normalizeProgress(save) {
  save.tokens = Number.isSafeInteger(save.tokens) && save.tokens >= 0 ? save.tokens : 0;
  const valid = new Set(TRAILS.map((trail) => trail.id));
  const owned = Array.isArray(save.ownedTrails) ? save.ownedTrails.filter((id) => valid.has(id)) : [];
  save.ownedTrails = [...new Set(['sky', ...owned])];
  if (!save.ownedTrails.includes(save.equippedTrail)) save.equippedTrail = 'sky';
  return save;
}

export function equippedTrail(save) {
  return TRAILS.find((trail) => trail.id === save.equippedTrail && save.ownedTrails?.includes(trail.id)) || TRAILS[0];
}

/** Buy (if necessary) and equip a cosmetic. Returns a user-facing outcome. */
export function selectTrail(save, id) {
  normalizeProgress(save);
  const trail = TRAILS.find((item) => item.id === id);
  if (!trail) return { ok: false, reason: 'unknown' };
  if (save.ownedTrails.includes(id)) {
    save.equippedTrail = id;
    return { ok: true, purchased: false, trail };
  }
  if (save.tokens < trail.price) return { ok: false, reason: 'insufficient', trail };
  save.tokens -= trail.price;
  save.ownedTrails.push(id);
  save.equippedTrail = id;
  return { ok: true, purchased: true, trail };
}

/**
 * Award one completed, non-practice run. The caller must invoke this once per
 * run; daily mission rewards themselves cannot be claimed twice on the date.
 */
export function awardRun(save, run, date = todayStr()) {
  normalizeProgress(save);
  const base = 15 + Math.min(40, Math.floor(Math.max(0, run.collected || 0) / 5));
  const missions = missionStatus(save, date);
  const completed = missions.filter((mission) => mission.done).map((mission) => mission.id);
  const newlyCompleted = missions.filter((mission) => !mission.done && mission.test(run));
  for (const mission of newlyCompleted) completed.push(mission.id);
  const bonus = newlyCompleted.reduce((sum, mission) => sum + mission.reward, 0);
  save.missions = { date, completed };
  save.tokens += base + bonus;
  return { base, bonus, total: base + bonus, newlyCompleted, missions: missionStatus(save, date) };
}

/** Advance a streak when a real run starts; same-day starts count only once. */
export function tickStreak(save, today = todayStr()) {
  if (save.lastPlayDay === today) return save.streak || 1;
  if (save.lastPlayDay && dayDiff(save.lastPlayDay, today) === 1) save.streak = (save.streak || 0) + 1;
  else save.streak = 1;
  save.lastPlayDay = today;
  save.bestStreak = Math.max(save.bestStreak || 0, save.streak);
  return save.streak;
}

/** Played yesterday still counts; a missed day or future date does not. */
export function activeStreak(save, today = todayStr()) {
  if (!save.lastPlayDay) return 0;
  const d = dayDiff(save.lastPlayDay, today);
  return d >= 0 && d <= 1 ? save.streak || 0 : 0;
}
