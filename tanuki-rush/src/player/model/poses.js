// Procedural poses. Every pose writes into a flat Float32Array of "channels" so states can be
// cross-faded cheaply without allocating. All angles in radians; 0 = bind pose.
//
// Rotation conventions (bind pose: limbs hang straight down, model faces +Z):
//   shoulder/thigh (order ZXY): x = swing (+ back / - forward), y = twist, z = raise/spread
//                               (helpers mirror y/z for the right side so "+" = outward)
//   elbow x: negative = bend forearm forward (helper takes a positive "bend")
//   knee  x: positive = bend shin backward
//   ankle x: positive = toes down
//   rig   (order ZXY): x = lean forward, y = yaw (innermost), z = roll (+ = lean to hero's right, -X)
//   tail  x: + raises the tail, y: sway

export const CHANNELS = [
  'rigPY', 'rigPZ', 'rigRX', 'rigRY', 'rigRZ', 'rigSY',
  'hipsRX', 'hipsRY', 'hipsRZ',
  'spineRX', 'spineRY', 'spineRZ',
  'headRX', 'headRY', 'headRZ',
  'earLRX', 'earLRZ', 'earRRX', 'earRRZ',
  'leafRX', 'leafRZ',
  'shLRX', 'shLRY', 'shLRZ', 'elLRX', 'elLRY', 'wrLRX', 'wrLRZ',
  'shRRX', 'shRRY', 'shRRZ', 'elRRX', 'elRRY', 'wrRRX', 'wrRRZ',
  'thLRX', 'thLRY', 'thLRZ', 'knLRX', 'anLRX', 'anLRZ',
  'thRRX', 'thRRY', 'thRRZ', 'knRRX', 'anRRX', 'anRRZ',
  't0RX', 't0RY', 't1RX', 't1RY', 't2RX', 't2RY', 't3RX', 't3RY', 't4RX', 't4RY',
  'eyeClose', 'happyEyes', 'mouthOpen',
  'ribLift',
];

export const I = {};
CHANNELS.forEach((n, i) => {
  I[n] = i;
});
export const NUM_CHANNELS = CHANNELS.length;

// ---------------------------------------------------------------------------
// math helpers (no allocation)
// ---------------------------------------------------------------------------
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a || 1e-6));
  return t * t * (3 - 2 * t);
};
const TAU = Math.PI * 2;
const sin = Math.sin;
const cos = Math.cos;

// segment lengths (must match buildTanuki.js)
const THIGH = 0.115;
const SHIN = 0.11;
const FOOT = 0.105; // ankle -> sole
const HIP_H = 0.33;

/** How much the hips must drop so the soles stay on the ground for a given leg pose. */
export function legDrop(swing, knee, spread) {
  const ext = (THIGH * cos(swing) + SHIN * cos(swing + knee)) * cos(spread) + FOOT;
  return HIP_H - ext;
}

// ---------------------------------------------------------------------------
// limb setters (mirror the right side so poses read naturally)
// ---------------------------------------------------------------------------
export function arm(p, s, swing, raise, twist, bend, wristX = 0, wristZ = 0, elbowTwist = 0) {
  const b = s > 0 ? I.shLRX : I.shRRX;
  p[b] = swing;
  p[b + 1] = twist * s;
  p[b + 2] = raise * s;
  p[b + 3] = -bend;
  p[b + 4] = elbowTwist * s;
  p[b + 5] = wristX;
  p[b + 6] = wristZ * s;
}

export function leg(p, s, swing, spread, twist, knee, ankle, ankleRoll = 0) {
  const b = s > 0 ? I.thLRX : I.thRRX;
  p[b] = swing;
  p[b + 1] = twist * s;
  p[b + 2] = spread * s;
  p[b + 3] = knee;
  p[b + 4] = ankle;
  p[b + 5] = ankleRoll * s;
}

