import * as THREE from 'three';
import { makeFrame, WALL_LEFT, WALL_RIGHT } from '../track/Track.js';
import { clamp, damp, wrapAngle } from '../core/Events.js';

// Tuning constants (meters, seconds).
export const PC = {
  gravity: 38,
  slopeFactor: 0.62,
  runAccel: 30,
  runMax: 42,
  boardAccel: 24,
  boardMax: 52,
  overDrag: 0.42,
  boostSpeed: 72,
  boostKick: 58,
  boostAccel: 95,
  boostDrain: 0.2,
  boostStart: 0.5,
  brakeDecel: 48,
  vMax: 96,
  lateralMax: 13.5,
  lateralResp: 11,
  boardLateralMax: 12,
  boardLateralResp: 5.5,
  centrifugal: 0.1,
  jumpSpeed: 15,
  jumpHoldTime: 0.22,
  jumpHoldGravity: 0.42,
  airAccel: 30,
  airLateralMax: 14,
  airDashSpeed: 17,
  airDashMax: 64,
  homingRange: 32,
  homingSpeed: 66,
  bounceUp: 15.5,
  wallMinSpeed: 12,
  radius: 0.55,
  coyoteTime: 0.12,
  jumpBufferTime: 0.14,
  railCatch: 1.7,
  railFriction: 1.0,
  railMax: 70,
};

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();

export class Player {
  constructor(level, events) {
    this.level = level;
    this.main = level.main;
    this.events = events;
    this.F = makeFrame();
    this.proj = { frame: makeFrame() };
    this.rproj = { frame: makeFrame() };
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.upV = new THREE.Vector3(0, 1, 0);
    this.visualQuat = new THREE.Quaternion();
    this.leaves = 0;
    this.reset(0);
  }

  reset(s, { board = false, x = 0 } = {}) {
    this.state = 'ground';
    this.track = this.main;
    this.s = s; this.x = x; this.v = 0; this.vx = 0;
    this.mainS = s; this.mainX = x; this.mainH = 0;
    this.onBoard = board;
    this.ball = false;
    this.boosting = false;
    this.boostGauge = PC.boostStart;
    this.controlLock = 0;
    this.invuln = 0;
    this.jumpHold = 0;
    this.jumpBuffer = 0;
    this.coyote = 0;
    this.springLock = 0;
    this.springGravity = 1;
    this.airHeading = 0;
    this.canAirAction = true;
    this.canAirBoost = true;
    this.homingTarget = null;
    this.homing = null;
    this.homingTime = 0;
    this.hurtTimer = 0;
    this.deadTimer = 0;
    this.trick = { active: false, count: 0, score: 0, anim: null, t: 0, dir: 0 };
    this.prevH = 0;
    this.airTime = 0;
    this.groundTime = 0;
    this.goalTime = 0;
    this.frozen = false;
    this.lift = 0;
    this.main.sample(s, this.F);
    this.pos.copy(this.F.pos).addScaledVector(this.F.right, x);
    this.vel.set(0, 0, 0);
    this.fwd.copy(this.F.tan);
    this.upV.copy(this.F.up);
    this._targetQuat(this.visualQuat);
  }

  get speed() { return this.state === 'ground' || this.state === 'rail' ? Math.abs(this.v) : this.vel.length(); }
  get grounded() { return this.state === 'ground'; }
  get attacking() { return this.ball || this.state === 'homing' || this.boosting; }

  // --------------------------------------------------------------------------
  step(dt, inp, first) {
    if (this.frozen) return;
    this.controlLock = Math.max(0, this.controlLock - dt);
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    const jumpPressed = first && inp.take('jump');
    const boostPressed = first && inp.take('boost');
    if (jumpPressed) this.jumpBuffer = PC.jumpBufferTime;
    this._inp = inp;
    this._boostPressed = boostPressed;

    this._updateBoost(dt, inp, boostPressed);

    switch (this.state) {
      case 'ground': this._stepGround(dt, inp); break;
      case 'air': this._stepAir(dt, inp, first); break;
      case 'rail': this._stepRail(dt, inp); break;
      case 'homing': this._stepHoming(dt); break;
      case 'dead': this._stepDead(dt); break;
      case 'goal': this._stepGoal(dt); break;
    }
    if (this.state !== 'dead') this._updateMainProjection();
    this._updateVisual(dt);
  }

