import * as THREE from 'three';
import { makeFrame } from '../track/Track.js';
import * as MS from './meshes.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler();
const _c = new THREE.Color();
const Y = new THREE.Vector3(0, 1, 0);
const ZERO_S = new THREE.Vector3(0, 0, 0);

function frameQuat(F, out) {
  _v.crossVectors(F.up, F.tan).normalize();
  _m.makeBasis(_v, F.up, F.tan);
  return out.setFromRotationMatrix(_m);
}

/** Squared distance from point c to segment ab. */
function segDist2(a, b, c) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz;
  let t = l2 > 1e-9 ? (acx * abx + acy * aby + acz * abz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = acx - abx * t, dy = acy - aby * t, dz = acz - abz * t;
  return dx * dx + dy * dy + dz * dz;
}

/** Binary search: first index with arr[i].s >= s. */
function lowerBound(arr, s) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid].s < s) lo = mid + 1; else hi = mid; }
  return lo;
}

export class Objects {
  constructor(scene, level, events, particles) {
    this.scene = scene;
    this.level = level;
    this.main = level.main;
    this.events = events;
    this.fx = particles;
    this.F = makeFrame();
    this.group = new THREE.Group();
    this.group.name = 'objects';
    scene.add(this.group);
    this.time = 0;
    this.pc = new THREE.Vector3();
    this.prevPC = null;
    this.score = 0;

    const it = level.items;
    const bySort = (a, b) => a.s - b.s;
    this.leaves = it.leaves.map((l, i) => ({ ...l, alive: true, phase: i * 0.37 })).sort(bySort);
    this.panels = it.panels.map((p) => ({ ...p, cool: 0 })).sort(bySort);
    this.ramps = it.ramps.map((r) => ({ ...r, cool: 0 })).sort(bySort);
    this.springs = it.springs.map((p) => ({ ...p, cool: 0, squash: 0 })).sort(bySort);
    this.rings = it.rings.map((p) => ({ ...p, cool: 0, flash: 0 })).sort(bySort);
    this.enemies = it.enemies.map((e, i) => ({ ...e, alive: true, base: e.pos.clone(), pos: e.pos.clone(), phase: i * 1.3, yaw: 0 })).sort(bySort);
    this.cars = it.cars.map((c) => ({ ...c, state: 'parked', vel: new THREE.Vector3(), spin: new THREE.Vector3(), rot: new THREE.Euler(), pos: new THREE.Vector3(), quat: new THREE.Quaternion(), t: 0 })).sort(bySort);
    this.checkpoints = it.checkpoints.map((c) => ({ ...c, active: false })).sort(bySort);

    this._buildLeaves();
    this._buildPanels();
    this._buildRamps();
    this._buildSprings();
    this._buildRings();
    this._buildEnemies();
    this._buildCars();
    this._buildCheckpoints();
    this._buildGoal();
    this._buildReticle();
    this._buildScatter();
  }

  // ======================================================================== build
  _buildLeaves() {
    const geo = MS.leafGeometry(1.0);
    this.leafMat = MS.leafMaterial();
    const n = this.leaves.length;
    this.leafMesh = new THREE.InstancedMesh(geo, this.leafMat, Math.max(1, n));
    this.leafMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.leafMesh.frustumCulled = false;
    this.leafMesh.count = n;
    this.group.add(this.leafMesh);
  }

  _buildPanels() {
    this.panelTex = MS.panelTexture();
    const geo = new THREE.PlaneGeometry(3.0, 4.6);
    geo.rotateX(-Math.PI / 2);
    geo.rotateY(Math.PI); // texture top (arrow tips) must face the direction of travel (+Z)
    const mat = new THREE.MeshBasicMaterial({ map: this.panelTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, this.panels.length));
    const F = this.F;
    this.panels.forEach((p, i) => {
      this.main.sample(p.s, F);
      _v2.copy(F.pos).addScaledVector(F.right, p.x).addScaledVector(F.up, 0.04);
      frameQuat(F, _q);
      mesh.setMatrixAt(i, _m.compose(_v2, _q, _s.set(1, 1, 1)));
    });
    mesh.count = this.panels.length;
    this.group.add(mesh);
  }

