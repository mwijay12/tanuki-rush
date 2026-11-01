import * as THREE from 'three';
import { TrackBuilder, offsetTrack, makeFrame, WALL_LEFT, WALL_RIGHT } from '../track/Track.js';

// =============================================================================
// "HILLSIDE CITY" — the course.
// Turtle conventions: turn > 0 = right, pitch > 0 = up, bank > 0 = right side down.
// b.mark(name) records the position where the NEXT command starts.
// =============================================================================

const BOTH = WALL_LEFT | WALL_RIGHT;

export function buildMainTrack() {
  const b = new TrackBuilder({ start: new THREE.Vector3(0, 624, 0), heading: 0 });

  // ------------------------------------------------------------------ BOARD (leaf-board downhill)
  b.set({ zone: 'board', style: 'street', halfWidth: 10, walls: BOTH });
  b.straight(45).mark('start');
  b.straight(15);
  b.mark('b_crest').pitchTo(-13, 60);
  b.mark('b_s1').straight(150);
  b.mark('b_turn1').turn(-30, 170, { bank: -6 });
  b.mark('b_flat').pitchTo(-6, 40);
  b.straight(80);
  b.pitchTo(-14, 40);
  b.mark('b_s2').straight(130);
  b.mark('b_turn2').turn(38, 190, { bank: 8 });
  b.straight(40);
  b.mark('b_end').pitchTo(-5, 40);
  b.straight(60);

  // ------------------------------------------------------------------ CITY
  b.set({ zone: 'city', halfWidth: 9 });
  b.mark('city_start').straight(40);
  b.pitchTo(-8, 30);
  b.mark('c_s1').straight(90);
  b.mark('c_turn1').turn(-45, 150, { bank: -7 });
  b.mark('loop1_pre').pitchTo(0, 40);
  b.straight(45);
  b.set({ style: 'loop', halfWidth: 6.5, stick: 1 });
  b.straight(12);
  b.mark('loop1').loop(15, 16);
  b.straight(12);
  b.set({ style: 'street', halfWidth: 9, stick: 0 });
  b.mark('c_s2').straight(40);
  b.pitchTo(-11, 40);
  b.mark('c_s3').straight(170);
  b.mark('c_turn2').turn(30, 120, { bank: 5 });
  b.pitchTo(-3, 30);
  b.set({ halfWidth: 6.2 });
  b.mark('rail_pre').straight(45);
  b.set({ floor: 0, groundDrop: 28, style: 'bridge' });
  b.mark('railgap').seg(78, { rise: -5, ease: 'linear' });
  b.set({ floor: 1, groundDrop: 0, style: 'street', halfWidth: 9 });
  b.mark('railgap_end').straight(60);
  b.mark('c_s4').pitchTo(-8, 30);
  b.straight(90);
  b.pitchTo(0, 20);
  b.mark('homing_pre').straight(44);
  b.set({ floor: 0, groundDrop: 30, style: 'bridge' });
  b.mark('hominggap').straight(60);
  b.set({ floor: 1, groundDrop: 0, style: 'street' });
  b.mark('homing_end').straight(46);
  b.mark('c_turn3').turn(55, 160, { bank: 8 });
  b.pitchTo(-5, 30);
  b.mark('climb_pre').straight(110);
  b.pitchTo(0, 12);

  // ------------------------------------------------------------------ CLIMB & ROOFTOPS
  b.set({ zone: 'roof', style: 'loop', halfWidth: 8, walls: BOTH });
  b.mark('climb').straight(4);
  b.pitchTo(90, 17);
  b.set({ style: 'facade', solid: 1, groundDrop: 38 });
  b.mark('wallup').straight(30);
  b.set({ style: 'roof', groundDrop: 62 });
  b.pitchTo(0, 11);
  b.mark('roof1').straight(74);
  b.set({ floor: 0, solid: 0, style: 'roof' });
  b.mark('roofgap1').seg(26, { rise: -6, ease: 'linear' });
  b.set({ floor: 1, solid: 1, groundDrop: 58 });
  b.mark('roof2').straight(64);
  b.set({ floor: 0, solid: 0, groundDrop: 50 });
  b.mark('roofgap2').seg(48, { rise: -8, ease: 'linear' });
  b.set({ floor: 1, solid: 1, groundDrop: 82 });
  b.mark('roof3').straight(55);
  b.set({ style: 'facade', groundDrop: 34, stick: 1 });
  b.mark('drop').pitchTo(-90, 7);
  b.straight(52);
  b.set({ style: 'loop', solid: 0, groundDrop: 0, halfWidth: 9 });
  b.mark('drop_bottom').pitchTo(-12, 22);

  // ------------------------------------------------------------------ TRUCK CHASE
  b.set({ zone: 'chase', style: 'street', halfWidth: 11, stick: 0 });
  b.mark('chase_start').straight(40);
  b.pitchTo(-12, 40);
  b.mark('ch_s1').straight(200);
  b.mark('ch_turn1').turn(-35, 220, { bank: -7 });
  b.mark('ch_s2').straight(120);
  b.pitchTo(-6, 40);
  b.mark('ch_turn2').turn(40, 200, { bank: 7 });
  b.pitchTo(-12, 40);
  b.mark('ch_s3').straight(170);
  b.pitchTo(-3, 30);
  b.mark('canal_pre').straight(20);
  b.set({ floor: 0, groundDrop: 60, style: 'bridge' });
  b.mark('canal').seg(64, { rise: -9, ease: 'linear' });

  // ------------------------------------------------------------------ BAY
  b.set({ zone: 'bay', floor: 1, style: 'highway', halfWidth: 9, groundDrop: 42, walls: BOTH });
  b.mark('bay_start').pitchTo(0, 20);
  b.straight(70);
  b.mark('bay_turn1').turn(-50, 200, { bank: -10 });
  b.mark('cork_pre').straight(40);
  b.set({ style: 'loop', halfWidth: 6.5, stick: 1 });
  b.straight(10);
  b.mark('cork').corkscrew(130, 1);
  b.straight(10);
  b.set({ style: 'highway', halfWidth: 9, stick: 0 });
  b.mark('rings_pre').straight(50);
  b.set({ floor: 0, groundDrop: 44 });
  b.mark('ringgap').seg(100, { rise: -2, ease: 'linear' });
  b.set({ floor: 1, groundDrop: 40 });
  b.mark('ringgap_end').straight(10);
  b.mark('bay_turn2').turn(60, 220, { bank: 10 });
  b.pitchTo(-5, 40);
  b.mark('final_pre').straight(90);
  b.pitchTo(0, 20);
  b.straight(20);
  b.set({ floor: 0, groundDrop: 34 });
  b.mark('finalgap').straight(56);
  b.set({ floor: 1, style: 'pier', halfWidth: 12, groundDrop: 24 });
  b.mark('pier').straight(136);
  b.mark('goal').straight(90);
  b.mark('end');
  return b.build();
}

