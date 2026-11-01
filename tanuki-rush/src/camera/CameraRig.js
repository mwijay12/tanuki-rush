import * as THREE from 'three';
import { makeFrame } from '../track/Track.js';
import { clamp, damp, smoothstep } from '../core/Events.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

// Chase camera that rides the course spline behind the player.
// Offsets are smoothed in track space so there is no positional lag at high speed.
export class CameraRig {
  constructor(camera, main) {
    this.camera = camera;
    this.main = main;
    this.Fc = makeFrame();
    this.Fp = makeFrame();
    this.Fl = makeFrame();
    this.dist = 6.2;
    this.height = 2.1;
    this.offX = 0;
    this.offH = 0;
    this.upBlend = 0.3;
    this.up = new THREE.Vector3(0, 1, 0);
    this.fov = 70;
    this.fovKick = 0;
    this.shakeAmp = 0;
    this.shakeT = 0;
    this.pullback = 0;
    this.look = new THREE.Vector3();
    this.mode = 'follow';
    this.override = null; // {pos, target, blend}
    this.overrideBlend = 0;
    this.lookBack = 0;
    this.deathPos = new THREE.Vector3();
    this.hints = [];      // [{s0, s1, side, height, dist, look}]
    this.hintSide = 0; this.hintHeight = 0; this.hintDist = 0;
    this.orbit = 0;
    this.truckPush = 0; // 0..1, set by the game when the truck is close behind
    this.fovScale = 1;  // > 1 on portrait screens so the view is not too narrow
  }

  shake(amp, dur = 0.3) {
    amp *= this.shakeScale ?? 1;
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeT = Math.max(this.shakeT, dur);
  }

  kick(fov = 8, pull = 2.5) {
    this.fovKick = Math.max(this.fovKick, fov);
    this.pullback = Math.max(this.pullback, pull);
  }

  snap(player) {
    this.offX = player.mainX * 0.8;
    this.offH = 0;
    this.update(1 / 60, player, true);
  }

  _hintAt(s) {
    for (const h of this.hints) if (s >= h.s0 && s <= h.s1) {
      const k = Math.min(smoothstep(h.s0, h.s0 + (h.fade || 25), s), 1 - smoothstep(h.s1 - (h.fade || 25), h.s1, s));
      return [h, k];
    }
    return [null, 0];
  }

  update(dt, player, instant = false) {
    const cam = this.camera;
    const main = this.main;
    const sp = player.speed;
    const k = instant ? 1 : 0;
    const spf = smoothstep(10, 75, sp);

    if (player.state === 'dead') {
      // stop following; look at the falling player
      cam.lookAt(player.pos);
      this._fov(dt, sp, player);
      return;
    }

    // --- anchor on the spline
    this.pullback = damp(this.pullback, 0, 1.6, dt);
    const [hint, hk] = this._hintAt(player.mainS);
    this.hintSide = damp(this.hintSide, hint ? (hint.side || 0) * hk : 0, 3, dt);
    this.hintHeight = damp(this.hintHeight, hint ? (hint.height || 0) * hk : 0, 3, dt);
    this.hintDist = damp(this.hintDist, hint ? (hint.dist || 0) * hk : 0, 3, dt);

    const wantDist = 5.6 + spf * 1.6 + this.pullback + this.hintDist - this.truckPush * 2.5;
    this.dist = instant ? wantDist : damp(this.dist, wantDist, 4, dt);
    const camS = Math.max(0, player.mainS - this.dist);
    main.sample(camS, this.Fc);
    main.sample(player.mainS, this.Fp);
    const Fc = this.Fc, Fp = this.Fp;

    // up vector: world up on normal roads, follow the track on loops / walls
    const steep = 1 - smoothstep(0.6, 0.93, Math.min(Fc.up.y, Fp.up.y));
    const wantBlend = player.state === 'ground' || player.state === 'rail' ? 0.28 + 0.72 * steep : 0.2 + 0.8 * steep;
    this.upBlend = instant ? wantBlend : damp(this.upBlend, wantBlend, 5, dt);
    _a.copy(WORLD_UP).lerp(Fc.up, this.upBlend).normalize();
    if (instant) this.up.copy(_a); else this.up.lerp(_a, 1 - Math.exp(-8 * dt)).normalize();

    // lateral & vertical offsets follow the player in track space
    const wantX = player.mainX * 0.82 + this.hintSide;
    const h = player.mainH;
    const wantH = (h > 0 ? h * 0.72 : h * 0.95);
    this.offX = instant ? wantX : damp(this.offX, wantX, 7, dt);
    this.offH = instant ? wantH : damp(this.offH, wantH, h > this.offH ? 5 : 9, dt);

    const height = this.height + spf * 0.2 + this.hintHeight + this.truckPush * 4.5;
    const pos = _b.copy(Fc.pos).addScaledVector(Fc.right, this.offX).addScaledVector(Fc.up, height + this.offH);

    // look target: slightly ahead of the player
    const ahead = 3 + sp * 0.06;
    main.sample(player.mainS + ahead, this.Fl);
    const look = _c.copy(player.pos).addScaledVector(this.Fl.tan, ahead * 0.6).addScaledVector(this.up, 0.9);
    // don't look too far down when the player falls below the track
    this.look.copy(look);

    // shake
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = this.shakeAmp * Math.min(1, this.shakeT * 4);
      pos.x += (Math.random() - 0.5) * a; pos.y += (Math.random() - 0.5) * a; pos.z += (Math.random() - 0.5) * a;
      if (this.shakeT <= 0) this.shakeAmp = 0;
    }
    // constant subtle high-speed rumble
    const rum = smoothstep(45, 90, sp) * 0.05 + (player.boosting ? 0.05 : 0);
    if (rum > 0) { pos.x += (Math.random() - 0.5) * rum; pos.y += (Math.random() - 0.5) * rum; }

    // override (cinematics): blend towards a fixed pose
    if (this.override) {
      this.overrideBlend = Math.min(1, this.overrideBlend + dt * (this.override.rate || 2.5));
    } else {
      this.overrideBlend = Math.max(0, this.overrideBlend - dt * 2.5);
    }
    if (this.overrideBlend > 0 && this._ovPos) {
      const t = smoothstep(0, 1, this.overrideBlend);
      if (this.override) { this._ovPos.copy(this.override.pos); this._ovLook.copy(this.override.target); }
      pos.lerp(this._ovPos, t);
      this.look.lerp(this._ovLook, t);
    }

    cam.position.copy(pos);
    cam.up.copy(this.up);
    cam.lookAt(this.look);
    // subtle dutch roll while swerving at speed
    const wantRoll = player.state === 'ground' ? clamp(-player.vx / 14, -1, 1) * 0.045 * smoothstep(15, 60, sp) : 0;
    this.roll = damp(this.roll || 0, wantRoll, 4, dt);
    if (Math.abs(this.roll) > 1e-4) cam.rotateZ(this.roll);
    this._fov(dt, sp, player);
  }

  setOverride(pos, target, rate) {
    if (!this._ovPos) { this._ovPos = new THREE.Vector3(); this._ovLook = new THREE.Vector3(); }
    if (pos) { this.override = { pos, target, rate }; } else this.override = null;
  }

  _fov(dt, sp, player) {
    this.fovKick = damp(this.fovKick, 0, 2.2, dt);
    const want = 68 + 26 * smoothstep(18, 85, sp) + (player.boosting ? 6 : 0) + this.fovKick;
    this.fov = damp(this.fov, clamp(want * this.fovScale, 60, 125), 3.5, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