  _buildRamps() {
    const tex = MS.rampTexture();
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    const F = this.F;
    for (const r of this.ramps) {
      r.len = r.big ? 11 : 8;
      r.height = Math.tan((r.angle * Math.PI) / 180) * r.len * 0.5;
      const mesh = new THREE.Mesh(MS.rampGeometry(r.len, r.width, r.height), mat);
      this.main.sample(r.s, F);
      mesh.position.copy(F.pos).addScaledVector(F.right, r.x);
      frameQuat(F, mesh.quaternion);
      this.group.add(mesh);
    }
  }

  _buildSprings() {
    const geo = MS.springGeometry();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (const sp of this.springs) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(sp.pos);
      mesh.quaternion.setFromUnitVectors(Y, sp.dir);
      sp.mesh = mesh;
      this.group.add(mesh);
    }
  }

  _buildRings() {
    const geo = MS.ringGeometry();
    const mat = new THREE.MeshBasicMaterial({ color: 0x46d6ff });
    const inner = new THREE.MeshBasicMaterial({ color: 0xfff27a, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    for (const r of this.rings) {
      const g = new THREE.Group();
      const torus = new THREE.Mesh(geo, mat);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(2.1, 32), inner);
      g.add(torus, disc);
      g.position.copy(r.pos);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), r.dir);
      r.mesh = g;
      this.group.add(g);
    }
  }

  _buildEnemies() {
    const n = Math.max(1, this.enemies.length);
    this.droneBody = new THREE.InstancedMesh(MS.droneGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), n);
    this.droneEye = new THREE.InstancedMesh(MS.droneEyeGeometry(), new THREE.MeshBasicMaterial({ color: 0xff2a2a }), n);
    this.droneRotor = new THREE.InstancedMesh(MS.rotorGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), n);
    for (const m of [this.droneBody, this.droneEye, this.droneRotor]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = this.enemies.length;
      this.group.add(m);
    }
  }

  _buildCars() {
    this.carKinds = {};
    for (const kind of ['car', 'van']) {
      const list = this.cars.filter((c) => c.kind === kind);
      if (!list.length) continue;
      const g = MS.carGeometries(kind);
      const paint = new THREE.InstancedMesh(g.paint, new THREE.MeshLambertMaterial({ vertexColors: true }), list.length);
      const trim = new THREE.InstancedMesh(g.trim, new THREE.MeshLambertMaterial({ vertexColors: true }), list.length);
      paint.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      trim.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      paint.frustumCulled = trim.frustumCulled = false;
      list.forEach((c, i) => {
        c.index = i; c.halfLen = g.halfLen; c.halfW = g.halfW; c.height = g.height;
        paint.setColorAt(i, _c.set(c.color));
      });
      this.carKinds[kind] = { paint, trim, list };
      this.group.add(paint, trim);
    }
    this._placeCars();
  }

  _placeCars() {
    const F = this.F;
    for (const c of this.cars) {
      this.main.sample(c.s, F);
      c.pos.copy(F.pos).addScaledVector(F.right, c.x);
      frameQuat(F, c.quat);
      // slight random parking angle
      _q2.setFromAxisAngle(Y, ((c.s * 13.7) % 1 - 0.5) * 0.25);
      c.quat.multiply(_q2);
      c.state = 'parked';
      c.t = 0;
    }
    this._writeCars();
  }

  _writeCars() {
    for (const k of Object.values(this.carKinds)) {
      for (const c of k.list) {
        const hidden = c.state === 'gone';
        _m.compose(c.pos, c.quat, hidden ? ZERO_S : _s.set(1, 1, 1));
        k.paint.setMatrixAt(c.index, _m);
        k.trim.setMatrixAt(c.index, _m);
      }
      k.paint.instanceMatrix.needsUpdate = true;
      k.trim.instanceMatrix.needsUpdate = true;
    }
  }

  _buildCheckpoints() {
    const F = this.F;
    const lampGeo = new THREE.SphereGeometry(0.36, 12, 8);
    this.cpLamps = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, this.checkpoints.length * 2));
    let li = 0;
    for (const cp of this.checkpoints) {
      this.main.sample(cp.s, F);
      const mesh = new THREE.Mesh(MS.checkpointGeometry(F.halfWidth), new THREE.MeshLambertMaterial({ vertexColors: true }));
      mesh.position.copy(F.pos);
      frameQuat(F, mesh.quaternion);
      this.group.add(mesh);
      cp.lamps = [li, li + 1];
      for (const side of [-1, 1]) {
        _v2.copy(F.pos).addScaledVector(F.right, side * (F.halfWidth + 0.4)).addScaledVector(F.up, 3.85);
        this.cpLamps.setMatrixAt(li, _m.compose(_v2, _q.identity(), _s.set(1, 1, 1)));
        this.cpLamps.setColorAt(li, _c.set(0xff3030));
        li++;
      }
    }
    this.cpLamps.count = li;
    this.group.add(this.cpLamps);
  }

  _makeArch(s, text) {
    const F = this.F;
    this.main.sample(s, F);
    const g = new THREE.Group();
    g.position.copy(F.pos);
    frameQuat(F, g.quaternion);
    g.add(new THREE.Mesh(MS.goalGeometry(F.halfWidth), new THREE.MeshLambertMaterial({ vertexColors: true })));
    const bw = (F.halfWidth + 1.6) * 2 + 1.3;
    const dark = new THREE.MeshLambertMaterial({ color: 0x111111 });
    const face = new THREE.MeshBasicMaterial({ map: MS.goalBannerTexture(text) });
    const banner = new THREE.Mesh(new THREE.BoxGeometry(bw, 2.2, 0.6), [dark, dark, dark, dark, face, face]);
    banner.position.y = 12.2;
    g.add(banner);
    this.group.add(g);
    return g;
  }

  _buildGoal() {
    const g = this._makeArch(this.level.goalS, 'GOAL');
    const leaf = new THREE.Mesh(MS.leafGeometry(5.5), MS.leafMaterial());
    leaf.position.y = 6.5;
    g.add(leaf);
    this.goalLeaf = leaf;
    this.goalGroup = g;
    this._makeArch(this.level.startS + 24, 'START');
  }

  _buildReticle() {
    const mat = new THREE.SpriteMaterial({ map: MS.reticleTexture(), depthTest: false, depthWrite: false, transparent: true });
    this.reticle = new THREE.Sprite(mat);
    this.reticle.scale.set(2.6, 2.6, 1);
    this.reticle.visible = false;
    this.reticle.renderOrder = 20;
    this.group.add(this.reticle);
    this.reticleT = 0;
  }

  _buildScatter() {
    this.scatter = [];
    const n = 20;
    this.scatterMesh = new THREE.InstancedMesh(MS.leafGeometry(0.9), this.leafMat, n);
    this.scatterMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scatterMesh.frustumCulled = false;
    for (let i = 0; i < n; i++) {
      this.scatter.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, s: 0 });
      this.scatterMesh.setMatrixAt(i, _m.compose(_v.set(0, -9999, 0), _q.identity(), ZERO_S));
    }
    this.group.add(this.scatterMesh);
  }

  // ======================================================================== runtime
  addScore(points, reason, pos) {
    this.score += points;
    this.events.emit('score', { points, reason, pos });
  }

  /** Throw lost leaves around the player. */
  scatterLeaves(pos, count) {
    const n = Math.min(20, count);
    for (let i = 0; i < n; i++) {
      const sc = this.scatter[i];
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      const sp = 7 + Math.random() * 6;
      sc.pos.copy(pos).y += 1;
      sc.vel.set(Math.cos(a) * sp, 9 + Math.random() * 7, Math.sin(a) * sp);
      sc.life = 4.2;
      sc.s = this.player ? this.player.mainS : 0;
    }
  }

  resetFrom(s) {
    for (const l of this.leaves) if (l.s >= s - 2) l.alive = true;
    for (const e of this.enemies) if (e.s >= s - 2) { e.alive = true; e.pos.copy(e.base); }
    for (const c of this.cars) if (c.s >= s - 2) { c.state = 'parked'; }
    this._placeCarsFrom(s);
    for (const sc of this.scatter) sc.life = 0;
  }

  _placeCarsFrom(s) {
    const F = this.F;
    for (const c of this.cars) {
      if (c.s < s - 2) continue;
      this.main.sample(c.s, F);
      c.pos.copy(F.pos).addScaledVector(F.right, c.x);
      frameQuat(F, c.quat);
      _q2.setFromAxisAngle(Y, ((c.s * 13.7) % 1 - 0.5) * 0.25);
      c.quat.multiply(_q2);
      c.t = 0;
    }
    this._writeCars();
  }

  smashCar(c, dir, speed, byTruck = false) {
    if (c.state !== 'parked') return;
    c.state = 'flying';
    c.t = 0;
    c.vel.copy(dir).multiplyScalar(speed * (byTruck ? 0.9 : 0.75)).addScaledVector(Y, byTruck ? 16 + Math.random() * 8 : 12 + Math.random() * 5);
    c.vel.x += (Math.random() - 0.5) * 10; c.vel.z += (Math.random() - 0.5) * 10;
    c.spin.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 7, (Math.random() - 0.5) * 9);
    this.fx.burst(_v.copy(c.pos).addScaledVector(Y, 1), 26, { speed: 14, colors: [0xffffff, 0xffd27a, 0xff8a3a], size: 0.7, life: 0.5, drag: 3 });
    this.events.emit('carSmash', { byTruck, pos: c.pos.clone() });
    if (!byTruck) this.addScore(300, 'SMASH', c.pos);
  }

  destroyEnemy(e, how = 'hit') {
    if (!e.alive) return;
    e.alive = false;
    this.fx.burst(e.pos, 40, { speed: 16, colors: [0xffffff, 0xffe066, 0xff7a2f, 0xff3b3b], size: 0.8, life: 0.55, drag: 3.5 });
    this.fx.burst(e.pos, 14, { speed: 6, color: 0x9aa3ad, size: 1.6, life: 0.8, drag: 2, gravity: -2, grow: 1.5, alpha: 0.35 });
    this.events.emit('enemyDown', { pos: e.pos.clone(), how });
    if (this.player) this.player.addBoost(0.08);
    this.chain = (this.chainTimer > 0 ? this.chain + 1 : 1);
    this.chainTimer = 1.6;
    const pts = 100 * Math.min(this.chain, 8);
    this.addScore(pts, this.chain > 1 ? `CHAIN x${this.chain}` : 'HIT', e.pos);
  }

  update(dt, player, camera) {
    this.player = player;
    this.time += dt;
    const t = this.time;
    const main = this.main;
    this.chainTimer = Math.max(0, (this.chainTimer || 0) - dt);

    // player collision center (swept from last frame)
    this.pc.copy(player.pos).addScaledVector(player.upV, 0.65);
    const a = this.prevPC || this.pc;
    const b = this.pc;
    const ps = player.mainS;
    const active = player.state !== 'dead' && player.state !== 'goal';

    // ---------------- leaves
    {
      const mesh = this.leafMesh;
      const spin = t * 3.2;
      for (let i = 0; i < this.leaves.length; i++) {
        const l = this.leaves[i];
        if (!l.alive) { mesh.setMatrixAt(i, _m.compose(l.pos, _q.identity(), ZERO_S)); continue; }
        _q.setFromAxisAngle(Y, spin + l.phase);
        _v.copy(l.pos); _v.y += Math.sin(t * 2.4 + l.phase) * 0.12;
        mesh.setMatrixAt(i, _m.compose(_v, _q, _s.set(1, 1, 1)));
      }
      if (active) {
        const i0 = lowerBound(this.leaves, ps - 25);
        for (let i = i0; i < this.leaves.length && this.leaves[i].s < ps + 25; i++) {
          const l = this.leaves[i];
          if (!l.alive) continue;
          if (segDist2(a, b, l.pos) < 1.55 * 1.55) this._collectLeaf(l, player);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    // ---------------- scattered leaves
    {
      const F = this.F;
      for (let i = 0; i < this.scatter.length; i++) {
        const sc = this.scatter[i];
        if (sc.life <= 0) { this.scatterMesh.setMatrixAt(i, _m.compose(_v.set(0, -9999, 0), _q.identity(), ZERO_S)); continue; }
        sc.life -= dt;
        sc.vel.y -= 30 * dt;
        sc.pos.addScaledVector(sc.vel, dt);
        // bounce on the course
        const P = main.project(sc.pos, sc.s, this._sp || (this._sp = { frame: makeFrame() }), 24);
        sc.s = P.s;
        if (P.frame.floor && P.h < 0.4 && P.h > -3 && Math.abs(P.x) < P.frame.halfWidth + 1) {
          sc.pos.addScaledVector(P.frame.up, 0.4 - P.h);
          const vn = sc.vel.dot(P.frame.up);
          if (vn < 0) sc.vel.addScaledVector(P.frame.up, -vn * 1.6);
          sc.vel.multiplyScalar(0.85);
        }
        void F;
        const blink = sc.life < 1.5 && Math.floor(sc.life * 12) % 2 === 0;
        _q.setFromAxisAngle(Y, t * 8 + i);
        this.scatterMesh.setMatrixAt(i, _m.compose(sc.pos, _q, blink ? ZERO_S : _s.set(1, 1, 1)));
        if (active && sc.life < 3.6 && segDist2(a, b, sc.pos) < 1.7 * 1.7 && player.hurtTimer <= 0) {
          sc.life = 0;
          this._collectLeaf(null, player, sc.pos);
        }
      }
      this.scatterMesh.instanceMatrix.needsUpdate = true;
    }

    // ---------------- dash panels
    this.panelTex.offset.y -= dt * 2.2;
    if (active && player.state === 'ground' && player.track === main) {
      const i0 = lowerBound(this.panels, ps - 4);
      for (let i = i0; i < this.panels.length && this.panels[i].s < ps + 4; i++) {
        const p = this.panels[i];
        p.cool = Math.max(0, p.cool - dt);
        if (p.cool > 0) continue;
        if (Math.abs(p.s - ps) < 2.6 && Math.abs(p.x - player.x) < 2.1) {
          p.cool = 0.6;
          player.v = Math.max(player.v, p.speed);
          player.controlLock = Math.max(player.controlLock, 0.12);
          this.events.emit('dashPanel', { pos: player.pos.clone() });
        }
      }
    }

    // ---------------- ramps (ride up the wedge, launch at the lip)
    player.lift = 0;
    if (active && player.state === 'ground' && player.track === main) {
      const i0 = lowerBound(this.ramps, ps - 1);
      for (let i = Math.max(0, i0 - 1); i < this.ramps.length && this.ramps[i].s < ps + 14; i++) {
        const r = this.ramps[i];
        r.cool = Math.max(0, r.cool - dt);
        if (Math.abs(player.x - r.x) > r.width / 2 + 0.2) continue;
        const into = ps - (r.s - r.len);
        if (into >= 0 && into <= r.len && r.cool <= 0) {
          player.lift = (into / r.len) * r.height;
        }
        const prevS = this._prevS ?? ps;
        if (r.cool <= 0 && prevS <= r.s && ps > r.s - 0.01 && player.v > 5) {
          r.cool = 1.0;
          this.main.sample(r.s, this.F);
          const F = this.F;
          const ang = (r.angle * Math.PI) / 180;
          const sp = Math.max(player.v, r.speed || 0, r.big ? 48 : 36);
          if (r.launchVel) {
            _v.copy(r.launchVel);
          } else {
            _v.copy(F.tan).multiplyScalar(Math.cos(ang)).addScaledVector(F.up, Math.sin(ang)).multiplyScalar(sp);
            _v.addScaledVector(F.right, player.vx * 0.5);
          }
          _v2.copy(F.pos).addScaledVector(F.right, r.launchVel ? r.x : player.x).addScaledVector(F.up, r.height + 0.05);
          player.launch(_v, { lock: r.launchVel ? 0.2 : r.big ? 0.35 : 0.2, gravityScale: r.launchVel ? 1 : r.big ? 0.8 : 1, trick: r.trick, pos: _v2 });
          player.lift = 0;
          this.events.emit('ramp', { big: r.big, trick: r.trick });
        }
      }
    }
    this._prevS = ps;

    // ---------------- springs
    for (const sp of this.springs) {
      sp.cool = Math.max(0, sp.cool - dt);
      sp.squash = Math.max(0, sp.squash - dt * 4);
      const k = 1 - Math.sin(Math.min(1, sp.squash) * Math.PI) * 0.4;
      sp.mesh.scale.set(1, k, 1);
      if (!active || sp.cool > 0 || Math.abs(sp.s - ps) > 30) continue;
      _v.copy(sp.pos).addScaledVector(sp.dir, 0.9);
      if (segDist2(a, b, _v) < 1.8 * 1.8) {
        sp.cool = 0.5;
        sp.squash = 1;
        _v2.copy(sp.dir).multiplyScalar(sp.power);
        player.launch(_v2, { lock: sp.lock, gravityScale: sp.gravity, pos: _v3.copy(sp.pos).addScaledVector(sp.dir, 1.0) });
        this.events.emit('spring', { pos: sp.pos.clone() });
      }
    }

    // ---------------- dash rings
    for (const r of this.rings) {
      r.cool = Math.max(0, r.cool - dt);
      r.flash = Math.max(0, r.flash - dt * 3);
      r.mesh.rotateZ(dt * 1.5);
      const sc = 1 + r.flash * 0.35;
      r.mesh.scale.set(sc, sc, sc);
      if (!active || r.cool > 0 || Math.abs(r.s - ps) > 30) continue;
      if (segDist2(a, b, r.pos) < 2.7 * 2.7) {
        r.cool = 0.6;
        r.flash = 1;
        _v2.copy(r.dir).multiplyScalar(r.power);
        player.launch(_v2, { lock: r.lock, gravityScale: r.gravity, pos: r.pos });
        this.events.emit('dashRing', { pos: r.pos.clone() });
        this.addScore(50, 'RING', r.pos);
      }
    }

    // ---------------- enemies
    {
      let target = null, bestD = Infinity;
      const canHome = player.state === 'air' && player.canAirAction && !player.onBoard && player.springLock <= 0 && player.hurtTimer <= 0;
      _v2.set(player.vel.x, 0, player.vel.z);
      if (_v2.lengthSq() < 1) _v2.set(player.fwd.x, 0, player.fwd.z);
      _v2.normalize();
      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i];
        const body = this.droneBody, eye = this.droneEye, rotor = this.droneRotor;
        if (!e.alive) {
          body.setMatrixAt(i, _m.compose(e.pos, _q.identity(), ZERO_S));
          eye.setMatrixAt(i, _m); rotor.setMatrixAt(i, _m);
          continue;
        }
        // animate
        e.pos.copy(e.base); e.pos.y += Math.sin(t * 2 + e.phase) * 0.25;
        const near = Math.abs(e.s - ps) < 80;
        if (near) {
          const want = Math.atan2(player.pos.x - e.pos.x, player.pos.z - e.pos.z);
          let d = want - e.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
          e.yaw += d * Math.min(1, dt * 4);
        }
        _q.setFromAxisAngle(Y, e.yaw);
        _m.compose(e.pos, _q, _s.set(1, 1, 1));
        body.setMatrixAt(i, _m);
        eye.setMatrixAt(i, _m);
        _q2.setFromAxisAngle(Y, t * 25 + e.phase);
        _v.copy(e.pos); _v.y += 1.02;
        rotor.setMatrixAt(i, _m.compose(_v, _q2, _s.set(1, 1, 1)));
        if (!active || !near) continue;
        // collision
        const d2 = segDist2(a, b, e.pos);
        if (d2 < 1.5 * 1.5) {
          const stomp = player.state === 'air' && player.vel.y < 0 && player.pos.y > e.pos.y - 0.2;
          if (player.state === 'homing' && player.homing === e) {
            // handled by homingHit event
          } else if (player.attacking || stomp) {
            this.destroyEnemy(e, player.boosting ? 'boost' : 'hit');
            if (player.state === 'air') { player.vel.y = Math.max(player.vel.y, 13); player.canAirAction = true; }
          } else if (player.invuln <= 0) {
            player.hurt({ from: 'front' });
          }
          continue;
        }
        // homing target
        if (canHome) {
          _v.subVectors(e.pos, player.pos);
          const dist = _v.length();
          if (dist < 32 && dist > 1.5) {
            const dy = _v.y;
            _v.y = 0;
            const hd = _v.length();
            const facing = hd > 0.01 ? _v.dot(_v2) / hd : 1;
            if (facing > 0.45 && dy < 14 && dy > -26 && dist < bestD) { bestD = dist; target = e; }
          }
        }
      }
      this.droneBody.instanceMatrix.needsUpdate = true;
      this.droneEye.instanceMatrix.needsUpdate = true;
      this.droneRotor.instanceMatrix.needsUpdate = true;
      if (target !== player.homingTarget) {
        if (target) this.events.emit('lockon', target);
        player.homingTarget = target;
      }
      if (player.state === 'homing') player.homingTarget = player.homing;
      const tg = player.homingTarget;
      this.reticle.visible = !!tg && (player.state === 'air' || player.state === 'homing');
      if (this.reticle.visible) {
        this.reticleT += dt;
        this.reticle.position.copy(tg.pos);
        this.reticle.material.rotation = this.reticleT * 3;
        const k = 2.2 + Math.sin(this.reticleT * 14) * 0.25;
        this.reticle.scale.set(k, k, 1);
      }
    }

    // ---------------- cars
    {
      let dirty = false;
      for (const c of this.cars) {
        if (c.state === 'flying') {
          c.t += dt;
          c.vel.y -= 32 * dt;
          c.pos.addScaledVector(c.vel, dt);
          _e.set(c.spin.x * dt, c.spin.y * dt, c.spin.z * dt);
          c.quat.multiply(_q.setFromEuler(_e));
          if (c.t > 3.5) c.state = 'gone';
          dirty = true;
          continue;
        }
        if (c.state !== 'parked' || !active) continue;
        if (Math.abs(c.s - ps) > 12) continue;
        if (player.track !== main && player.state === 'rail') continue;
        const ds = Math.abs(ps - c.s), dx = Math.abs(player.mainX - c.x);
        if (ds < c.halfLen + 0.45 && dx < c.halfW + 0.45 && player.mainH < c.height - 0.1 && player.mainH > -1) {
          if (player.boosting || player.state === 'homing') {
            this.main.sample(c.s, this.F);
            this.smashCar(c, this.F.tan, Math.max(player.speed, 40));
            player.v *= 0.97;
          } else if (player.invuln <= 0) {
            player.hurt({ from: 'front' });
          }
        }
      }
      if (dirty || this._carsDirty) { this._writeCars(); this._carsDirty = false; }
    }

    // ---------------- checkpoints
    for (const cp of this.checkpoints) {
      if (cp.active || !active) continue;
      if (ps >= cp.s && ps < cp.s + 60) {
        cp.active = true;
        for (const li of cp.lamps) this.cpLamps.setColorAt(li, _c.set(0x35f08a));
        this.cpLamps.instanceColor.needsUpdate = true;
        this.events.emit('checkpoint', { s: cp.s });
      }
    }

    // ---------------- goal
    this.goalLeaf.rotation.y = t * 1.8;
    if (active && ps >= this.level.goalS) {
      this.events.emit('goal', {});
    }

    this.prevPC = this.prevPC || new THREE.Vector3();
    this.prevPC.copy(this.pc);
  }

  _collectLeaf(l, player, pos = null) {
    if (l) l.alive = false;
    player.leaves++;
    player.addBoost(0.012);
    const p = pos || l.pos;
    // small sparkles that travel with the hero and spread sideways/up, so a line of pickups
    // doesn't stack into a white blob between the camera and the hero
    for (let k = 0; k < 4; k++) {
      const a = Math.random() * Math.PI * 2;
      _v.set(Math.cos(a) * 6, 2 + Math.random() * 4, Math.sin(a) * 6).addScaledVector(player.vel, 0.9);
      this.fx.spawn(p, _v, { color: k % 2 ? 0xffd23a : 0xfff3a0, size: 0.26, life: 0.22, drag: 2, alpha: 0.85 });
    }
    this.events.emit('leaf', { count: player.leaves });
  }

  /** Remove the reticle etc. when restarting. */
  clearTransient() {
    this.reticle.visible = false;
    for (const sc of this.scatter) sc.life = 0;
    this.prevPC = null;
  }
}