  _updateBoost(dt, inp, pressed) {
    if (this.state === 'dead' || this.state === 'goal' || this.hurtTimer > 0) { this.boosting = false; return; }
    if (pressed && !this.boosting && this.boostGauge > 0.08) {
      if (this.state === 'ground' || this.state === 'rail') {
        this.boosting = true;
        this.v = Math.max(this.v, PC.boostKick);
        this.events.emit('boostStart');
      } else if (this.state === 'air' && this.canAirBoost && this.springLock <= 0) {
        // air boost: forward burst
        this.boosting = true;
        this.canAirBoost = false;
        const F = this.proj.frame;
        _v1.set(F.tan.x, 0, F.tan.z);
        if (_v1.lengthSq() > 0.01) {
          _v1.normalize();
          const fw = this.vel.x * _v1.x + this.vel.z * _v1.z;
          const add = Math.max(0, PC.boostKick - fw);
          this.vel.addScaledVector(_v1, add);
          this.vel.y = Math.max(this.vel.y, 1.5);
        }
        this.ball = false;
        this.events.emit('boostStart');
      }
    }
    if (this.boosting) {
      this.boostGauge -= PC.boostDrain * dt;
      if (!inp.boostHeld || this.boostGauge <= 0) {
        this.boostGauge = Math.max(0, this.boostGauge);
        this.boosting = false;
        this.events.emit('boostEnd');
      }
    }
  }

  addBoost(x) { this.boostGauge = clamp(this.boostGauge + x, 0, 1); }

  // --------------------------------------------------------------------------
  _stepGround(dt, inp) {
    const tr = this.track;
    const F = tr.sample(this.s, this.F);
    const lock = this.controlLock > 0 || this.hurtTimer > 0;
    const board = this.onBoard;
    const runMax = board ? PC.boardMax : PC.runMax;
    const accel = board ? PC.boardAccel : PC.runAccel;
    this.groundTime += dt;

    let a = -PC.gravity * F.tan.y * PC.slopeFactor;
    const braking = inp.brake && !lock && !this.boosting;
    if (!braking) {
      // legs can't push on walls / ceilings: running power fades as the surface gets steep
      const grip = clamp(F.up.y * 1.3, 0, 1);
      if (this.v < runMax) a += accel * grip * clamp((runMax - this.v) / (runMax * 0.5), 0, 1);
    } else {
      a -= PC.brakeDecel * (board ? 0.5 : 1) * Math.sign(this.v || 1);
    }
    if (this.boosting) {
      if (this.v < PC.boostSpeed) a += PC.boostAccel;
    } else if (this.v > runMax) {
      a -= PC.overDrag * (this.v - runMax);
    }
    const vPrev = this.v;
    this.v += a * dt;
    if (braking && vPrev > 0 && this.v < 0 && Math.abs(F.tan.y) < 0.3) this.v = 0;
    if (this.v > PC.vMax) this.v = PC.vMax;

    // lateral
    const latMax = board ? PC.boardLateralMax : PC.lateralMax;
    const resp = board ? PC.boardLateralResp : PC.lateralResp;
    const target = (lock ? 0 : inp.steer) * latMax * (this.boosting ? 0.85 : 1);
    this.vx = damp(this.vx, target, resp, dt);
    this.vx -= F.kR * this.v * Math.abs(this.v) * PC.centrifugal * dt;
    this.x += this.vx * dt;

    // walls / edges
    const hw = F.halfWidth - PC.radius;
    if (this.x > hw) {
      if (F.walls & WALL_RIGHT) { this.x = hw; if (this.vx > 0) this.vx = 0; }
      else if (this.x > F.halfWidth + 0.25) { this._leaveGround(F); return; }
    } else if (this.x < -hw) {
      if (F.walls & WALL_LEFT) { this.x = -hw; if (this.vx < 0) this.vx = 0; }
      else if (this.x < -F.halfWidth - 0.25) { this._leaveGround(F); return; }
    }

    this.s += this.v * dt;
    if (this.s <= 0) { this.s = 0; if (this.v < 0) this.v = 0; }
    if (this.s >= tr.length) {
      if (tr === this.main) { this.s = tr.length; this.v = 0; }
      else { tr.sample(tr.length, F); this._syncWorld(F); this._leaveGround(F); return; }
    }

    tr.sample(this.s, F);
    this._syncWorld(F);

    if (!F.floor) { this._leaveGround(F); return; }

    // adhesion on steep / inverted surfaces.
    // On walls that are not upside-down, running out of speed means sliding back down
    // (like a half-pipe) instead of falling off; only truly inverted surfaces drop you.
    if (!F.stick && F.up.y < 0.55) {
      const pullAway = -PC.gravity * F.up.y;
      const centripetal = this.v * this.v * Math.max(F.kU, 0);
      const inverted = F.up.y < -0.25;
      if (inverted && (Math.abs(this.v) < PC.wallMinSpeed || centripetal < pullAway * 0.9)) {
        this._leaveGround(F);
        this.controlLock = 0.3;
        return;
      }
    }

    if (this.jumpBuffer > 0 && !lock) this._jump(F);
  }

