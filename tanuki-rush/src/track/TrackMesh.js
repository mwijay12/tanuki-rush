import * as THREE from 'three';
import { STYLES, WALL_LEFT, WALL_RIGHT } from './Track.js';
import { getMaterials } from '../core/materials.js';
import { STREET_TILE, ROOF_TILE, LOOP_TILE, BRIDGE_TILE, PIER_TILE, PLAZA_TILE, RAILING_TILE } from '../core/textures.js';

const TILE = {
  street: STREET_TILE, board: STREET_TILE, roof: ROOF_TILE, loop: LOOP_TILE, bridge: BRIDGE_TILE,
  highway: BRIDGE_TILE, pier: PIER_TILE, plaza: PLAZA_TILE, facade: 10, rail: 4,
};
const SKIRT_DEPTH = { street: 4, board: 4, plaza: 3, roof: 2, facade: 2, loop: 1.2, bridge: 1.6, highway: 1.8, pier: 1.0 };
const BARRIER_STYLES = new Set(['bridge', 'highway', 'loop', 'pier', 'roof']);

class Buf {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.idx = []; }
  get vcount() { return this.pos.length / 3; }
  v(p, n, u, v) { this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.uv.push(u, v); return this.vcount - 1; }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const P = new THREE.Vector3(), U = new THREE.Vector3(), R = new THREE.Vector3(), T = new THREE.Vector3();
const A = new THREE.Vector3(), B = new THREE.Vector3(), N = new THREE.Vector3();

function getFrame(track, i) {
  P.fromArray(track.pos, i * 3); U.fromArray(track.up, i * 3); R.fromArray(track.right, i * 3); T.fromArray(track.tan, i * 3);
}

/** Split [0, count) into runs of floor samples with a constant key. Adjacent runs share the boundary sample. */
function runs(track, keyFn) {
  const out = [];
  const n = track.count;
  let i = 0;
  while (i < n - 1) {
    if (!track.floor[i] || !track.floor[i + 1]) { i++; continue; }
    const key = keyFn(i);
    let j = i + 1;
    while (j < n - 1 && track.floor[j + 1] && keyFn(j) === key) j++;
    out.push({ a: i, b: j, key });
    i = j;
  }
  return out;
}

// Chunk long runs so frustum culling can do its job.
const CHUNK = 160;

