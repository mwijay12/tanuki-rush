import * as THREE from 'three';
import { STYLES, makeFrame } from '../track/Track.js';
import { createBuildingMaterial } from '../core/materials.js';
import { mergeColored, rng } from '../core/geo.js';

const PASTEL = [0xf4b6c2, 0xb8e0d2, 0xfbe3a1, 0xa9cce3, 0xf7c59f, 0xd7bde2, 0xfdfaf2, 0xe59866, 0xf9e79f, 0xaed6f1, 0xf5cba7, 0xc8e6c9];
const AWNING = [0xd8342c, 0x2f7d4f, 0x2d6fd6, 0xf2a93b, 0x8e44ad, 0x1f9aa6, 0xe85d9b, 0x3b3f4a];
const SIGN = [0xff4f4f, 0xffc933, 0x2d9cff, 0x35d08a, 0xff7ad9, 0xffffff];
const DOWNTOWN = [0xd5d8dc, 0xaab7c4, 0xe8dcc8, 0x9fb3c8, 0xc9c3b6, 0xf0e6d2, 0x8fa9c1, 0xdcd3c3];

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _c = new THREE.Color();
const Y = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

function boxGeoUnitBottom() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  return g;
}

/** Collects instances then builds one InstancedMesh. */
class Batch {
  constructor(geo, mat, name) { this.geo = geo; this.mat = mat; this.name = name; this.list = []; }
  add(pos, yaw, scale, color) { this.list.push([pos.clone(), yaw, scale.clone(), color]); }
  addQ(pos, quat, scale, color) { this.list.push([pos.clone(), quat.clone(), scale.clone(), color]); }
  build() {
    if (!this.list.length) return null;
    const mesh = new THREE.InstancedMesh(this.geo, this.mat, this.list.length);
    let colored = false;
    this.list.forEach(([p, yaw, s, color], i) => {
      if (typeof yaw === 'number') _q.setFromAxisAngle(Y, yaw); else _q.copy(yaw);
      _m.compose(p, _q, s);
      mesh.setMatrixAt(i, _m);
      if (color !== undefined && color !== null) { mesh.setColorAt(i, _c.set(color)); colored = true; }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (colored && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = this.name;
    return mesh;
  }
}

export function buildCityDecor({ main, rails, hash, refs, field, openSides = [], seed = 7 }) {
  const isOpen = (s, side) => openSides.some((o) => o.side === side && s >= o.s0 && s <= o.s1);
  const R = rng(seed);
  const rand = (a, b) => a + (b - a) * R();
  const pick = (arr) => arr[(R() * arr.length) | 0];
  const group = new THREE.Group();
  group.name = 'decor';

  const bMat = createBuildingMaterial({ instanced: true });
  const buildings = new Batch(boxGeoUnitBottom(), bMat, 'buildings');
  const farBuildings = new Batch(boxGeoUnitBottom(), bMat, 'farBuildings');
  const roofBoxes = new Batch(boxGeoUnitBottom(), new THREE.MeshLambertMaterial({ color: 0xffffff }), 'roofBoxes');
  const awningGeo = new THREE.BoxGeometry(1, 1, 1);
  const awnings = new Batch(awningGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), 'awnings');
  const signs = new Batch(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x222222 }), 'signs');

  const F = makeFrame();
  const zoneOf = (i) => main.zones[main.zone[i]];
  const streetLike = (i) => {
    const st = STYLES[main.style[i]];
    return (st === 'street' || st === 'board') && main.floor[i] && main.up[i * 3 + 1] > 0.9;
  };

