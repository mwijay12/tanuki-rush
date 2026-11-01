import * as THREE from 'three';
import { makeFrame } from '../track/Track.js';
import { mergeColored } from '../core/geo.js';
import { clamp, damp } from '../core/Events.js';

// The giant runaway armoured truck that chases the hero down the avenue.

function hazardTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  for (let x = -64; x < 320; x += 32) {
    g.fillStyle = '#ffc21a';
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 16, 0); g.lineTo(x + 48, 64); g.lineTo(x + 32, 64); g.closePath(); g.fill();
  }
  g.globalCompositeOperation = 'destination-over';
  g.fillStyle = '#1c1c22'; g.fillRect(0, 0, 256, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function buildTruckMesh() {
  const root = new THREE.Group();
  const body = mergeColored([
    // chassis
    { geo: new THREE.BoxGeometry(9.6, 1.4, 17), color: 0x2b2f36, pos: [0, 1.9, 0] },
    // cargo box
    { geo: new THREE.BoxGeometry(10, 5.6, 10.5), color: 0x4a5566, pos: [0, 5.3, -3.2] },
    { geo: new THREE.BoxGeometry(10.2, 0.5, 10.7), color: 0x2e3540, pos: [0, 8.2, -3.2] },
    // cab
    { geo: new THREE.BoxGeometry(9.4, 4.6, 5.6), color: 0xc8322a, pos: [0, 4.8, 4.9] },
    { geo: new THREE.BoxGeometry(8.6, 1.6, 0.3), color: 0x10151c, pos: [0, 5.6, 7.75] },   // windscreen
    { geo: new THREE.BoxGeometry(9.0, 2.2, 0.4), color: 0x1a1d22, pos: [0, 3.2, 7.8] },     // grill
    // grill bars
    ...[-3, -1.5, 0, 1.5, 3].map((x) => ({ geo: new THREE.BoxGeometry(0.25, 2.0, 0.2), color: 0x9aa1ab, pos: [x, 3.2, 8.05] })),
    // exhaust stacks
    { geo: new THREE.CylinderGeometry(0.3, 0.3, 4, 8), color: 0x777d86, pos: [4.2, 8.2, 2.4] },
    { geo: new THREE.CylinderGeometry(0.3, 0.3, 4, 8), color: 0x777d86, pos: [-4.2, 8.2, 2.4] },
    // roof bar
    { geo: new THREE.BoxGeometry(7, 0.4, 0.8), color: 0x2a2d33, pos: [0, 7.3, 5.2] },
    // mirrors
    { geo: new THREE.BoxGeometry(0.3, 1.2, 0.6), color: 0x2a2d33, pos: [5.2, 5.4, 6.8] },
    { geo: new THREE.BoxGeometry(0.3, 1.2, 0.6), color: 0x2a2d33, pos: [-5.2, 5.4, 6.8] },
  ]);
  const bodyMesh = new THREE.Mesh(body, new THREE.MeshLambertMaterial({ vertexColors: true }));
  root.add(bodyMesh);
  // plow (wedge) with hazard stripes
  const plowGeo = new THREE.BoxGeometry(13.5, 2.6, 0.6);
  const hz = hazardTexture();
  hz.repeat.set(4, 1);
  const plow = new THREE.Mesh(plowGeo, new THREE.MeshLambertMaterial({ map: hz }));
  plow.position.set(0, 1.9, 9.4);
  plow.rotation.x = -0.35;
  root.add(plow);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(10.1, 0.9, 10.6), new THREE.MeshLambertMaterial({ map: hz }));
  stripe.position.set(0, 3.2, -3.2);
  root.add(stripe);
  // headlights
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6d0 });
  for (const x of [-3.6, -2.5, 2.5, 3.6]) {
    const l = new THREE.Mesh(new THREE.CircleGeometry(0.42, 12), lampMat);
    l.position.set(x, 4.2, 7.83);
    root.add(l);
  }
  // beacons
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a });
  const beacons = [];
  for (const x of [-2.6, 2.6]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.5, 10), beaconMat);
    b.position.set(x, 7.75, 5.2);
    root.add(b);
    beacons.push(b);
  }
  // wheels
  const wheelGeo = new THREE.CylinderGeometry(1.35, 1.35, 1.1, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x18181b });
  const hubGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.2, 8);
  hubGeo.rotateZ(Math.PI / 2);
  const hubMat = new THREE.MeshLambertMaterial({ color: 0xb8bec7 });
  const wheels = [];
  for (const z of [5.2, -1.6, -5.6]) for (const x of [-4.7, 4.7]) {
    const w = new THREE.Group();
    w.add(new THREE.Mesh(wheelGeo, wheelMat), new THREE.Mesh(hubGeo, hubMat));
    w.position.set(x, 1.35, z);
    root.add(w);
    wheels.push(w);
  }
  return { root, wheels, beacons };
}