// =============================================================================
// Object placement helpers — everything is specified in track coordinates.
// =============================================================================

class Placer {
  constructor(main) {
    this.main = main;
    this.m = main.marks;
    this.items = { leaves: [], panels: [], springs: [], ramps: [], enemies: [], rings: [], cars: [], checkpoints: [] };
  }
  at(s, x = 0, h = 0) { return this.main.point(s, x, h, new THREE.Vector3()); }
  frame(s) { return this.main.sample(s, makeFrame()); }
  M(name) { const v = this.m[name]; if (v === undefined) throw new Error('mark ' + name); return v; }

  leafLine(s0, s1, x = 0, h = 1.1, gap = 4.5, xEnd = x) {
    const n = Math.max(1, Math.round((s1 - s0) / gap));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const s = s0 + (s1 - s0) * t;
      const xx = x + (xEnd - x) * t;
      this.items.leaves.push({ s, x: xx, h, pos: this.at(s, xx, h) });
    }
  }
  leafArc(s0, s1, x, h0, peak, h1 = h0, count = 7) {
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const s = s0 + (s1 - s0) * t;
      const h = h0 + (h1 - h0) * t + peak * 4 * t * (1 - t);
      this.items.leaves.push({ s, x, h, pos: this.at(s, x, h) });
    }
  }
  panel(s, x = 0, speed = 64) { this.items.panels.push({ s, x, speed }); }
  panels(s, xs, speed) { for (const x of xs) this.panel(s, x, speed); }
  /** Ramp: s is the LIP position (the wedge extends backwards). launchVel = fixed launch velocity (optional). */
  ramp(s, x = 0, { angle = 24, width = 7, speed = null, trick = true, big = false, launchVel = null } = {}) {
    this.items.ramps.push({ s, x, angle, width, speed, trick, big, launchVel });
  }
  rampLipPos(s, x, angle, big = false) {
    const len = big ? 11 : 8;
    return this.at(s, x, Math.tan((angle * Math.PI) / 180) * len * 0.5 + 0.05 + 0.65);
  }
  spring(s, x, h = 0, { dir = null, power = 30, lock = 0.5, gravity = 1 } = {}) {
    const F = this.frame(s);
    const d = dir ? dir(F) : F.up.clone();
    this.items.springs.push({ s, x, h, pos: this.at(s, x, h), dir: d.normalize(), power, lock, gravity });
  }
  enemy(s, x, h = 1.4, type = 'drone', extra = {}) {
    this.items.enemies.push({ s, x, h, type, pos: this.at(s, x, h), ...extra });
  }
  ring(s, x, h, { power = 45, up = 0.18, lock = 0.45, gravity = 0.3, dir = null } = {}) {
    const F = this.frame(s);
    const d = dir || F.tan.clone().addScaledVector(new THREE.Vector3(0, 1, 0), up).normalize();
    const r = { s, x, h, pos: this.at(s, x, h), dir: d, power, lock, gravity };
    this.items.rings.push(r);
    return r;
  }
  car(s, x, color, kind = 'car') { this.items.cars.push({ s, x, color, kind }); }
  checkpoint(s) { this.items.checkpoints.push({ s }); }
}

