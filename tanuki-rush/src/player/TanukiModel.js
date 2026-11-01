// TANUKI RUSH - player character model (procedural, toon-shaded, fully code-built).
//
//   const m = new TanukiModel();
//   scene.add(m.root);
//   m.setState('run');   // idle | run | ball | board | grind | air | spring | trick | hurt | goal | fall
//   m.update(dt, { speed, steer, boost, airborne });   // every frame, allocation-free (~0.01 ms)
//   m.ballRadius         // 0.55 - ball centre sits at y = ballRadius in root space
//   m.dispose();
//
// Conventions: faces +Z, up +Y, origin at the feet (bottom centre), metres, ~1.3 m tall.
// steer > 0 = turning right = leaning toward the hero's right side (-X).
// The character body/face/outline are 3 skinned draw calls sharing one skeleton; with the
// hachimaki ribbons the running hero costs 4 draw calls (+1 while boosting).
// In 'board' the leaf board is part of the model (hover ~6 cm, top surface ~13 cm above root);
// in 'ball' the limbs are hidden and a spinning ball (+ spin-blur shell) is shown instead.
import * as THREE from 'three';
import { createSkeletonBones, buildTanukiGeometry, DIM } from './model/buildTanuki.js';
import {
  COLORS,
  makeGradientMap,
  makeOutlineMaterial,
  makeOutlineResolutionHook,
  makeToonVertexColorMaterial,
  makeFaceMaterial,
  makeRibbonMaterial,
  makeAuraMaterial,
} from './model/materials.js';
import {
  POSES,
  I,
  NUM_CHANNELS,
  runFrequency,
  poseIdle,
  poseBall,
  poseAir,
  clamp,
  clamp01,
  smoothstep,
  TAU,
} from './model/poses.js';
import { HachimakiRibbons } from './model/Ribbons.js';
import { BallForm } from './model/BallForm.js';
import { LeafBoard } from './model/LeafBoard.js';

export const TANUKI_STATES = Object.freeze(Object.keys(POSES));

const BALL_RADIUS = 0.55;
const BOARD_HOVER = 0.064; // board group origin height above the root

const _m = new THREE.Matrix4();

export class TanukiModel {
  constructor() {
    this.root = new THREE.Object3D();
    this.root.name = 'TanukiModel';
    /** Radius of the ball form (ball centre sits at y = ballRadius in root space). */
    this.ballRadius = BALL_RADIUS;
    /** Standing height (top of head, without ears/leaf) in metres. */
    this.height = DIM.headC.y + DIM.headR.y;

    // ---------------- shared materials ----------------
    this._gradient = makeGradientMap();
    this._toon = makeToonVertexColorMaterial(this._gradient);
    this._faceMat = makeFaceMaterial();
    this._outlineMat = makeOutlineMaterial();
    this._ribbonMat = makeRibbonMaterial(this._gradient);
    const hook = makeOutlineResolutionHook(this._outlineMat);

    // ---------------- hierarchy ----------------
    // root -> stance (board bank) -> rig (lean/roll/yaw/bob/squash) -> bones
    this.stance = new THREE.Object3D();
    this.stance.name = 'TanukiStance';
    this.root.add(this.stance);
    this.rig = new THREE.Object3D();
    this.rig.name = 'TanukiRig';
    this.rig.rotation.order = 'ZXY';
    this.stance.add(this.rig);

    const sk = createSkeletonBones(this.rig);
    this.bones = sk.byName;
    this.root.updateMatrixWorld(true);
    const geos = buildTanukiGeometry(sk.bonePos, sk.boneIndex);
    this.skeleton = new THREE.Skeleton(sk.bones);

    this.body = new THREE.SkinnedMesh(geos.body, this._toon);
    this.body.name = 'TanukiBody';
    this.face = new THREE.SkinnedMesh(geos.face, this._faceMat);
    this.face.name = 'TanukiFace';
    this.outline = new THREE.SkinnedMesh(geos.outline, this._outlineMat);
    this.outline.name = 'TanukiOutline';
    this.outline.onBeforeRender = hook;
    this.stance.add(this.body, this.face, this.outline);
    this.body.bind(this.skeleton);
    this.face.bind(this.skeleton, this.body.bindMatrix);
    this.outline.bind(this.skeleton, this.body.bindMatrix);
    for (const m of [this.body, this.face, this.outline]) m.frustumCulled = false;
    this.body.castShadow = true;
    this.body.renderOrder = 0;
    this.face.renderOrder = 1;
    this.outline.renderOrder = 1;

    // ---------------- ribbons ----------------
    this.ribbons = new HachimakiRibbons(this._ribbonMat);
    this.root.add(this.ribbons.mesh);
    const headPos = sk.bonePos.head;
    this._knotLocal = [
      DIM.knot.clone().sub(headPos).add(new THREE.Vector3(0.028, -0.004, -0.012)),
      DIM.knot.clone().sub(headPos).add(new THREE.Vector3(-0.028, -0.004, -0.012)),
    ];
    this._anchors = [new THREE.Vector3(), new THREE.Vector3()];
    this._ribbonOpts = { speed: 0, lift: 0, steer: 0, boost: 0 };

    // ---------------- ball ----------------
    this.ball = new BallForm(this._toon, this._outlineMat, hook, BALL_RADIUS);
    this.root.add(this.ball.group);

    // ---------------- leaf board ----------------
    this.board = new LeafBoard(this._gradient, this._outlineMat, hook);
    this.board.group.position.y = BOARD_HOVER;
    this.stance.add(this.board.group);

    // ---------------- boost aura (energy hull sharing the outline geometry) ----------------
    this._auraMat = makeAuraMaterial();
    this.aura = new THREE.SkinnedMesh(geos.outline, this._auraMat);
    this.aura.name = 'TanukiAura';
    this.stance.add(this.aura);
    this.aura.bind(this.skeleton, this.body.bindMatrix);
    this.aura.renderOrder = 3;
    this.aura.visible = false;
    this.aura.frustumCulled = false;

    // ---------------- animation state ----------------
    this._state = 'idle';
    this._live = new Float32Array(NUM_CHANNELS);
    this._tmp = new Float32Array(NUM_CHANNELS);
    this._from = new Float32Array(NUM_CHANNELS);
    this._out = new Float32Array(NUM_CHANNELS);
    this._blendT = 1;
    this._blendDur = 0.12;
    this._t = 0;
    this._st = 0;
    this._phase = 0;
    this._flutter = 0;
    this._speed = 0;
    this._steer = 0;
    this._boost = 0;
    this._air = 0;
    this._bank = 0;
    this._pop = 10;
    this._popAmp = 0;
    this._blinkT = 0;
    this._nextBlink = 1.5;
    this._blinkClock = 10;
    this._blinkDouble = false;
    this._ctx = { t: 0, st: 0, speed: 0, steer: 0, phase: 0, flutter: 0, boost: 0, air: 0, boardBob: 0 };
    this._bind = {
      eyesZ: this.bones.eyes.position.z,
    };

    // initial pose
    poseIdle(this._out, this._ctx);
    this._from.set(this._out);
    this._applyPose(this._out);
    this._updateRibbons(0);
    this._setVisibility();
  }