function tail(p, r0, r1, r2, r3, r4, swayAmp, swayPhase, swayLag = 0.6) {
  p[I.t0RX] = r0;
  p[I.t1RX] = r1;
  p[I.t2RX] = r2;
  p[I.t3RX] = r3;
  p[I.t4RX] = r4;
  p[I.t0RY] = swayAmp * 0.6 * sin(swayPhase);
  p[I.t1RY] = swayAmp * sin(swayPhase - swayLag);
  p[I.t2RY] = swayAmp * sin(swayPhase - swayLag * 2);
  p[I.t3RY] = swayAmp * 1.1 * sin(swayPhase - swayLag * 3);
  p[I.t4RY] = swayAmp * 1.2 * sin(swayPhase - swayLag * 4);
}

function ears(p, back, spreadOut, flutter) {
  p[I.earLRX] = -back + flutter;
  p[I.earRRX] = -back - flutter * 0.8;
  p[I.earLRZ] = -spreadOut;
  p[I.earRRZ] = spreadOut;
}

// tail bind direction is ~16.7deg above horizontal (see DIM.tailDir)
const TAIL_BIND_ELEV = Math.atan2(0.3, 1);

// ---------------------------------------------------------------------------
// Pose functions: (p, c) where c = { t, st, speed, steer, phase, flutter, boost, air, boardBob }
// (phase / flutter are integrated phases: never multiply time by a speed-dependent rate)
// ---------------------------------------------------------------------------

export function poseIdle(p, c) {
  const t = c.t;
  const br = sin(t * 2.3);
  p[I.rigSY] = 0.014 * br;
  p[I.spineRX] = -0.05 + 0.02 * br;
  p[I.headRX] = 0.03 * sin(t * 0.9 + 1.0) - 0.02;
  p[I.headRY] = 0.2 * sin(t * 0.43) + 0.05 * sin(t * 1.27);
  p[I.headRZ] = 0.06 * sin(t * 0.37 + 0.5);
  p[I.hipsRY] = -0.04 * sin(t * 0.43);
  // confident stance: fists on hips (akimbo)
  for (let s = 1; s >= -1; s -= 2) {
    arm(p, s, 0.32 + 0.02 * br, 0.78 + 0.02 * br, -1.05, 1.95, 0.3, 0.0);
  }
  const sw = -0.02;
  const kn = 0.07 + 0.02 * br;
  for (let s = 1; s >= -1; s -= 2) leg(p, s, sw, 0.1, 0.16, kn, -(sw + kn), -0.1);
  p[I.rigPY] = -legDrop(sw, kn, 0.1) - 0.002;
  tail(p, 0.42, 0.34, 0.26, 0.16, 0.06, 0.2, t * 1.7);
  const twitch = Math.pow(Math.max(0, sin(t * 0.61)), 24) * sin(t * 38) * 0.18;
  ears(p, 0.0, 0.0, twitch);
  p[I.leafRX] = 0.05 * sin(t * 1.1);
  p[I.leafRZ] = 0.1 * sin(t * 1.6);
}