/**
 * Find a launch direction (unit vector) so that a body launched from `from` with `power`
 * passes through `to`, using the same air physics as the game (reduced gravity while locked).
 */
export function aimLaunch(from, to, power, lock = 0.45, gravityScale = 0.3, G = 38) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const Dh = Math.hypot(dx, dz);
  const hx = dx / Dh, hz = dz / Dh;
  const heightAt = (theta) => {
    let px = 0, py = from.y, vy = Math.sin(theta) * power;
    const vh = Math.cos(theta) * power;
    let lockLeft = lock;
    const dt = 1 / 240;
    for (let i = 0; i < 4000 && px < Dh; i++) {
      const g = G * (lockLeft > 0 ? gravityScale : 1);
      lockLeft -= dt;
      vy -= g * dt;
      px += vh * dt;
      py += vy * dt;
    }
    return py;
  };
  let lo = -0.6, hi = 1.1;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (heightAt(mid) < to.y) lo = mid; else hi = mid;
  }
  const th = (lo + hi) / 2;
  return new THREE.Vector3(hx * Math.cos(th), Math.sin(th), hz * Math.cos(th));
}

const CAR_COLORS = [0xd8342c, 0x2f6fd6, 0xf2c230, 0xffffff, 0x2aa876, 0xff7a2f, 0x9b59d6, 0x222831, 0x5cc8e8];