  /** Current state name (assigning it is the same as calling setState). */
  get state() {
    return this._state;
  }

  set state(name) {
    this.setState(name);
  }

  /** Switch animation state (no-op if unchanged). Unknown names are ignored with a warning. */
  setState(name) {
    if (name === this._state) return;
    if (!POSES[name]) {
      console.warn(`[TanukiModel] unknown state "${name}"`);
      return;
    }
    const prev = this._state;
    this._state = name;
    this._st = 0;
    if (name === 'ball') {
      // instant switch + squash pop of the ball
      this.ball.triggerPop();
      this._blendT = this._blendDur = 1;
    } else if (prev === 'ball') {
      // unfold from a tucked pose with a stretch pop
      this._from.fill(0);
      poseBall(this._from, this._ctx);
      this._blendT = 0;
      this._blendDur = 0.14;
      this._pop = 0;
      this._popAmp = 0.22;
    } else {
      this._from.set(this._out);
      this._blendT = 0;
      this._blendDur = name === 'hurt' ? 0.07 : name === 'spring' ? 0.08 : 0.12;
      if (name === 'spring' || name === 'trick') {
        this._pop = 0;
        this._popAmp = 0.12;
      }
    }
    this.board.setActive(name === 'board');
    this._setVisibility();
  }

  /**
   * Per-frame update. dt in seconds.
   * @param {number} dt
   * @param {{speed?:number, steer?:number, boost?:boolean, airborne?:boolean}} o
   */
  update(dt, o) {
    dt = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
    const speedIn = o && Number.isFinite(o.speed) ? Math.max(0, o.speed) : 0;
    const steerIn = o && Number.isFinite(o.steer) ? clamp(o.steer, -1, 1) : 0;
    const boostIn = o && o.boost ? 1 : 0;
    const airIn = o && o.airborne ? 1 : 0;

    this._speed += (speedIn - this._speed) * (1 - Math.exp(-dt * 7));
    this._steer += (steerIn - this._steer) * (1 - Math.exp(-dt * 9));
    this._boost += (boostIn - this._boost) * (1 - Math.exp(-dt * 8));
    this._air += (airIn - this._air) * (1 - Math.exp(-dt * 10));
    this._t += dt;
    this._st += dt;
    const v = this._speed;
    this._phase = (this._phase + TAU * runFrequency(v) * dt) % TAU;
    this._flutter = (this._flutter + (4 + 6 * clamp01((v - 6) / 28)) * dt) % (TAU * 1000);

    const c = this._ctx;
    c.t = this._t;
    c.st = this._st;
    c.speed = v;
    c.steer = this._steer;
    c.phase = this._phase;
    c.flutter = this._flutter;
    c.boost = this._boost;
    c.air = this._air;
    c.boardBob = 0.012 * Math.sin(this._t * 2.7) + 0.006 * Math.sin(this._t * 4.3);

    // ---------------- evaluate the live pose ----------------
    const live = this._live;
    live.fill(0);
    const state = this._state;
    POSES[state](live, c);
    if (state === 'run') {
      // idle <-> run at very low speed, and a partial air pose while airborne
      const w = smoothstep(0.3, 3.5, v);
      if (w < 1) {
        const tmp = this._tmp;
        tmp.fill(0);
        poseIdle(tmp, c);
        for (let i = 0; i < NUM_CHANNELS; i++) live[i] = tmp[i] + (live[i] - tmp[i]) * w;
      }
      if (this._air > 0.01) {
        const tmp = this._tmp;
        tmp.fill(0);
        poseAir(tmp, c);
        const a = this._air * 0.75;
        for (let i = 0; i < NUM_CHANNELS; i++) live[i] += (tmp[i] - live[i]) * a;
      }
    }

    // ---------------- cross-fade from the previous state ----------------
    const out = this._out;
    if (this._blendT < this._blendDur) {
      this._blendT += dt;
      const k = smoothstep(0, 1, this._blendT / this._blendDur);
      const from = this._from;
      for (let i = 0; i < NUM_CHANNELS; i++) out[i] = from[i] + (live[i] - from[i]) * k;
    } else {
      out.set(live);
    }

    this._pop += dt;
    this._applyPose(out);
    this._updateFace(dt, out);

    // board bank (whole stance rolls with the board)
    const bankTarget = state === 'board' ? this._steer * 0.32 : 0;
    this._bank += (bankTarget - this._bank) * (1 - Math.exp(-dt * 8));
    this.stance.rotation.set(state === 'board' ? -0.06 * this._air : 0, 0, this._bank);
    this.board.group.position.y = BOARD_HOVER + c.boardBob;
    if (this.board.group.visible) this.board.update(dt, this._t, v, this._boost);

    if (state === 'ball') this.ball.update(dt, this._t, v, this._boost);

    // boost aura
    const auraOn = this._boost > 0.02 && state !== 'ball';
    this.aura.visible = auraOn;
    if (auraOn) {
      const u = this._auraMat.uniforms;
      u.uTime.value = this._t;
      u.uIntensity.value = this._boost * (0.75 + 0.25 * Math.sin(this._t * 23));
    }

    this._updateRibbons(dt);
  }