  // --------------------------------------------------------------- street-side buildings
  const cornerOK = (cx, cz, bottom, top) => !hash.blocked(cx, cz, bottom, top, 1.2);
  const tryBuilding = (s, side, zone, target) => {
    const width = zone === 'chase' ? rand(16, 30) : rand(11, 22);
    const depth = zone === 'chase' ? rand(18, 34) : rand(12, 24);
    let height;
    if (zone === 'board') height = rand(9, 19);
    else if (zone === 'city') height = R() < 0.25 ? rand(28, 48) : rand(12, 26);
    else height = R() < 0.35 ? rand(45, 85) : rand(20, 42);
    const sMid = s + width / 2;
    if (sMid >= main.length) return 0;
    main.sample(sMid, F);
    const tx = F.tan.x, tz = F.tan.z;
    const th = Math.hypot(tx, tz) || 1;
    const fx = tx / th, fz = tz / th;           // horizontal forward
    const rx = -fz, rz = fx;                   // horizontal right
    const setback = rand(0.6, 2.2);
    const off = F.halfWidth + setback + depth / 2;
    const cx = F.pos.x + rx * side * off, cz = F.pos.z + rz * side * off;
    const roadY = F.pos.y;
    const top = roadY + height;
    // corners (bottom footprint)
    const pts = [];
    for (const a of [-0.5, 0.5]) for (const b of [-0.5, 0, 0.5]) {
      pts.push([cx + fx * a * width + rx * b * depth, cz + fz * a * width + rz * b * depth]);
    }
    let gMin = roadY;
    for (const [x, z] of pts) {
      gMin = Math.min(gMin, field.height(x, z));
      if (!cornerOK(x, z, roadY - 30, top)) return 0;
    }
    const bottom = Math.min(gMin, roadY) - 6;
    const yaw = Math.atan2(fx, fz);
    const color = zone === 'chase' ? pick(DOWNTOWN) : pick(PASTEL);
    target.add(_p.set(cx, bottom, cz), yaw, _s.set(depth, top - bottom, width), color);
    // storefront awning + projecting sign on the street-facing side
    if (zone !== 'board' ? R() < 0.75 : R() < 0.45) {
      const faceOff = F.halfWidth + setback;
      const ax = F.pos.x + rx * side * (faceOff - 0.9), az = F.pos.z + rz * side * (faceOff - 0.9);
      const tilt = new THREE.Euler(0, yaw, -side * 0.32, 'YXZ');
      awnings.addQ(_p.set(ax, roadY + 3.1, az), _q2.setFromEuler(tilt), _s.set(1.9, 0.14, width * rand(0.55, 0.85)), pick(AWNING));
      if (R() < 0.5) {
        const sx = F.pos.x + rx * side * (faceOff - 0.55) + fx * rand(-0.4, 0.4) * width;
        const sz = F.pos.z + rz * side * (faceOff - 0.55) + fz * rand(-0.4, 0.4) * width;
        signs.add(_p.set(sx, roadY + rand(5, 9), sz), yaw, _s.set(1.0, rand(2.2, 4), 0.25), pick(SIGN));
      }
    }
    // rooftop clutter (AC units / water tanks)
    if (R() < 0.7) {
      const n = 1 + ((R() * 3) | 0);
      for (let k = 0; k < n; k++) {
        const w = rand(2, 5), d = rand(2, 5), h = rand(1.2, 3.5);
        const ox = rand(-0.35, 0.35) * width, oz = rand(-0.35, 0.35) * depth;
        roofBoxes.add(_p.set(cx + fx * ox + rx * oz, top, cz + fz * ox + rz * oz), yaw, _s.set(w, h, d), pick([0xd9d9d9, 0xbfc5cc, 0x9aa3ad, 0xe6e0d4]));
      }
    }
    return width;
  };

  for (const side of [-1, 1]) {
    let s = 0;
    while (s < main.length - 10) {
      const i = main.index(s);
      const zone = zoneOf(i);
      if (!streetLike(i) || !(zone === 'board' || zone === 'city' || zone === 'chase')) { s += 5; continue; }
      if (R() < 0.07) { s += rand(16, 26); continue; } // side street gap
      if (isOpen(s, side)) { s += 5; continue; }
      const w = tryBuilding(s, side, zone, buildings);
      s += w > 0 ? w + rand(0.2, 1.8) : 4;
    }
  }