  _syncWorld(F) {
    this.pos.copy(F.pos).addScaledVector(F.right, this.x);
    if (this.lift) this.pos.addScaledVector(F.up, this.lift);
    this.vel.copy(F.tan).multiplyScalar(this.v).addScaledVector(F.right, this.vx);
  }

  _jump(F) {
    this.jumpBuffer = 0;
    this.vel.addScaledVector(F.up, PC.jumpSpeed * (this.onBoard ? 0.9 : 1));
    this._toAir();
    this.jumpHold = PC.jumpHoldTime;
    this.ball = !this.onBoard;
    this.coyote = 0;
    this.events.emit('jump', { board: this.onBoard });
  }

  _leaveGround(F) {
    this._syncWorld(F);
    this._toAir();
    this.coyote = PC.coyoteTime;
  }

  _toAir() {
    this.state = 'air';
    this.airTime = 0;
    this.groundTime = 0;
    this.canAirAction = true;
    this.canAirBoost = true;
    this.jumpHold = 0;
    this.springLock = 0;
    this.springGravity = 1;
    const F = this.proj.frame;
    this.airHeading = Math.atan2(F.tan.x, F.tan.z);
    this.prevH = 1;
  }

  // --------------------------------------------------------------------------
  _stepAir(dt, inp, first) {
    this.airTime += dt;
    this.coyote = Math.max(0, this.coyote - dt);
    const lock = this.controlLock > 0 || this.hurtTimer > 0;

    // coyote jump
    if (this.coyote > 0 && this.jumpBuffer > 0 && !lock && this.airTime < PC.coyoteTime) {
      this.vel.y = Math.max(this.vel.y, 0);
      this.vel.addScaledVector(WORLD_UP, PC.jumpSpeed);
      this.jumpBuffer = 0; this.coyote = 0;
      this.jumpHold = PC.jumpHoldTime;
      this.ball = !this.onBoard;
      this.events.emit('jump', { board: this.onBoard });
    }

    let g = PC.gravity;
    if (this.jumpHold > 0 && inp.jumpHeld && this.vel.y > 0) { g *= PC.jumpHoldGravity; this.jumpHold -= dt; }
    else this.jumpHold = 0;
    if (this.springLock > 0) { this.springLock -= dt; g *= this.springGravity; }
    this.vel.y -= g * dt;

    const P = this.main.project(this.pos, this.mainS, this.proj);
    const F = P.frame;

    // follow track heading so jumps on curves stay on course
    const th = Math.hypot(F.tan.x, F.tan.z);
    if (th > 0.35) {
      const heading = Math.atan2(F.tan.x, F.tan.z);
      const dh = wrapAngle(heading - this.airHeading);
      if (Math.abs(dh) < 0.25 && this.springLock <= 0) {
        const c = Math.cos(dh), s = Math.sin(dh);
        const x = this.vel.x, z = this.vel.z;
        this.vel.x = x * c + z * s;
        this.vel.z = -x * s + z * c;
      }
      this.airHeading = heading;
    }

    // air control
    if (!lock && this.springLock <= 0 && th > 0.2) {
      const fx = F.tan.x / th, fz = F.tan.z / th;
      const rx = -fz, rz = fx;
      const lat = this.vel.x * rx + this.vel.z * rz;
      const want = inp.steer * PC.airLateralMax;
      const dl = clamp(want - lat, -PC.airAccel * dt, PC.airAccel * dt);
      this.vel.x += rx * dl; this.vel.z += rz * dl;
      if (inp.brake) {
        const fw = this.vel.x * fx + this.vel.z * fz;
        if (fw > 5) { const d = Math.min(fw - 5, 20 * dt); this.vel.x -= fx * d; this.vel.z -= fz * d; }
      }
      // keep inside the course laterally when there are walls
      const hw = F.halfWidth - PC.radius;
      if (F.floor && P.h < 12) {
        if (P.x > hw && (F.walls & WALL_RIGHT) && lat > 0) { this.vel.x -= rx * lat; this.vel.z -= rz * lat; }
        if (P.x < -hw && (F.walls & WALL_LEFT) && lat < 0) { this.vel.x -= rx * lat; this.vel.z -= rz * lat; }
      }
    }

    // air actions: homing attack / air dash
    if (this.jumpBuffer > 0 && this.canAirAction && !lock && !this.onBoard && this.springLock <= 0 && this.coyote <= 0) {
      this.jumpBuffer = 0;
      this.canAirAction = false;
      if (this.homingTarget && this.homingTarget.alive) {
        this.state = 'homing';
        this.homing = this.homingTarget;
        this.homingTime = 0;
        this.preHomingSpeed = Math.hypot(this.vel.x, this.vel.z);
        this.ball = true;
        this.events.emit('homing', this.homing);
        return;
      } else if (th > 0.2) {
        const fx = F.tan.x / th, fz = F.tan.z / th;
        const fw = this.vel.x * fx + this.vel.z * fz;
        const add = clamp(PC.airDashMax - fw, 0, PC.airDashSpeed);
        this.vel.x += fx * add; this.vel.z += fz * add;
        this.vel.y = Math.max(this.vel.y, 2.5);
        this.ball = true;
        this.events.emit('airdash');
      }
    }

    // trick input after ramps
    if (this.trick.active && first && !lock) this._trickInput(inp);
    if (this.trick.anim) { this.trick.t += dt; if (this.trick.t > 0.45) this.trick.anim = null; }

    this.pos.addScaledVector(this.vel, dt);

    // --- landing on main track
    this.main.project(this.pos, P.s, P);
    const Fm = P.frame;
    const vn = this.vel.dot(Fm.up);
    // ledge assist: just below the lip of a platform right after a gap → pop up onto it
    const ledge = P.h < 0 && P.h > -2.6 && this.prevH < 0 && this.vel.dot(Fm.tan) > 4 && !this.main.floor[this.main.index(P.s - 3)];
    if (Fm.floor && P.h <= 0.02 && (this.prevH > -1.5 || ledge) && Math.abs(P.x) <= Fm.halfWidth + 0.35 && vn <= 0.5 && this.airTime > 0.05) {
      this._land(this.main, P.s, clamp(P.x, -Fm.halfWidth + PC.radius, Fm.halfWidth - PC.radius), Fm);
      return;
    }
    this.prevH = P.h;

    // --- rails
    if (this._tryRails()) return;

    // --- fell out of the world
    if (P.h < -45 || this.pos.y < Fm.pos.y - 45) this.die('fall');
  }