/** Run cycle. Blends into the ninja sprint (arms swept back) above ~31-38 m/s. */
export function poseRun(p, c) {
  const v = c.speed;
  const fast = clamp01((v - 6) / 28);
  const sprint = smoothstep(30, 38, v);
  const ph = c.phase;
  const amp = lerp(0.6, 1.0, clamp01(v / 10));
  const lean = lerp(lerp(0.16, 0.42, fast), 0.62, sprint);
  const steer = c.steer;

  // --- legs ---
  for (let s = 1; s >= -1; s -= 2) {
    const lp = ph + (s > 0 ? 0 : Math.PI);
    const sw = sin(lp);
    const cw = cos(lp);
    const A = lerp(0.88, 1.05, fast) * amp + 0.15 * sprint;
    const thigh = -A * sw - lean * 0.9 - 0.08;
    const kick = Math.pow(Math.max(0, cos(lp + 0.55)), 1.4);
    const knee = 0.22 + (1.05 + 0.75 * fast + 0.25 * sprint) * kick * amp;
    const contact = Math.pow(Math.max(0, -cw), 0.7);
    const flat = -(lean + thigh + knee);
    const ankle = lerp(0.5, flat, contact);
    leg(p, s, thigh, 0.06, 0.04, knee, ankle);
  }

  // --- arms: pumping (normal) vs swept back (sprint) ---
  for (let s = 1; s >= -1; s -= 2) {
    const sw = sin(ph) * s; // left arm back while left leg forward
    const nSwing = 0.9 * amp * sw + 0.12;
    const nBend = 1.45 + 0.3 * sw;
    // swept back, roughly parallel to the ground regardless of the body lean
    const spSwing = Math.PI / 2 - lean + 0.12 + 0.06 * sin(ph * 2 + s);
    arm(
      p,
      s,
      lerp(nSwing, spSwing, sprint),
      lerp(0.32, 0.3, sprint),
      lerp(0.15, -0.35, sprint),
      lerp(nBend, 0.12, sprint),
      lerp(0.2, -0.55, sprint),
      0,
    );
  }

  // --- body ---
  const bob = 0.034 * amp * (0.5 - 0.5 * cos(ph * 2)) * (1 - 0.45 * sprint);
  p[I.rigPY] = bob - 0.012;
  p[I.rigRX] = lean;
  p[I.hipsRY] = -0.2 * sin(ph) * amp * (1 - 0.5 * sprint);
  p[I.spineRY] = 0.3 * sin(ph) * amp * (1 - 0.75 * sprint);
  p[I.spineRX] = 0.04 + 0.12 * sprint;
  p[I.rigSY] = -0.02 * Math.max(0, -cos(ph * 2)) * (1 - sprint);
  const roll = steer * 0.35 * clamp(v / 12, 0.35, 1);
  p[I.rigRZ] = roll;
  p[I.rigRY] = -steer * 0.1;
  p[I.headRY] = -(p[I.hipsRY] + p[I.spineRY]) - steer * 0.3;
  p[I.headRX] = -lean * 0.8 - 0.06 * sprint;
  p[I.headRZ] = -roll * 0.35;

  // --- secondary: ears / leaf / tail ---
  const fl = sin(c.t * 23) * 0.06 * fast;
  ears(p, 0.2 + 0.6 * fast, 0.05 * fast, fl);
  p[I.leafRX] = -0.2 - 0.8 * fast + 0.1 * sin(c.t * 19) * fast;
  p[I.leafRZ] = 0.08 * sin(ph);
  const stream = smoothstep(3, 22, v);
  // at speed the tail streams up-back (~50-60deg) like a flame: it reads as a bushy tail from
  // the side AND from a chase camera behind/above (a tail pointing straight back is seen end-on).
  const baseStream = -(TAIL_BIND_ELEV + lean) + 1.12;
  tail(
    p,
    lerp(0.4, baseStream, stream),
    lerp(0.3, -0.06, stream),
    lerp(0.2, -0.08, stream),
    lerp(0.12, -0.1, stream),
    lerp(0.05, -0.1, stream),
    lerp(0.22, 0.16, stream) + 0.04 * sprint,
    ph,
    0.75,
  );
  // extra high-speed flutter on top of the stride-synced sway
  const tf = 0.05 * fast;
  p[I.t2RY] += tf * sin(c.flutter * 2.3 - 1.0);
  p[I.t3RY] += tf * sin(c.flutter * 2.3 - 1.8);
  p[I.t4RY] += tf * 1.4 * sin(c.flutter * 2.3 - 2.6);
  p[I.ribLift] = 0;
}