export function buildTrackMesh(track) {
  const mats = getMaterials();
  const group = new THREE.Group();
  group.name = 'track:' + track.name;
  const n = track.count;

  // ---------- top surfaces, per style ----------
  const topRuns = runs(track, (i) => track.style[i]);
  for (const run of topRuns) {
    const styleName = STYLES[run.key];
    const tile = TILE[styleName] || 10;
    for (let c0 = run.a; c0 < run.b; c0 += CHUNK) {
      const c1 = Math.min(run.b, c0 + CHUNK);
      const buf = new Buf();
      for (let i = c0; i <= c1; i++) {
        getFrame(track, i);
        const hw = track.halfWidth[i];
        const v = (i * track.spacing) / tile;
        A.copy(P).addScaledVector(R, -hw);
        B.copy(P).addScaledVector(R, hw);
        buf.v(A, U, 0, v);
        buf.v(B, U, 1, v);
      }
      const rows = c1 - c0;
      for (let k = 0; k < rows; k++) {
        const l0 = k * 2, r0 = l0 + 1, l1 = l0 + 2, r1 = l0 + 3;
        buf.quad(l0, r0, r1, l1);
      }
      const mesh = new THREE.Mesh(buf.geometry(), mats[styleName] || mats.street);
      mesh.name = 'top:' + styleName;
      group.add(mesh);
    }
  }

  // ---------- sides / skirts / solids ----------
  const sideRuns = runs(track, (i) => (track.solid[i] ? 1 : 0) * 100 + track.style[i]);
  const skirtBuf = new Buf(), solidBuf = new Buf(), underBuf = new Buf();
  for (const run of sideRuns) {
    const isSolid = run.key >= 100;
    const styleName = STYLES[run.key % 100];
    for (let c0 = run.a; c0 < run.b; c0 += CHUNK) {
      const c1 = Math.min(run.b, c0 + CHUNK);
      const buf = isSolid ? solidBuf : skirtBuf;
      for (const side of [-1, 1]) {
        const base = buf.vcount;
        for (let i = c0; i <= c1; i++) {
          getFrame(track, i);
          const hw = track.halfWidth[i];
          const depth = isSolid ? Math.max(4, track.groundDrop[i]) : (SKIRT_DEPTH[styleName] || 2);
          A.copy(P).addScaledVector(R, hw * side);
          B.copy(A).addScaledVector(U, -depth);
          N.copy(R).multiplyScalar(side);
          const v = (i * track.spacing) / 6;
          buf.v(A, N, v, 0);
          buf.v(B, N, v, depth / 6);
        }
        const rows = c1 - c0;
        for (let k = 0; k < rows; k++) {
          const t0 = base + k * 2, b0 = t0 + 1, t1 = t0 + 2, b1 = t0 + 3;
          if (side > 0) buf.quad(t0, b0, b1, t1); else buf.quad(t0, t1, b1, b0);
        }
      }
      // underside for elevated (non-solid, non-street) pieces
      if (!isSolid && styleName !== 'street' && styleName !== 'board' && styleName !== 'plaza') {
        const base = underBuf.vcount;
        for (let i = c0; i <= c1; i++) {
          getFrame(track, i);
          const hw = track.halfWidth[i];
          const depth = SKIRT_DEPTH[styleName] || 2;
          A.copy(P).addScaledVector(R, -hw).addScaledVector(U, -depth);
          B.copy(P).addScaledVector(R, hw).addScaledVector(U, -depth);
          N.copy(U).negate();
          underBuf.v(A, N, 0, 0);
          underBuf.v(B, N, 1, 0);
        }
        const rows = c1 - c0;
        for (let k = 0; k < rows; k++) {
          const l0 = base + k * 2, r0 = l0 + 1, l1 = l0 + 2, r1 = l0 + 3;
          underBuf.quad(l0, l1, r1, r0);
        }
      }
    }
    // caps on solid run ends
    if (isSolid) {
      for (const [i, dir] of [[run.a, -1], [run.b, 1]]) {
        getFrame(track, i);
        const hw = track.halfWidth[i];
        const depth = Math.max(4, track.groundDrop[i]);
        N.copy(T).multiplyScalar(dir);
        const base = solidBuf.vcount;
        const pts = [
          P.clone().addScaledVector(R, -hw), P.clone().addScaledVector(R, hw),
          P.clone().addScaledVector(R, hw).addScaledVector(U, -depth), P.clone().addScaledVector(R, -hw).addScaledVector(U, -depth),
        ];
        for (const p of pts) solidBuf.v(p, N, 0, 0);
        if (dir > 0) solidBuf.quad(base, base + 1, base + 2, base + 3); else solidBuf.quad(base, base + 3, base + 2, base + 1);
      }
    }
  }
  if (skirtBuf.idx.length) group.add(named(new THREE.Mesh(skirtBuf.geometry(), mats.skirt), 'skirt'));
  if (solidBuf.idx.length) group.add(named(new THREE.Mesh(solidBuf.geometry(), mats.solid), 'solid'));
  if (underBuf.idx.length) group.add(named(new THREE.Mesh(underBuf.geometry(), mats.underside), 'under'));

  // ---------- barriers ----------
  const barBuf = new Buf(), parBuf = new Buf();
  const roofStyle = STYLES.indexOf('roof');
  const barRuns = runs(track, (i) => (BARRIER_STYLES.has(STYLES[track.style[i]]) ? track.walls[i] + (track.style[i] === roofStyle ? 8 : 0) : 0));
  for (const run of barRuns) {
    if (!run.key) continue;
    const parapet = run.key >= 8;
    const buf = parapet ? parBuf : barBuf;
    const height = parapet ? 0.7 : 1.1;
    for (const [bit, side] of [[WALL_LEFT, -1], [WALL_RIGHT, 1]]) {
      if (!(run.key & bit)) continue;
      const base = buf.vcount;
      for (let i = run.a; i <= run.b; i++) {
        getFrame(track, i);
        const hw = track.halfWidth[i];
        A.copy(P).addScaledVector(R, hw * side);
        B.copy(A).addScaledVector(U, height);
        N.copy(R).multiplyScalar(-side);
        const v = (i * track.spacing) / RAILING_TILE;
        buf.v(A, N, v, 0);
        buf.v(B, N, v, 1);
      }
      for (let k = 0; k < run.b - run.a; k++) {
        const t0 = base + k * 2;
        if (side < 0) buf.quad(t0, t0 + 2, t0 + 3, t0 + 1); else buf.quad(t0, t0 + 1, t0 + 3, t0 + 2);
      }
    }
  }
  if (barBuf.idx.length) group.add(named(new THREE.Mesh(barBuf.geometry(), mats.railing), 'barrier'));
  if (parBuf.idx.length) group.add(named(new THREE.Mesh(parBuf.geometry(), mats.parapet), 'parapet'));

  return group;
}

function named(o, name) { o.name = name; return o; }

/** Grind rail: tube + support posts down to the road below. */
export function buildRailMesh(rail, postTo = null) {
  const mats = getMaterials();
  const group = new THREE.Group();
  const pts = [];
  const step = Math.max(1, Math.round(2 / rail.spacing));
  for (let i = 0; i < rail.count; i += step) pts.push(new THREE.Vector3().fromArray(rail.pos, i * 3));
  const last = new THREE.Vector3().fromArray(rail.pos, (rail.count - 1) * 3);
  if (pts[pts.length - 1].distanceToSquared(last) > 0.01) pts.push(last);
  const curve = new THREE.CatmullRomCurve3(pts);
  const tube = new THREE.TubeGeometry(curve, Math.max(8, pts.length * 3), 0.13, 8, false);
  group.add(new THREE.Mesh(tube, mats.rail));
  // posts every ~7 m, going down along -up by postTo(s) meters (or 1.2 m)
  const postGeo = new THREE.CylinderGeometry(0.07, 0.07, 1, 6);
  postGeo.translate(0, -0.5, 0);
  const count = Math.floor(rail.length / 7) + 1;
  const inst = new THREE.InstancedMesh(postGeo, mats.railPost, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3();
  let k = 0;
  for (let d = 0; d <= rail.length && k < count; d += 7, k++) {
    const i = rail.index(d);
    p.fromArray(rail.pos, i * 3);
    up.fromArray(rail.up, i * 3);
    const len = postTo ? postTo(d) : 1.2;
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    s.set(1, Math.max(0.2, len), 1);
    m.compose(p, q, s);
    inst.setMatrixAt(k, m);
  }
  inst.count = k;
  group.add(inst);
  return group;
}