  // -------------------------------------------------------------------------

  _setVisibility() {
    const ball = this._state === 'ball';
    this.body.visible = !ball;
    this.face.visible = !ball;
    this.outline.visible = !ball;
    this.ball.group.visible = ball;
    if (ball) this.aura.visible = false;
  }

  _applyPose(p) {
    const b = this.bones;
    const rig = this.rig;
    rig.position.set(0, p[I.rigPY], p[I.rigPZ]);
    rig.rotation.set(p[I.rigRX], p[I.rigRY], p[I.rigRZ]);
    const popK = this._popAmp * Math.exp(-this._pop * 10) * Math.cos(this._pop * 24);
    const sy = Math.max(0.4, 1 + p[I.rigSY] + popK);
    const sxz = 1 / Math.sqrt(sy);
    rig.scale.set(sxz, sy, sxz);

    b.hips.rotation.set(p[I.hipsRX], p[I.hipsRY], p[I.hipsRZ]);
    b.spine.rotation.set(p[I.spineRX], p[I.spineRY], p[I.spineRZ]);
    b.head.rotation.set(p[I.headRX], p[I.headRY], p[I.headRZ]);
    b.earL.rotation.set(p[I.earLRX], 0, p[I.earLRZ]);
    b.earR.rotation.set(p[I.earRRX], 0, p[I.earRRZ]);
    b.leaf.rotation.set(p[I.leafRX], 0, p[I.leafRZ]);

    b.shL.rotation.set(p[I.shLRX], p[I.shLRY], p[I.shLRZ]);
    b.elL.rotation.set(p[I.elLRX], p[I.elLRY], 0);
    b.wrL.rotation.set(p[I.wrLRX], 0, p[I.wrLRZ]);
    b.shR.rotation.set(p[I.shRRX], p[I.shRRY], p[I.shRRZ]);
    b.elR.rotation.set(p[I.elRRX], p[I.elRRY], 0);
    b.wrR.rotation.set(p[I.wrRRX], 0, p[I.wrRRZ]);

    b.thL.rotation.set(p[I.thLRX], p[I.thLRY], p[I.thLRZ]);
    b.knL.rotation.set(p[I.knLRX], 0, 0);
    b.anL.rotation.set(p[I.anLRX], 0, p[I.anLRZ]);
    b.thR.rotation.set(p[I.thRRX], p[I.thRRY], p[I.thRRZ]);
    b.knR.rotation.set(p[I.knRRX], 0, 0);
    b.anR.rotation.set(p[I.anRRX], 0, p[I.anRRZ]);

    b.t0.rotation.set(p[I.t0RX], p[I.t0RY], 0);
    b.t1.rotation.set(p[I.t1RX], p[I.t1RY], 0);
    b.t2.rotation.set(p[I.t2RX], p[I.t2RY], 0);
    b.t3.rotation.set(p[I.t3RX], p[I.t3RY], 0);
    b.t4.rotation.set(p[I.t4RX], p[I.t4RY], 0);
  }