  // --------------------------------------------------------------- neighbouring rooftops (roof zone)
  // Buildings beside the rooftop run whose roofs sit near the course height, so the run
  // reads as hopping across a dense block of towers rather than a strip in the sky.
  {
    const roofIdx = STYLES.indexOf('roof');
    let s = main.marks.climb ?? 0;
    const sEnd = main.marks.drop_bottom ?? main.length;
    for (const side of [-1, 1]) {
      s = (main.marks.roof1 ?? s) - 20;
      while (s < sEnd) {
        const i = main.index(s);
        if (main.up[i * 3 + 1] < 0.9 && main.style[i] !== roofIdx) { s += 4; continue; }
        const width = rand(14, 26), depth = rand(14, 26);
        const sMid = s + width / 2;
        main.sample(sMid, F);
        const th = Math.hypot(F.tan.x, F.tan.z) || 1;
        const fx = F.tan.x / th, fz = F.tan.z / th, rx = -fz, rz = fx;
        const off = F.halfWidth + rand(2.5, 6) + depth / 2;
        const cx = F.pos.x + rx * side * off, cz = F.pos.z + rz * side * off;
        const top = F.pos.y + rand(-14, 7);
        const g = field.height(cx, cz);
        const bottom = Math.min(g, F.pos.y - 60) - 5;
        let ok = true;
        for (const a of [-0.5, 0.5]) for (const b of [-0.5, 0.5]) {
          const x = cx + fx * a * width + rx * b * depth, z = cz + fz * a * width + rz * b * depth;
          if (hash.blocked(x, z, bottom, top, 1.5)) ok = false;
        }
        if (ok) {
          buildings.add(_p.set(cx, bottom, cz), Math.atan2(fx, fz), _s.set(depth, top - bottom, width), pick(DOWNTOWN));
          for (let k = 0; k < 2; k++) {
            if (R() < 0.35) continue;
            roofBoxes.add(_p.set(cx + fx * rand(-0.3, 0.3) * width + rx * rand(-0.3, 0.3) * depth, top, cz + fz * rand(-0.3, 0.3) * width + rz * rand(-0.3, 0.3) * depth),
              Math.atan2(fx, fz), _s.set(rand(2, 5), rand(1.5, 4), rand(2, 5)), pick([0xd9d9d9, 0xbfc5cc, 0x9aa3ad]));
          }
        }
        s += ok ? width + rand(1, 5) : 5;
      }
    }
  }

  // --------------------------------------------------------------- distant city
  {
    const b = main.bounds;
    const cell = 46;
    const minX = b.min.x - 650, maxX = b.max.x + 650, minZ = b.min.z - 650, maxZ = b.max.z + 650;
    for (let x = minX; x < maxX; x += cell) {
      for (let z = minZ; z < maxZ; z += cell) {
        const px = x + rand(-14, 14), pz = z + rand(-14, 14);
        const h = field.height(px, pz);
        if (h < 3) continue;
        const nr = refs.nearest(px, pz, 900);
        if (!nr) continue;
        if (nr.d < 42) continue;
        if (nr.d > 620 && R() < 0.6) continue;
        const w = rand(12, 30), d = rand(12, 30);
        const low = h < 90;
        let ht = low ? (R() < 0.3 ? rand(40, 110) : rand(15, 45)) : rand(8, 22);
        if (nr.d > 300) ht *= 0.8;
        const bottom = h - 8;
        const top = h + ht;
        if (hash.blocked(px, pz, bottom, top, Math.max(w, d) * 0.75)) continue;
        const yaw = Math.round(rand(0, 4)) * (Math.PI / 2) + rand(-0.15, 0.15);
        farBuildings.add(_p.set(px, bottom, pz), yaw, _s.set(w, top - bottom, d), low ? pick(DOWNTOWN) : pick(PASTEL));
      }
    }
  }