export function buildLevel() {
  const main = buildMainTrack();
  const P = new Placer(main);
  const M = (n) => P.M(n);
  const rails = [];
  let ci = 0;
  const carColor = () => CAR_COLORS[(ci++ * 7) % CAR_COLORS.length];

  // ---------------------------------------------------------------- BOARD
  P.leafLine(M('b_crest') + 15, M('b_crest') + 60, 0, 1.0, 5);
  P.leafLine(M('b_s1') + 10, M('b_s1') + 60, -5, 1.0, 5);
  P.car(M('b_s1') + 40, 5.2, carColor());
  P.car(M('b_s1') + 95, -5.5, carColor());
  P.leafLine(M('b_s1') + 80, M('b_s1') + 140, 4.5, 1.0, 5, -4.5);
  P.car(M('b_turn1') + 20, 2.0, carColor());
  P.leafLine(M('b_turn1') + 40, M('b_turn1') + 120, -6, 1.0, 6);
  P.car(M('b_turn1') + 90, 5.5, carColor(), 'van');
  const r1 = M('b_flat') + 70;
  P.ramp(r1, 0, { angle: 22, width: 12, trick: true });
  P.leafArc(r1 + 6, r1 + 52, 0, 4, 7, 1.2, 8);
  P.leafLine(M('b_s2') + 10, M('b_s2') + 60, 5, 1.0, 5);
  P.car(M('b_s2') + 75, -5, carColor());
  P.car(M('b_s2') + 110, 4.5, carColor());
  P.car(M('b_turn2') + 30, -1.5, carColor(), 'van');
  P.leafLine(M('b_turn2') + 60, M('b_turn2') + 180, 0, 1.0, 6, 6);
  const rEnd = M('b_end') + 70;
  P.ramp(rEnd, 0, { angle: 26, width: 14, trick: true, big: true });
  P.leafArc(rEnd + 8, rEnd + 70, 0, 5, 10, 2, 9);

  // ---------------------------------------------------------------- CITY
  P.checkpoint(M('city_start') + 25);
  P.leafLine(M('city_start') + 50, M('city_start') + 90, 0, 1.1, 4.5);
  P.enemy(M('c_s1') + 30, -3);
  P.enemy(M('c_s1') + 60, 3.5);
  P.leafLine(M('c_s1') + 10, M('c_s1') + 80, 5.5, 1.1, 5);
  P.leafLine(M('c_turn1') + 10, M('c_turn1') + 110, -4, 1.1, 6, 3);
  P.panels(M('loop1_pre') + 40, [-3, 3], 66);
  P.panels(M('loop1_pre') + 70, [0], 70);
  P.panels(M('loop1') - 6, [-4, 0, 4], 70);
  P.leafLine(M('loop1') + 4, M('loop1') + 100, 0, 1.2, 6);
  P.checkpoint(M('c_s2') + 20);
  P.leafLine(M('c_s2') + 10, M('c_s2') + 60, -4, 1.1, 5);
  P.enemy(M('c_s2') + 100, 0, 1.4);
  P.car(M('c_s2') + 75, -5, carColor());
  P.car(M('c_s2') + 130, 5, carColor());
  P.enemy(M('c_s3') + 150, -4, 1.4);
  P.enemy(M('c_s3') + 155, 4, 1.4);
  P.leafLine(M('c_s3') + 160, M('c_turn2') + 60, 0, 1.1, 5);
  P.car(M('c_turn2') + 40, -4.5, carColor(), 'van');
  P.panels(M('rail_pre') + 10, [0], 60);
  // kicker right at the gap edge launches the hero onto three rails
  const rg = M('railgap');
  P.ramp(rg - 1, 0, { angle: 17, width: 12.4, trick: false });
  const rg0 = rg - 4, rg1 = M('railgap_end') + 6;
  for (const x of [-4, 0, 4]) {
    rails.push(offsetTrack(main, rg0, rg1, () => x, (t) => 1.2 + Math.sin(Math.PI * t) * 1.5, { name: 'rail' }));
  }
  P.leafLine(rg0 + 12, rg1 - 10, 0, 3.4, 6);
  P.leafLine(rg0 + 12, rg1 - 10, -4, 3.4, 12);
  P.leafLine(rg0 + 18, rg1 - 10, 4, 3.4, 12);
  P.checkpoint(M('railgap_end') + 30);
  P.leafLine(M('c_s4') + 10, M('c_s4') + 110, 3.5, 1.1, 5, -3.5);
  // homing chain across a gap
  const hg = M('hominggap');
  P.ramp(hg - 1, 0, { angle: 20, width: 12, trick: false });
  P.enemy(hg + 12, 0, 4.6, 'drone', { chain: true });
  P.enemy(hg + 25, 0, 5.6, 'drone', { chain: true });
  P.enemy(hg + 38, 0, 5.2, 'drone', { chain: true });
  P.enemy(hg + 50, 0, 3.6, 'drone', { chain: true });
  P.leafLine(M('homing_end') + 10, M('homing_end') + 40, 0, 1.1, 5);
  P.enemy(M('c_turn3') + 30, -3);
  P.enemy(M('c_turn3') + 60, 3);
  P.leafLine(M('c_turn3') + 70, M('c_turn3') + 160, -5, 1.1, 6, 5);
  // wall-climb run-up
  P.panels(M('climb_pre') + 20, [-3, 3], 70);
  P.panels(M('climb_pre') + 55, [0], 74);
  P.panels(M('climb_pre') + 90, [-2.5, 2.5], 78);
  P.panels(M('climb') + 2, [0], 78);
  P.panels(M('wallup') + 6, [-2.5, 2.5], 76);
  P.leafLine(M('wallup') + 2, M('wallup') + 28, 0, 1.2, 4);

  // ---------------------------------------------------------------- ROOFTOPS
  P.checkpoint(M('roof1') + 6);
  P.leafLine(M('roof1') + 12, M('roof1') + 50, -4, 1.1, 5, 4);
  P.enemy(M('roof1') + 40, 3.5);
  P.ramp(M('roofgap1') - 1, 0, { angle: 20, width: 15, trick: true });
  P.leafArc(M('roofgap1') + 4, M('roof2') + 10, 0, 2.5, 5, 1.2, 8);
  P.leafLine(M('roof2') + 12, M('roof2') + 40, 0, 1.1, 5);
  P.enemy(M('roof2') + 30, -3.5);
  // power-line wires to grind across gap 2 (a kicker at the edge hops you on)
  const w0 = M('roofgap2') - 3, w1 = M('roof3') + 10;
  for (const x of [-4, 0, 4]) {
    rails.push(offsetTrack(main, w0, w1, () => x, (t) => 1.4 + Math.sin(Math.PI * t) * 2.0, { name: 'wire' }));
  }
  P.ramp(M('roofgap2') - 1, 0, { angle: 17, width: 16, trick: false });
  P.leafLine(w0 + 10, w1 - 8, 0, 3.6, 6);
  P.leafLine(M('roof3') + 6, M('roof3') + 46, 0, 1.1, 5);
  P.panels(M('roof3') + 30, [0], 66);
  P.leafLine(M('drop') + 10, M('drop') + 56, 0, 1.0, 4);

  // ---------------------------------------------------------------- CHASE
  const cs = M('chase_start');
  P.checkpoint(cs + 8);
  P.leafLine(cs + 30, cs + 90, 0, 1.1, 5);
  for (let k = 0; k < 7; k++) P.car(M('ch_s1') + 20 + k * 28, (k % 2 ? 1 : -1) * (3 + (k % 3) * 2), carColor(), k % 3 === 1 ? 'van' : 'car');
  P.leafLine(M('ch_s1') + 10, M('ch_s1') + 200, 0, 1.1, 7);
  P.panels(M('ch_turn1') + 10, [-4, 4], 66);
  P.leafLine(M('ch_turn1') + 40, M('ch_turn1') + 140, -6, 1.1, 6, 6);
  for (let k = 0; k < 4; k++) P.car(M('ch_s2') + 10 + k * 30, (k % 2 ? 1 : -1) * 5, carColor());
  P.enemy(M('ch_s2') + 60, 0, 1.4);
  P.panels(M('ch_turn2') + 150, [0], 68);
  for (let k = 0; k < 5; k++) P.car(M('ch_s3') + 15 + k * 30, (k % 2 ? -1 : 1) * (2 + k), carColor(), k === 2 ? 'van' : 'car');
  P.leafLine(M('ch_s3') + 10, M('ch_s3') + 160, 0, 1.1, 6);
  P.panels(M('canal_pre') - 20, [-3, 3], 70);
  const cr = M('canal') - 1;
  P.ramp(cr, 0, { angle: 24, width: 20, trick: true, big: true });
  P.leafArc(cr + 8, M('bay_start') + 6, 0, 4, 9, 1.5, 10);

  // ---------------------------------------------------------------- BAY
  P.checkpoint(M('bay_start') + 60);
  P.leafLine(M('bay_start') + 70, M('bay_turn1') + 180, 0, 1.1, 6, -4);
  P.panels(M('cork_pre') + 20, [0], 70);
  P.leafLine(M('cork') + 10, M('cork') + 120, 0, 1.2, 5);
  // dash-ring flight over the ring gap: the kicker and every ring aim exactly at the next one
  const rgp = M('ringgap');
  const ringA = P.ring(rgp + 22, 0, 6.5, { power: 48 });
  const ringB = P.ring(rgp + 52, 0, 8.5, { power: 50 });
  const ringC = P.ring(rgp + 80, 0, 8.0, { power: 52 });
  const landing = P.at(M('ringgap_end') + 26, 0, 1.2);
  ringA.dir = aimLaunch(ringA.pos, ringB.pos, ringA.power, ringA.lock, ringA.gravity);
  ringB.dir = aimLaunch(ringB.pos, ringC.pos, ringB.power, ringB.lock, ringB.gravity);
  ringC.dir = aimLaunch(ringC.pos, landing, ringC.power, ringC.lock, ringC.gravity);
  {
    const lip = P.rampLipPos(rgp - 1, 0, 22);
    const dir = aimLaunch(lip, ringA.pos, 46, 0.2, 1);
    P.ramp(rgp - 1, 0, { angle: 22, width: 14, trick: false, launchVel: dir.multiplyScalar(46) });
  }
  P.leafLine(rgp + 28, rgp + 46, 0, 8.0, 5);
  P.leafLine(rgp + 58, rgp + 74, 0, 9.5, 5);
  P.enemy(M('bay_turn2') + 60, -3);
  P.enemy(M('bay_turn2') + 90, 3);
  P.leafLine(M('bay_turn2') + 20, M('bay_turn2') + 200, 5, 1.1, 6, -5);
  P.checkpoint(M('final_pre') + 10);
  P.panels(M('final_pre') + 50, [0], 64);
  const fg = M('finalgap');
  P.ramp(fg - 1, 0, { angle: 20, width: 12, trick: false });
  P.enemy(fg + 12, 0, 4.8, 'drone', { chain: true });
  P.enemy(fg + 26, 0, 6.0, 'drone', { chain: true });
  P.enemy(fg + 40, 0, 5.4, 'drone', { chain: true });
  P.enemy(fg + 52, 0, 3.6, 'drone', { chain: true });
  P.leafLine(M('pier') + 10, M('goal') - 10, 0, 1.2, 5);

  // -------- camera hints (height / distance offsets for set pieces)
  const cameraHints = [
    { s0: M('climb') - 5, s1: M('roof1') + 5, height: 1.2, dist: 1.5, fade: 8 },
    { s0: M('drop') - 5, s1: M('drop_bottom') + 30, height: 2.5, dist: 2.5, fade: 10 },
    { s0: M('cork') - 5, s1: M('cork') + 140, dist: 1.0, fade: 20 },
  ];

  // stretches with no street-side buildings (vista of the city & bay); side: +1 right, -1 left
  const openSides = [
    { s0: M('start') - 30, s1: M('b_s1') + 120, side: 1 },
    { s0: M('b_crest') + 10, s1: M('b_crest') + 70, side: -1 },
    { s0: M('c_s3') + 20, s1: M('c_s3') + 130, side: 1 },
  ];

  // one-time tutorial hints (shown once per run when the hero passes s)
  const hints = [
    { s: M('start') + 5, text: '← → で左右に移動。リーフを集めよう！', touch: '左側をドラッグで移動。リーフを集めよう！' },
    { s: M('b_flat') + 40, text: 'ジャンプ台の後は ↑↓←→ でトリック！', touch: 'ジャンプ台で大ジャンプ！' },
    { s: M('c_s1') + 2, text: 'JUMP → 空中でもう一度 JUMP でホーミングアタック！', touch: 'JUMP → 空中でもう一度 JUMP でホーミング！' },
    { s: M('loop1_pre') + 20, text: 'SHIFT でブースト！ 敵も車も吹き飛ばせ', touch: 'BOOST で一気に加速！' },
    { s: M('rail_pre') + 5, text: 'ジャンプ台からレールに乗ってグラインド！' },
    { s: M('homing_pre') + 5, text: '敵から敵へホーミングで谷を越えろ！' },
  ];

  const truck = {
    triggerS: M('chase_start') + 14,
    endS: M('canal') + 10,
    speed: 52,
    spawnBehind: 42,
  };

  return {
    main,
    rails,
    items: P.items,
    startS: M('start'),
    boardEndS: rEnd + 1,
    goalS: M('goal'),
    cameraHints,
    openSides,
    hints,
    truck,
    marks: main.marks,
  };
}