/** Generic airborne pose (e.g. after a spring or ramp, not balled up). */
export function poseAir(p, c) {
  const t = c.t;
  const w = sin(t * 3.1);
  p[I.rigSY] = 0.04;
  p[I.rigRX] = 0.06;
  p[I.spineRX] = -0.08;
  p[I.headRX] = -0.12;
  for (let s = 1; s >= -1; s -= 2) {
    arm(p, s, -0.1 + 0.1 * w * s, 2.2 + 0.12 * sin(t * 4 + s), 0.3, 0.3, -0.2);
    leg(p, s, -1.35 + 0.1 * w * s, 0.16, 0.1, 1.95, 0.5);
  }
  tail(p, 0.55, 0.22, 0.1, 0.05, 0.0, 0.18, t * 3);
  ears(p, 0.35, 0.05, 0.04 * sin(t * 17));
  p[I.leafRX] = -0.35;
  p[I.leafRZ] = 0.1 * sin(t * 5);
  p[I.mouthOpen] = 0.35;
  p[I.ribLift] = 0.35;
}

/** Straight upward stretch (spring launch). */
export function poseSpring(p, c) {
  const t = c.t;
  p[I.rigSY] = 0.09;
  p[I.headRX] = -0.32;
  p[I.spineRX] = -0.1;
  for (let s = 1; s >= -1; s -= 2) {
    arm(p, s, -0.12, 2.45 + 0.05 * sin(t * 9 + s), 0.2, 0.06, -0.2);
    leg(p, s, 0.08, 0.03, 0, 0.06, 0.95);
  }
  tail(p, -1.05, -0.2, -0.1, 0.0, 0.0, 0.12, t * 6);
  ears(p, 0.55, 0.0, 0.05 * sin(t * 21));
  p[I.leafRX] = 0.7;
  p[I.mouthOpen] = 0.75;
  p[I.ribLift] = -1;
}

/** Trick: star-jump with a big grin. */
export function poseTrick(p, c) {
  const t = c.t;
  const pulse = sin(c.st * 9);
  p[I.rigRX] = -0.18;
  p[I.spineRX] = -0.15;
  p[I.headRX] = -0.25;
  p[I.rigSY] = 0.03 * pulse;
  for (let s = 1; s >= -1; s -= 2) {
    arm(p, s, -0.15, 2.05 + 0.08 * pulse, 0.5, 0.12, 0, 0.3);
    leg(p, s, -0.12, 0.62 + 0.05 * pulse, 0.2, 0.2, 0.6);
  }
  tail(p, 0.8, 0.3, 0.1, 0.0, -0.1, 0.25, t * 9);
  ears(p, 0.15, 0.2, 0.06 * sin(t * 15));
  p[I.leafRX] = -0.3;
  p[I.leafRZ] = 0.2 * sin(t * 12);
  p[I.happyEyes] = 1;
  p[I.mouthOpen] = 1;
  p[I.ribLift] = 0.2;
}

/** Knocked back, limbs flailing. */
export function poseHurt(p, c) {
  const f = c.t;
  const st = c.st;
  const jolt = Math.exp(-st * 6);
  p[I.rigRX] = -0.5 - 0.15 * jolt;
  p[I.rigPY] = 0.04;
  p[I.rigSY] = -0.12 * jolt * cos(st * 30);
  p[I.spineRX] = -0.2;
  p[I.headRX] = -0.35;
  p[I.headRZ] = 0.12 * sin(f * 9);
  for (let s = 1; s >= -1; s -= 2) {
    arm(p, s, -0.6 + 0.55 * sin(f * 17 + s), 1.7 + 0.6 * sin(f * 13 + s * 1.7), 0, 0.6 + 0.4 * sin(f * 11 + s));
    leg(p, s, -0.9 + 0.35 * sin(f * 15 + s * 2), 0.25, 0, 0.7 + 0.3 * sin(f * 12 + s), 0.3);
  }
  tail(p, 0.9, 0.3, 0.2, 0.1, 0.0, 0.5, f * 14, 0.5);
  ears(p, -0.2, 0.3, 0.2 * sin(f * 19));
  p[I.leafRZ] = 0.4 * sin(f * 14);
  p[I.eyeClose] = 1;
  p[I.mouthOpen] = 0.85;
  p[I.ribLift] = 0.6;
}