  for (const bt of [buildings, farBuildings, roofBoxes, awnings, signs]) { const m = bt.build(); if (m) group.add(m); }

  // --------------------------------------------------------------- street props
  const lampGeo = mergeColored([
    { geo: new THREE.CylinderGeometry(0.11, 0.15, 7.5, 6), color: 0x2f3b36, pos: [0, 3.75, 0] },
    { geo: new THREE.CylinderGeometry(0.07, 0.07, 2.2, 5), color: 0x2f3b36, pos: [0.95, 7.3, 0], rot: [0, 0, Math.PI / 2] },
    { geo: new THREE.BoxGeometry(0.9, 0.28, 0.45), color: 0xfff6d8, pos: [1.9, 7.15, 0] },
    { geo: new THREE.CylinderGeometry(0.24, 0.3, 0.5, 6), color: 0x2f3b36, pos: [0, 0.25, 0] },
  ]);
  const bannerGeo = mergeColored([{ geo: new THREE.BoxGeometry(0.06, 1.8, 0.9), color: 0xffffff, pos: [0.25, 5.2, 0] }]);
  const treeGeo = mergeColored([
    { geo: new THREE.CylinderGeometry(0.14, 0.2, 3.2, 5), color: 0x6b4a2f, pos: [0, 1.6, 0] },
    { geo: new THREE.IcosahedronGeometry(1.7, 0), color: 0x4f9a3a, pos: [0, 4.1, 0] },
    { geo: new THREE.IcosahedronGeometry(1.25, 0), color: 0x62b248, pos: [0.6, 5.0, 0.3] },
    { geo: new THREE.IcosahedronGeometry(1.1, 0), color: 0x3f8a33, pos: [-0.7, 4.6, -0.4] },
  ]);
  const palmGeo = mergeColored([
    { geo: new THREE.CylinderGeometry(0.16, 0.26, 8, 6), color: 0x8a6a45, pos: [0, 4, 0], rot: [0, 0, 0.08] },
    ...[0, 1, 2, 3, 4, 5].map((k) => ({
      geo: new THREE.BoxGeometry(3.6, 0.08, 0.7), color: k % 2 ? 0x3f9a44 : 0x55b34f,
      pos: [Math.cos((k / 6) * Math.PI * 2) * 1.6, 7.7, Math.sin((k / 6) * Math.PI * 2) * 1.6], rot: [0, -(k / 6) * Math.PI * 2, -0.35],
    })),
  ]);
  const propMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const lamps = new Batch(lampGeo, propMat, 'lamps');
  const banners = new Batch(bannerGeo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 'banners');
  const trees = new Batch(treeGeo, propMat, 'trees');
  const palms = new Batch(palmGeo, propMat, 'palms');
  const BANNER_COLORS = [0xff4f4f, 0x2d9cff, 0xffc933, 0x35d08a, 0xff7ad9];

  const propAt = (s, side, extra, batch, yawOffset = 0, color = null) => {
    main.sample(s, F);
    const th = Math.hypot(F.tan.x, F.tan.z) || 1;
    const fx = F.tan.x / th, fz = F.tan.z / th;
    const rx = -fz, rz = fx;
    const off = F.halfWidth + extra;
    const x = F.pos.x + rx * side * off, z = F.pos.z + rz * side * off;
    const y = F.pos.y + F.right.y * side * F.halfWidth - 0.05;
    // prop local +X (the lamp arm) must point toward the road centre; at yaw0 local +X = left
    const yaw = Math.atan2(fx, fz) + (side > 0 ? 0 : Math.PI) + yawOffset;
    batch.add(_p.set(x, y, z), yaw, _s.set(1, 1, 1), color);
  };