  _tryRails() {
    const rails = this.level.rails;
    if (!rails || !rails.length) return false;
    for (const rail of rails) {
      const b = rail.bounds;
      const p = this.pos, m = 3;
      if (p.x < b.min.x - m || p.x > b.max.x + m || p.y < b.min.y - m || p.y > b.max.y + m || p.z < b.min.z - m || p.z > b.max.z + m) continue;
      const R = rail.projectGlobal(p, this.rproj, 4);
      const d = Math.hypot(R.x, R.h);
      const F = R.frame;
      if (d < PC.railCatch && R.h > -0.9 && R.s > 0.5 && R.s < rail.length - 1.5 && this.vel.dot(F.up) < 2) {
        this.track = rail;
        this.s = R.s;
        this.x = 0;
        this.v = this.vel.dot(F.tan);
        if (Math.abs(this.v) < 18) this.v = 18 * (Math.sign(this.v) || 1);
        this.vx = 0;
        this.state = 'rail';
        this.ball = false;
        this.canAirAction = true;
        this._landTrickCheck();
        this.events.emit('railLand');
        return true;
      }
    }
    return false;
  }

  _land(track, s, x, F) {
    const impact = -this.vel.dot(F.up);
    this.track = track;
    this.s = s;
    this.x = x;
    this.v = this.vel.dot(F.tan);
    this.vx = this.vel.dot(F.right) * 0.5;
    this.state = 'ground';
    this.ball = false;
    this.jumpHold = 0;
    this.springLock = 0;
    this.groundTime = 0;
    if (this.hurtTimer > 0) this.hurtTimer = Math.min(this.hurtTimer, 0.08);
    this._landTrickCheck();
    this._syncWorld(track.sample(s, this.F));
    this.events.emit('land', { impact });
    if (this.jumpBuffer > 0 && this.controlLock <= 0) this._jump(this.F);
  }