const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class Truck {
  constructor(scene, level, events, fx, objects) {
    this.level = level;
    this.main = level.main;
    this.cfg = level.truck;
    this.events = events;
    this.fx = fx;
    this.objects = objects;
    const t = buildTruckMesh();
    this.mesh = t.root;
    this.wheels = t.wheels;
    this.beacons = t.beacons;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.F = makeFrame();
    this.vel = new THREE.Vector3();
    this.canalS = level.marks.canal + 2;
    this.reset();
  }

  reset() {
    this.state = 'idle';     // idle → intro → chase → falling → done
    this.s = 0;
    this.x = 0;
    this.speed = 0;
    this.t = 0;
    this.gap = 999;
    this.mesh.visible = false;
    this.hitCool = 0;
  }

  get active() { return this.state === 'intro' || this.state === 'chase'; }
  get danger() { return this.active && this.gap < 32; }
  get proximity() { return this.active || this.state === 'falling' ? clamp(1 - this.gap / 140, 0, 1) : 0; }

  onRespawn(s) {
    if (s >= this.cfg.triggerS && s < this.cfg.endS) {
      this.state = 'chase';
      this.s = Math.max(this.cfg.triggerS - 20, s - this.cfg.spawnBehind);
      this.x = 0;
      this.speed = 30;
      this.mesh.visible = true;
    } else if (s < this.cfg.triggerS) {
      this.reset();
    }
  }

  update(dt, player) {
    const cfg = this.cfg;
    this.t += dt;
    this.hitCool = Math.max(0, this.hitCool - dt);
    const ps = player.mainS;
    if (this.state === 'idle') {
      if (ps >= cfg.triggerS && ps < cfg.endS && player.state !== 'dead') {
        this.state = 'intro';
        this.t = 0;
        this.s = ps - cfg.spawnBehind;
        this.x = 26;
        this.speed = Math.max(40, player.speed * 0.9);
        this.mesh.visible = true;
        this.events.emit('truckIntro');
        // burst out of the building on the right
        this._pose();
        this.fx.burst(this.mesh.position, 90, { speed: 18, colors: [0xd9d4c8, 0xb9b2a4, 0x8d8779, 0xffffff], size: 1.6, life: 1.1, drag: 2, gravity: 10, alpha: 0.6, grow: 0.8 });
      }
      return;
    }
    if (this.state === 'done') return;

    if (this.state === 'falling') {
      this.vel.y -= 30 * dt;
      this.mesh.position.addScaledVector(this.vel, dt);
      this.mesh.rotateX(dt * 0.7);
      if (!this._splashed && this.mesh.position.y < 2) {
        this._splashed = true;
        this.fx.burst(this.mesh.position, 160, { speed: 26, colors: [0xffffff, 0xcfefff, 0x9fd8ff], size: 1.8, life: 1.6, drag: 1.2, gravity: 16, up: 14, alpha: 0.8 });
        this.events.emit('truckDown');
      }
      this.gap = Math.max(0, ps - this.s);
      if (this.t > 4) { this.state = 'done'; this.mesh.visible = false; }
      return;
    }

    // --- chase logic (rubber band)
    this.gap = ps - this.s;
    const base = cfg.speed;
    let want = base + (this.gap - 34) * 0.26;
    want = clamp(want, 34, 74);
    if (player.state === 'dead') want = 20;
    this.speed = damp(this.speed, want, 1.5, dt);
    this.s += this.speed * dt;
    if (this.state === 'intro') {
      this.x = damp(this.x, 0, 2.2, dt);
      if (this.t > 1.6) this.state = 'chase';
    } else {
      this.x = damp(this.x, clamp(player.mainX * 0.5, -3, 3), 0.8, dt);
    }
    if (this.t % 7 < dt && this.state === 'chase' && this.gap < 90) this.events.emit('truckHorn');

    // smash parked cars in its path
    const front = this.s + 9;
    for (const c of this.objects.cars) {
      if (c.state !== 'parked') continue;
      if (c.s > front - 1 && c.s < front + 3) {
        this.main.sample(this.s, this.F);
        this.objects.smashCar(c, this.F.tan, this.speed + 10, true);
      }
    }

    // hit the hero
    if (this.hitCool <= 0 && player.state !== 'dead' && player.state !== 'goal' && player.state !== 'rail') {
      const dsFront = ps - front;
      if (dsFront < 0.8 && dsFront > -16 && Math.abs(player.mainX - this.x) < 7.6 && player.mainH < 8) {
        this.hitCool = 1.5;
        if (player.hurt({ from: 'behind' })) this.events.emit('truckHit');
      }
    }

    // over the canal edge → fall
    if (this.s >= this.canalS) {
      this.state = 'falling';
      this.t = 0;
      this._splashed = false;
      this.main.sample(this.s, this.F);
      this.vel.copy(this.F.tan).multiplyScalar(this.speed * 0.8);
      this.vel.y += 4;
      return;
    }
    this._pose();

    // wheels, beacons, exhaust
    for (const w of this.wheels) w.rotation.x += (this.speed / 1.35) * dt;
    const blink = Math.floor(this.t * 8) % 2 === 0;
    this.beacons[0].visible = blink; this.beacons[1].visible = !blink;
    if (Math.random() < 0.3) {
      _v.set((Math.random() < 0.5 ? -4.2 : 4.2), 10.3, 2.4).applyQuaternion(this.mesh.quaternion).add(this.mesh.position);
      this.fx.spawn(_v, _v2.set(0, 6, 0), { color: 0x6b6b70, size: 2.2, life: 0.9, drag: 1, alpha: 0.25, grow: 1.5 });
    }
    // sparks from the plow scraping
    if (Math.random() < 0.6) {
      _v.set((Math.random() - 0.5) * 12, 0.3, 9.6).applyQuaternion(this.mesh.quaternion).add(this.mesh.position);
      this.fx.spawn(_v, _v2.set((Math.random() - 0.5) * 8, 4 + Math.random() * 5, 0).addScaledVector(this.F.tan, this.speed * 0.6), { color: 0xffc46b, size: 0.3, life: 0.4, drag: 1, gravity: 20 });
    }
  }

  _pose() {
    const F = this.main.sample(Math.max(0, this.s), this.F);
    this.mesh.position.copy(F.pos).addScaledVector(F.right, this.x);
    _v.crossVectors(F.up, F.tan).normalize();
    _m.makeBasis(_v, F.up, F.tan);
    this.mesh.quaternion.setFromRotationMatrix(_m);
    // slight sway
    _q.setFromAxisAngle(F.tan, Math.sin(this.t * 3.1) * 0.02);
    this.mesh.quaternion.premultiply(_q);
  }
}