  let bannerIdx = 0;
  for (let s = 8; s < main.length; s += 26) {
    const i = main.index(s);
    const st = STYLES[main.style[i]];
    const zone = zoneOf(i);
    if (!main.floor[i] || main.up[i * 3 + 1] < 0.9) continue;
    if (st === 'street' || st === 'board') {
      const side = (Math.round(s / 26) % 2) ? 1 : -1;
      propAt(s, side, 0.35, lamps);
      if (zone !== 'board' || R() < 0.5) {
        propAt(s, side, 0.35, banners, 0, BANNER_COLORS[bannerIdx++ % BANNER_COLORS.length]);
      }
      if (zone === 'city' || zone === 'board') propAt(s + 13, -side, 0.9, trees, rand(0, 6));
    } else if (st === 'highway' || st === 'bridge') {
      propAt(s, 1, 0.1, lamps);
      propAt(s + 13, -1, 0.1, lamps);
    } else if (st === 'pier') {
      propAt(s, 1, 0.6, palms, rand(0, 6));
      propAt(s + 13, -1, 0.6, palms, rand(0, 6));
    }
  }
  // overlook: low stone wall and a few trees where the view opens up
  {
    const wallGeo = new THREE.BoxGeometry(1, 1, 1);
    wallGeo.translate(0, 0.5, 0);
    const walls = new Batch(wallGeo, new THREE.MeshLambertMaterial({ color: 0xd8cbb3 }), 'overlookWall');
    for (const o of openSides) {
      for (let s = o.s0; s < o.s1; s += 4) {
        main.sample(s + 2, F);
        const th = Math.hypot(F.tan.x, F.tan.z) || 1;
        const fx = F.tan.x / th, fz = F.tan.z / th, rx = -fz, rz = fx;
        const off = F.halfWidth + 0.5;
        const x = F.pos.x + rx * o.side * off, z = F.pos.z + rz * o.side * off;
        // follow the slope: yaw from the heading, pitch from the tangent
        const pitch = Math.asin(Math.max(-1, Math.min(1, F.tan.y)));
        _q2.setFromEuler(new THREE.Euler(-pitch, Math.atan2(fx, fz), 0, 'YXZ'));
        walls.addQ(_p.set(x, F.pos.y - 1.5, z), _q2, _s.set(0.7, 2.4, 4.3));
        if (Math.round(s / 4) % 7 === 3) {
          const tx = F.pos.x + rx * o.side * (off + 3), tz = F.pos.z + rz * o.side * (off + 3);
          trees.add(_p.set(tx, Math.max(field.height(tx, tz), F.pos.y - 3), tz), rand(0, 6), _s.set(1.2, 1.2, 1.2));
        }
      }
    }
    const m = walls.build();
    if (m) group.add(m);
  }
  for (const bt of [lamps, banners, trees, palms]) { const m = bt.build(); if (m) group.add(m); }

  // --------------------------------------------------------------- overhead banner arches (strong speed cue)
  {
    const parts = [];
    group.userData.archS = [];
    const ARCH_COLORS = [0xff4f4f, 0x2d9cff, 0xffc933, 0x35d08a, 0xff7ad9, 0xff8a1f];
    let k = 0;
    const m4 = new THREE.Matrix4();
    for (let s = 150; s < main.length - 20; s += 135) {
      const i = main.index(s);
      const st = STYLES[main.style[i]];
      const zone = zoneOf(i);
      if (!(st === 'street' || st === 'board' || st === 'highway') || !main.floor[i] || main.up[i * 3 + 1] < 0.93) continue;
      if (zone === 'roof') continue;
      main.sample(s, F);
      const hw = F.halfWidth + 0.5;
      _v.crossVectors(Y, F.tan).normalize(); // horizontal lateral axis
      m4.makeBasis(_v, Y, _w.crossVectors(_v, Y).normalize());
      m4.setPosition(F.pos);
      const col = ARCH_COLORS[k++ % ARCH_COLORS.length];
      group.userData.archS.push(s);
      const local = [
        { geo: new THREE.BoxGeometry(0.45, 9, 0.45), color: 0x3a3f47, pos: [hw, 4.5, 0] },
        { geo: new THREE.BoxGeometry(0.45, 9, 0.45), color: 0x3a3f47, pos: [-hw, 4.5, 0] },
        { geo: new THREE.BoxGeometry(hw * 2 + 0.6, 0.35, 0.35), color: 0x3a3f47, pos: [0, 8.8, 0] },
        { geo: new THREE.BoxGeometry(hw * 1.5, 1.5, 0.12), color: col, pos: [0, 7.6, 0] },
        { geo: new THREE.BoxGeometry(hw * 1.5, 0.28, 0.14), color: 0xffffff, pos: [0, 7.6, 0] },
      ];
      for (const part of local) {
        const g = part.geo.toNonIndexed();
        g.translate(...part.pos);
        g.applyMatrix4(m4);
        parts.push({ geo: g, color: part.color });
      }
    }
    if (parts.length) {
      const arches = new THREE.Mesh(mergeColored(parts), new THREE.MeshLambertMaterial({ vertexColors: true }));
      arches.name = 'arches';
      group.add(arches);
    }
  }