  _landTrickCheck() {
    if (this.trick.active) {
      if (this.trick.count > 0) this.events.emit('trickFinish', { count: this.trick.count, score: this.trick.score });
      this.trick.active = false; this.trick.count = 0; this.trick.score = 0; this.trick.anim = null;
    }
  }

  _trickInput(inp) {
    if (this.trick.anim) return;
    let dir = null;
    if (inp.take('up')) dir = 'up';
    else if (inp.take('down')) dir = 'down';
    else if (inp.take('left')) dir = 'left';
    else if (inp.take('right')) dir = 'right';
    if (!dir) return;
    this.trick.anim = dir;
    this.trick.t = 0;
    this.trick.count++;
    this.trick.score += 100 * this.trick.count;
    this.events.emit('trick', { dir, count: this.trick.count });
  }

  // --------------------------------------------------------------------------
  _stepRail(dt, inp) {
    const rail = this.track;
    const F = rail.sample(this.s, this.F);
    let a = -PC.gravity * F.tan.y * 0.85 - PC.railFriction * Math.sign(this.v);
    if (this.boosting && this.v < PC.boostSpeed) a += PC.boostAccel * 0.6;
    this.v += a * dt;
    this.v = clamp(this.v, -PC.railMax, PC.railMax);
    this.s += this.v * dt;
    if (this.s >= rail.length || this.s <= 0) {
      rail.sample(this.s, F);
      this.pos.copy(F.pos);
      this.vel.copy(F.tan).multiplyScalar(this.v).addScaledVector(F.up, 5);
      this.track = this.main;
      this._toAir();
      this.events.emit('railEnd');
      return;
    }
    rail.sample(this.s, F);
    this.pos.copy(F.pos).addScaledVector(F.up, 0.08);
    this.vel.copy(F.tan).multiplyScalar(this.v);
    if (this.jumpBuffer > 0 && this.controlLock <= 0) {
      this.jumpBuffer = 0;
      const th = Math.hypot(F.tan.x, F.tan.z) || 1;
      this.vel.addScaledVector(WORLD_UP, PC.jumpSpeed * 0.95);
      this.vel.x += (-F.tan.z / th) * inp.steer * 7;
      this.vel.z += (F.tan.x / th) * inp.steer * 7;
      this.track = this.main;
      this._toAir();
      this.jumpHold = PC.jumpHoldTime;
      this.ball = true;
      this.events.emit('jump', { rail: true });
    }
  }