  _updateFace(dt, p) {
    // blink scheduler
    this._blinkT += dt;
    if (this._blinkT > this._nextBlink) {
      this._blinkT = 0;
      this._nextBlink = this._blinkDouble ? 0.22 : 2.2 + Math.random() * 3.2;
      this._blinkDouble = !this._blinkDouble && Math.random() < 0.22;
      this._blinkClock = 0;
    }
    this._blinkClock += dt;
    const bc = this._blinkClock;
    let blink = 0;
    if (bc < 0.06) blink = bc / 0.06;
    else if (bc < 0.09) blink = 1;
    else if (bc < 0.17) blink = 1 - (bc - 0.09) / 0.08;
    const close = Math.max(blink, clamp01(p[I.eyeClose]));
    const happy = clamp01(p[I.happyEyes]);
    const b = this.bones;
    const openY = Math.max(0.001, (1 - close * 0.94) * (1 - happy));
    b.eyes.scale.set(1, openY, 1);
    b.eyes.position.z = this._bind.eyesZ + 0.012 * Math.max(close, happy);
    b.eyesHappy.scale.set(1, Math.max(0.001, happy), 1);
    const mo = clamp01(p[I.mouthOpen]);
    b.mouth.scale.setScalar(Math.max(0.001, 1 - mo));
    b.mouthOpen.scale.setScalar(Math.max(0.001, mo));
  }

  _updateRibbons(dt) {
    const r = this._ribbonOpts;
    r.speed = this._speed;
    r.lift = this._out[I.ribLift];
    r.steer = this._steer;
    r.boost = this._boost;
    if (this._state === 'ball') {
      const R = this.ball.radius;
      const y = this.ball.group.position.y;
      this._anchors[0].set(0.1, y + R * 0.5, -R * 0.78);
      this._anchors[1].set(-0.1, y + R * 0.5, -R * 0.78);
      r.lift = 0;
    } else {
      // head transform relative to the root: stance * rig * hips * spine * head
      const b = this.bones;
      this.stance.updateMatrix();
      this.rig.updateMatrix();
      b.hips.updateMatrix();
      b.spine.updateMatrix();
      b.head.updateMatrix();
      _m.multiplyMatrices(this.stance.matrix, this.rig.matrix)
        .multiply(b.hips.matrix)
        .multiply(b.spine.matrix)
        .multiply(b.head.matrix);
      this._anchors[0].copy(this._knotLocal[0]).applyMatrix4(_m);
      this._anchors[1].copy(this._knotLocal[1]).applyMatrix4(_m);
    }
    this.ribbons.update(dt, this._anchors, r);
  }

  /** Enable/disable shadow casting for all character meshes. */
  setCastShadow(on) {
    this.body.castShadow = on;
    this.ribbons.mesh.castShadow = on;
    this.ball.mesh.castShadow = on;
    this.board.mesh.castShadow = on;
  }

  /** Free GPU resources. The model must not be used afterwards. */
  dispose() {
    if (this.root.parent) this.root.parent.remove(this.root);
    this.body.geometry.dispose();
    this.face.geometry.dispose();
    this.outline.geometry.dispose();
    this.skeleton.dispose();
    this.ribbons.dispose();
    this.ball.dispose();
    this.board.dispose();
    this._auraMat.dispose();
    this._toon.dispose();
    this._faceMat.dispose();
    this._outlineMat.dispose();
    this._ribbonMat.dispose();
    this._gradient.dispose();
  }
}

export { COLORS as TANUKI_COLORS };
export default TanukiModel;