  // --------------------------------------------------------------- overhead wires (street zones)
  {
    const pts = [];
    const A = new THREE.Vector3(), B = new THREE.Vector3();
    const F2 = makeFrame();
    for (let s = 0; s < main.length - 12; s += 12) {
      const i = main.index(s);
      const st = STYLES[main.style[i]];
      if (!(st === 'street') || zoneOf(i) === 'board' || !main.floor[i] || main.up[i * 3 + 1] < 0.9) continue;
      main.sample(s, F); main.sample(s + 12, F2);
      if (!main.floor[main.index(s + 12)] || F2.up.y < 0.9) continue;
      for (const x of [-2.2, 2.2]) {
        A.copy(F.pos).addScaledVector(F.right, x); A.y += 7.8;
        B.copy(F2.pos).addScaledVector(F2.right, x); B.y += 7.8;
        pts.push(A.x, A.y, A.z, B.x, B.y, B.z);
      }
      if (Math.round(s / 12) % 4 === 0) {
        A.copy(F.pos).addScaledVector(F.right, -F.halfWidth - 0.3); A.y += 7.9;
        B.copy(F.pos).addScaledVector(F.right, F.halfWidth + 0.3); B.y += 7.9;
        pts.push(A.x, A.y, A.z, B.x, B.y, B.z);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const wires = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x2a2a30, transparent: true, opacity: 0.7 }));
    wires.name = 'wires';
    group.add(wires);
  }

  // --------------------------------------------------------------- pillars under elevated sections
  {
    const pillarGeo = new THREE.CylinderGeometry(1, 1.15, 1, 10);
    pillarGeo.translate(0, -0.5, 0);
    const pillars = new Batch(pillarGeo, new THREE.MeshLambertMaterial({ color: 0xc9c4b8 }), 'pillars');
    for (let s = 0; s < main.length; s += 32) {
      const i = main.index(s);
      const st = STYLES[main.style[i]];
      if (!main.floor[i] || main.solid[i] || main.up[i * 3 + 1] < 0.85) continue;
      if (!(st === 'highway' || st === 'bridge' || st === 'pier' || st === 'loop')) continue;
      main.sample(s, F);
      const topY = F.pos.y - 1.6;
      const g = field.height(F.pos.x, F.pos.z);
      const len = topY - Math.min(g, -2) + 2;
      if (len < 2) continue;
      const r = st === 'pier' ? 0.45 : 1.1;
      for (const x of st === 'pier' ? [-F.halfWidth * 0.8, 0, F.halfWidth * 0.8] : [-F.halfWidth * 0.45, F.halfWidth * 0.45]) {
        const px = F.pos.x + F.right.x * x, pz = F.pos.z + F.right.z * x;
        pillars.add(_p.set(px, topY, pz), 0, _s.set(r, len, r));
      }
    }
    const m = pillars.build();
    if (m) group.add(m);
  }

  return group;
}