  // --------------------------------------------------------------------------
  _stepHoming(dt) {
    const t = this.homing;
    this.homingTime += dt;
    if (!t || !t.alive || this.homingTime > 1.3) {
      this.state = 'air';
      this.homing = null;
      return;
    }
    _v1.subVectors(t.pos, this.pos);
    const d = _v1.length();
    if (d < 1.4) {
      // hit!
      this.events.emit('homingHit', t);
      this.homing = null;
      this.main.project(this.pos, this.mainS, this.proj);
      const F = this.proj.frame;
      const th = Math.hypot(F.tan.x, F.tan.z) || 1;
      const fw = clamp((this.preHomingSpeed || 0) * 0.45, 12, 26);
      this.vel.set((F.tan.x / th) * fw, PC.bounceUp, (F.tan.z / th) * fw);
      this.state = 'air';
      this.airTime = 0.06;
      this.canAirAction = true;
      this.canAirBoost = true;
      this.jumpHold = 0;
      this.prevH = 1;
      this.airHeading = Math.atan2(F.tan.x, F.tan.z);
      this.ball = true;
      return;
    }
    _v1.multiplyScalar(1 / d);
    const sp = Math.max(PC.homingSpeed, this.vel.length() * 0.9);
    this.vel.copy(_v1).multiplyScalar(sp);
    const stepLen = Math.min(d, sp * dt);
    this.pos.addScaledVector(_v1, stepLen);
  }

  /** External launch (springs, ramps, dash rings). */
  launch(vel, { lock = 0.3, gravityScale = 1, ball = false, trick = false, pos = null } = {}) {
    if (this.state === 'dead' || this.state === 'goal') return;
    if (pos) this.pos.copy(pos);
    this.vel.copy(vel);
    this.track = this.main;
    this._toAir();
    this.springLock = lock;
    this.springGravity = gravityScale;
    this.ball = ball;
    this.homing = null;
    this.canAirAction = true;
    this.jumpBuffer = 0;
    if (trick) { this.trick.active = true; this.trick.count = 0; this.trick.score = 0; }
  }

  /** Damage. Returns true if something happened. */
  hurt({ from = 'front', lethal = false } = {}) {
    if (this.invuln > 0 || this.state === 'dead' || this.state === 'goal') return false;
    if (this.leaves <= 0 || lethal) { this.die('hit'); return true; }
    const lost = this.leaves;
    this.leaves = 0;
    this.events.emit('hurt', { lost, pos: this.pos.clone() });
    this.main.project(this.pos, this.mainS, this.proj);
    const F = this.proj.frame;
    const th = Math.hypot(F.tan.x, F.tan.z) || 1;
    const dir = from === 'behind' ? 1 : -1;
    const fwdSpeed = from === 'behind' ? Math.max(this.speed, 30) + 12 : 7;
    this.vel.set((F.tan.x / th) * fwdSpeed * dir, 12, (F.tan.z / th) * fwdSpeed * dir);
    this.track = this.main;
    this._toAir();
    this.hurtTimer = 0.55;
    this.invuln = 2.2;
    this.ball = false;
    this.boosting = false;
    this.homing = null;
    this.trick.active = false;
    return true;
  }

  die(reason) {
    if (this.state === 'dead') return;
    this.deadReason = reason;
    this.state = 'dead';
    this.deadTimer = 0;
    this.boosting = false;
    this.ball = false;
    this.events.emit('death', { reason });
  }