/** Victory: fist pump + hand on hip, looping bounce, big smile. */
export function poseGoal(p, c) {
  const st = c.st;
  const per = 0.62;
  const beat = (st / per) * Math.PI;
  const hop = Math.abs(sin(beat));
  const pump = sin(beat * 2);
  p[I.rigPY] = 0.1 * hop;
  p[I.rigSY] = 0.05 * (hop - 0.5);
  p[I.rigRZ] = 0.06 * sin(beat);
  p[I.spineRX] = -0.12;
  p[I.spineRY] = 0.14;
  p[I.headRX] = -0.2;
  p[I.headRZ] = 0.15;
  p[I.headRY] = -0.12;
  // right arm: fist pump
  arm(p, -1, -0.3 + 0.08 * pump, 2.72 + 0.12 * pump, 0.4, 0.1 + 0.3 * Math.max(0, -pump), -0.3);
  // left arm: fist on hip
  arm(p, 1, 0.32, 0.78, -1.05, 1.95, 0.3);
  const kn = 0.12 + 0.25 * (1 - hop);
  for (let s = 1; s >= -1; s -= 2) leg(p, s, -0.05 - 0.1 * (1 - hop), 0.1, 0.12, kn, 0.1 - kn * 0.6 + 0.2 * hop);
  tail(p, 0.55, 0.3, 0.2, 0.1, 0.0, 0.5, st * 10, 0.5);
  ears(p, 0.0, -0.05, 0.08 * sin(st * 12));
  p[I.leafRZ] = 0.25 * sin(st * 10);
  p[I.happyEyes] = 1;
  p[I.mouthOpen] = 1;
  p[I.ribLift] = 0.1;
}

/** Falling: windmilling arms, bicycling legs. */
export function poseFall(p, c) {
  const f = c.t;
  p[I.rigRX] = -0.28;
  p[I.spineRX] = -0.1;
  p[I.headRX] = -0.25;
  p[I.headRZ] = 0.1 * sin(f * 5);
  for (let s = 1; s >= -1; s -= 2) {
    const a = f * 9 + (s > 0 ? 0 : Math.PI);
    arm(p, s, 1.3 * sin(a), 2.2 + 0.55 * cos(a), 0, 0.2);
    const l = f * 11 + (s > 0 ? 0 : Math.PI);
    leg(p, s, -0.6 + 0.6 * sin(l), 0.14, 0, 0.8 + 0.6 * Math.max(0, cos(l)), 0.3);
  }
  tail(p, 0.9, 0.3, 0.15, 0.05, 0.0, 0.35, f * 12);
  ears(p, -0.5, 0.25, 0.1 * sin(f * 23));
  p[I.leafRX] = 0.6;
  p[I.eyeClose] = 0;
  p[I.mouthOpen] = 1;
  p[I.ribLift] = 1;
}

/** Surfing the leaf board: sideways stance, knees bent, arms out. */
export const BOARD_TOP = 0.13; // board top surface above the root (hover 0.064 + board 0.054 + clearance)
export function poseBoard(p, c) {
  const t = c.t;
  const steer = c.steer;
  const air = c.air;
  const sw = -0.36 - 0.25 * air;
  const kn = 0.9 + 0.5 * air;
  const spread = 0.4;
  p[I.rigRY] = -0.72;
  p[I.spineRY] = 0.26;
  p[I.spineRX] = 0.12 + 0.05 * sin(t * 2.1);
  p[I.spineRZ] = -steer * 0.12;
  p[I.headRY] = 0.4 - steer * 0.15;
  p[I.headRX] = -0.12;
  p[I.headRZ] = -0.06;
  for (let s = 1; s >= -1; s -= 2) {
    leg(p, s, sw, spread, 0.0, kn, -(sw + kn), -spread);
  }
  p[I.rigPY] = BOARD_TOP + c.boardBob - legDrop(sw, kn, spread);
  // arms out for balance (front arm = left, back arm = right), slow balancing sway
  const bal = sin(t * 1.9) * 0.08;
  arm(p, 1, -0.55, 1.3 + bal, 0.2, 0.3, -0.2);
  arm(p, -1, 0.45, 1.15 - bal, 0.2, 0.4, -0.2);
  const v = c.speed;
  const fast = clamp01((v - 6) / 28);
  // raised, streaming tail (reads from behind as well as from the side)
  tail(p, -TAIL_BIND_ELEV + 0.95, -0.08, -0.1, -0.1, -0.08, 0.16, c.flutter, 0.7);
  ears(p, 0.25 + 0.5 * fast, 0.05, sin(t * 21) * 0.05 * fast);
  p[I.leafRX] = -0.3 - 0.7 * fast;
  p[I.ribLift] = 0;
}

