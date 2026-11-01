import * as THREE from 'three';
import { mergeColored, rng } from '../core/geo.js';

// Big distant set dressing: a red suspension bridge across the bay,
// far mountains/islands, sailboats and a lighthouse.

function suspensionBridge(length = 1900, towerH = 150, deckH = 38) {
  const g = new THREE.Group();
  const red = 0xd6452b;
  const half = length / 2;
  const towerX = length * 0.28;
  const parts = [];
  // deck
  parts.push({ geo: new THREE.BoxGeometry(length, 4, 26), color: red, pos: [0, deckH, 0] });
  parts.push({ geo: new THREE.BoxGeometry(length, 1, 24), color: 0x6d6f73, pos: [0, deckH + 2.5, 0] });
  // towers
  for (const x of [-towerX, towerX]) {
    for (const z of [-11, 11]) parts.push({ geo: new THREE.BoxGeometry(7, towerH, 7), color: red, pos: [x, towerH / 2, z] });
    for (const y of [deckH + 12, towerH * 0.6, towerH - 6]) parts.push({ geo: new THREE.BoxGeometry(6, 5, 22), color: red, pos: [x, y, 0] });
    parts.push({ geo: new THREE.BoxGeometry(14, 16, 40), color: 0x9b958a, pos: [x, -4, 0] });
  }
  const mesh = new THREE.Mesh(mergeColored(parts), new THREE.MeshLambertMaterial({ vertexColors: true }));
  g.add(mesh);
  // main cables + suspenders as lines
  const pts = [];
  const cable = (x) => {
    // piecewise catenary-ish: sag between towers, straight to anchors
    if (Math.abs(x) <= towerX) {
      const t = x / towerX;
      return deckH + 8 + (towerH - 6 - deckH - 8) * t * t;
    }
    const t = (Math.abs(x) - towerX) / (half - towerX);
    return (towerH - 6) + (deckH + 2 - (towerH - 6)) * t;
  };
  for (const z of [-11, 11]) {
    let prev = null;
    for (let x = -half; x <= half; x += 20) {
      const y = cable(x);
      if (prev) pts.push(prev[0], prev[1], z, x, y, z);
      prev = [x, y];
      if (Math.abs(x) < towerX - 5 && Math.round(x / 20) % 1 === 0) pts.push(x, y, z, x, deckH + 2, z);
    }
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xb23a25 })));
  return g;
}

function mountain(radius, height, seed, color) {
  const geo = new THREE.ConeGeometry(radius, height, 14, 4, true);
  const pos = geo.attributes.position;
  const R = rng(seed);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > height / 2 - 1) continue;
    const k = 1 + (R() - 0.5) * 0.35;
    pos.setX(i, pos.getX(i) * k);
    pos.setZ(i, pos.getZ(i) * k);
    pos.setY(i, y + (R() - 0.5) * height * 0.08);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, flatShading: true }));
}

function sailboat(color) {
  return mergeColored([
    { geo: new THREE.BoxGeometry(2.4, 1.2, 8), color: 0xffffff, pos: [0, 0.4, 0] },
    { geo: new THREE.CylinderGeometry(0.1, 0.1, 9, 5), color: 0x8a8a8a, pos: [0, 5, 0.5] },
    { geo: new THREE.ConeGeometry(2.8, 8, 3), color, pos: [0, 5.2, -0.8], scale: [0.15, 1, 1] },
  ]);
}

export function buildLandmarks({ main, field, hash, refs }) {
  const group = new THREE.Group();
  group.name = 'landmarks';
  const M = main.marks;
  const P = (s) => new THREE.Vector3().fromArray(main.pos, main.index(s) * 3);
  const goal = P(M.goal);
  const chase = P(M.chase_start);
  const bay = P(M.bay_start);

  // direction "out to sea": from the city (chase) toward the goal
  const out = goal.clone().sub(chase).setY(0).normalize();
  const side = new THREE.Vector3(-out.z, 0, out.x);

  // ---- suspension bridge spanning the bay ahead
  const bridge = suspensionBridge();
  const bpos = goal.clone().addScaledVector(out, 950).addScaledVector(side, -250);
  bridge.position.set(bpos.x, 0, bpos.z);
  bridge.rotation.y = Math.atan2(side.x, side.z) - Math.PI / 2;
  group.add(bridge);

  // ---- far mountains / islands ring
  const R = rng(99);
  const center = chase.clone().lerp(goal, 0.5);
  for (let k = 0; k < 26; k++) {
    const a = (k / 26) * Math.PI * 2 + R() * 0.2;
    const d = 5200 + R() * 2200;
    const x = center.x + Math.cos(a) * d, z = center.z + Math.sin(a) * d;
    const h = 380 + R() * 700;
    const m = mountain(900 + R() * 900, h, k + 3, R() < 0.5 ? 0x6f9a6a : 0x7d9e84);
    m.position.set(x, h / 2 - 60, z);
    group.add(m);
  }
  // a couple of islands in the bay
  for (let k = 0; k < 3; k++) {
    const pos = goal.clone().addScaledVector(out, 1500 + k * 700).addScaledVector(side, (k - 1) * 1300 + 400);
    const h = 90 + k * 50;
    const m = mountain(420 + k * 120, h, 40 + k, 0x7aa36a);
    m.position.set(pos.x, h / 2 - 20, pos.z);
    group.add(m);
  }

  // ---- sailboats
  const boatMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const colors = [0xff5a4a, 0x2d9cff, 0xffc933, 0xffffff, 0x35d08a];
  for (let k = 0; k < 14; k++) {
    const pos = bay.clone().lerp(goal, R()).addScaledVector(out, 250 + R() * 900).addScaledVector(side, (R() - 0.5) * 1400);
    if (field.height(pos.x, pos.z) > -3) continue;
    if (hash.minDist(pos.x, pos.z, 40) < 30) continue;
    const b = new THREE.Mesh(sailboat(colors[k % colors.length]), boatMat);
    b.position.set(pos.x, 0.2, pos.z);
    b.rotation.y = R() * Math.PI * 2;
    group.add(b);
  }

  // ---- lighthouse at the end of the pier
  {
    const end = P(main.length - 2);
    const lh = mergeColored([
      { geo: new THREE.CylinderGeometry(2.2, 3.2, 18, 12), color: 0xffffff, pos: [0, 9, 0] },
      { geo: new THREE.CylinderGeometry(2.3, 2.5, 3, 12), color: 0xd8342c, pos: [0, 6, 0] },
      { geo: new THREE.CylinderGeometry(2.1, 2.3, 3, 12), color: 0xd8342c, pos: [0, 13, 0] },
      { geo: new THREE.CylinderGeometry(1.6, 1.6, 2.6, 10), color: 0xfff2b0, pos: [0, 19.3, 0] },
      { geo: new THREE.ConeGeometry(2.2, 2.4, 10), color: 0xd8342c, pos: [0, 21.8, 0] },
    ]);
    const m = new THREE.Mesh(lh, new THREE.MeshLambertMaterial({ vertexColors: true }));
    const fwd = new THREE.Vector3().fromArray(main.tan, main.index(main.length - 2) * 3).setY(0).normalize();
    m.position.copy(end).addScaledVector(fwd, 14);
    m.position.y = end.y - 3;
    group.add(m);
  }
  void refs;
  return group;
}