  _stepDead(dt) {
    this.deadTimer += dt;
    this.vel.y -= PC.gravity * 0.6 * dt;
    this.vel.x *= 1 - 1.5 * dt; this.vel.z *= 1 - 1.5 * dt;
    this.pos.addScaledVector(this.vel, dt);
  }

  goal() {
    if (this.state === 'goal') return;
    this.state = 'goal';
    this.goalTime = 0;
    this.boosting = false;
    this.ball = false;
  }

  _stepGoal(dt) {
    this.goalTime += dt;
    if (this.track !== this.main) this.track = this.main;
    const F = this.main.sample(this.s, this.F);
    this.v = damp(this.v, 0, 2.2, dt);
    this.vx = damp(this.vx, 0, 4, dt);
    this.x += this.vx * dt;
    this.s = Math.min(this.main.length, this.s + this.v * dt);
    this.main.sample(this.s, F);
    this._syncWorld(F);
  }

  // --------------------------------------------------------------------------
  _updateMainProjection() {
    if (this.track === this.main && this.state === 'ground') {
      this.mainS = this.s; this.mainX = this.x; this.mainH = 0;
      this.main.sample(this.s, this.proj.frame);
      this.proj.s = this.s; this.proj.x = this.x; this.proj.h = 0;
    } else {
      const P = this.main.project(this.pos, this.mainS, this.proj);
      this.mainS = P.s; this.mainX = P.x; this.mainH = P.h;
    }
  }

  _updateVisual(dt) {
    const F = this.F;
    if (this.state === 'ground' || this.state === 'goal') {
      _v1.copy(this.vel);
      if (_v1.lengthSq() < 0.5) _v1.copy(F.tan);
      this.fwd.copy(_v1.normalize());
      this.upV.copy(F.up);
    } else if (this.state === 'rail') {
      this.fwd.copy(F.tan).multiplyScalar(Math.sign(this.v) || 1);
      this.upV.copy(F.up);
    } else {
      const Fp = this.proj.frame;
      _v1.set(this.vel.x, 0, this.vel.z);
      if (_v1.lengthSq() < 1) _v1.set(Fp.tan.x, 0, Fp.tan.z);
      if (_v1.lengthSq() < 1e-4) _v1.set(0, 0, 1);
      this.fwd.copy(_v1.normalize());
      // ease up-vector back to world up in the air
      this.upV.lerp(WORLD_UP, 1 - Math.exp(-5 * dt)).normalize();
    }
    this._targetQuat(_q);
    const rate = this.state === 'ground' ? 22 : 10;
    this.visualQuat.slerp(_q, 1 - Math.exp(-rate * dt));
  }

  _targetQuat(out) {
    // basis: z = forward, y = up (orthogonalised), x = y × z
    _v2.copy(this.upV);
    _v3.copy(this.fwd).addScaledVector(_v2, -this.fwd.dot(_v2));
    if (_v3.lengthSq() < 1e-6) _v3.set(0, 0, 1).addScaledVector(_v2, -_v2.z);
    _v3.normalize();
    _v1.crossVectors(_v2, _v3).normalize();
    _m.makeBasis(_v1, _v2, _v3);
    return out.setFromRotationMatrix(_m);
  }

  get modelState() {
    switch (this.state) {
      case 'ground': return this.onBoard ? 'board' : Math.abs(this.v) < 0.8 ? 'idle' : 'run';
      case 'rail': return this.onBoard ? 'board' : 'grind';
      case 'homing': return 'ball';
      case 'dead': return 'fall';
      case 'goal': return this.goalTime > 0.8 ? 'goal' : this.onBoard ? 'board' : 'run';
      default:
        if (this.hurtTimer > 0) return 'hurt';
        if (this.onBoard) return 'board';
        if (this.trick.anim) return 'trick';
        if (this.ball) return 'ball';
        if (this.springLock > 0) return 'spring';
        return 'air';
    }
  }
}