/** Rail grind: balancing stance with a small wobble. */
export function poseGrind(p, c) {
  const t = c.t;
  const wob = 0.07 * sin(t * 5.1) + 0.035 * sin(t * 8.3 + 1);
  const sw = -0.3;
  const kn = 0.75;
  const spread = 0.12;
  p[I.rigRY] = -1.05; // sideways-ish so both feet stay close to the rail line (x = 0)
  p[I.rigRZ] = wob + c.steer * 0.1;
  p[I.spineRY] = 0.34;
  p[I.spineRX] = 0.14;
  p[I.headRY] = 0.6;
  p[I.headRX] = -0.1;
  p[I.headRZ] = -wob * 0.6;
  for (let s = 1; s >= -1; s -= 2) leg(p, s, sw, spread, 0, kn, -(sw + kn), -spread);
  p[I.rigPY] = -legDrop(sw, kn, spread);
  for (let s = 1; s >= -1; s -= 2) arm(p, s, -0.25 * s, 1.45 - wob * 2.2 * s, 0.1, 0.2, -0.2);
  const v = c.speed;
  const fast = clamp01((v - 6) / 28);
  tail(p, -TAIL_BIND_ELEV + 0.95, -0.06, -0.08, -0.1, -0.08, 0.18, t * 5, 0.7);
  ears(p, 0.2 + 0.4 * fast, 0.05, sin(t * 19) * 0.05);
  p[I.leafRX] = -0.2 - 0.6 * fast;
  p[I.leafRZ] = wob;
  p[I.ribLift] = 0;
}

/** Tucked (used as the pose the rig "unfolds" from when leaving the ball). */
export function poseBall(p, c) {
  p[I.rigRX] = 0.35;
  p[I.rigPY] = 0.12;
  p[I.spineRX] = 0.45;
  p[I.headRX] = 0.45;
  for (let s = 1; s >= -1; s -= 2) {
    arm(p, s, -1.0, 0.45, 0, 1.8);
    leg(p, s, -1.6, 0.18, 0, 2.2, 0.6);
  }
  tail(p, 0.9, 0.6, 0.5, 0.4, 0.3, 0, 0);
  ears(p, 0.5, 0, 0);
  p[I.leafRX] = -0.6;
  p[I.eyeClose] = 1;
  p[I.ribLift] = 0;
  void c;
}

export const POSES = {
  idle: poseIdle,
  run: poseRun,
  ball: poseBall,
  board: poseBoard,
  grind: poseGrind,
  air: poseAir,
  spring: poseSpring,
  trick: poseTrick,
  hurt: poseHurt,
  goal: poseGoal,
  fall: poseFall,
};

/** Run-cycle frequency (Hz): ~2.5 Hz at 8 m/s -> 6 Hz at 40+ m/s (capped to avoid jitter). */
export function runFrequency(v) {
  if (v < 8) return lerp(1.8, 2.5, clamp01(v / 8));
  return Math.min(6, 2.5 + ((v - 8) * 3.5) / 32);
}

export { TAU };
