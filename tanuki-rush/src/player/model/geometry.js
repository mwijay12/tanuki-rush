// Procedural geometry helpers for the tanuki model.
// Everything here runs once at construction time (allocations are fine).
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _col = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
// temporaries reserved for the surface mappers (never passed in as out-params)
const _sd = new THREE.Vector3();
const _sq = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Basic primitives (all indexed, only position + normal attributes)
// ---------------------------------------------------------------------------

/** Ellipsoid centred at the origin. */
export function ellipsoid(rx, ry, rz, ws = 24, hs = 16) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  g.deleteAttribute('uv');
  g.scale(rx, ry, rz);
  return g;
}

/** Unit sphere with merged seam/pole vertices so it can be deformed and re-normalled smoothly. */
export function smoothSphere(ws = 24, hs = 16) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const m = mergeVertices(g, 1e-6);
  g.dispose();
  return m;
}

/** Applies fn(v: Vector3) to every position and recomputes smooth normals. */
export function deform(geo, fn) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i);
    fn(_p);
    pos.setXYZ(i, _p.x, _p.y, _p.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Capsule hanging from the origin down to (0,-len,0) (hemisphere centres at both joints). */
export function limbCapsule(r, len, radial = 12, cap = 5) {
  const g = new THREE.CapsuleGeometry(r, len, cap, radial, 1);
  g.deleteAttribute('uv');
  g.translate(0, -len / 2, 0);
  return g;
}

/** Rounded "super ellipsoid" (boxier than an ellipsoid). e < 1 => boxier. */
export function superEllipsoid(rx, ry, rz, e = 0.6, ws = 24, hs = 14) {
  const g = smoothSphere(ws, hs);
  deform(g, (v) => {
    v.set(
      Math.sign(v.x) * Math.pow(Math.abs(v.x), e) * rx,
      Math.sign(v.y) * Math.pow(Math.abs(v.y), e) * ry,
      Math.sign(v.z) * Math.pow(Math.abs(v.z), e) * rz,
    );
  });
  return g;
}

/** Torus lying in the XZ plane (ring around the Y axis). */
export function flatTorus(R, r, radial = 8, tubular = 24) {
  const g = new THREE.TorusGeometry(R, r, radial, tubular);
  g.deleteAttribute('uv');
  g.rotateX(Math.PI / 2);
  return g;
}

/**
 * Surface of revolution around +Y with analytic normals.
 * profile: array of [s, r] (s = height along +Y, increasing; r = radius, r=0 at closed ends).
 */
export function revolve(profile, segs = 16) {
  const rows = profile.length;
  const cols = segs + 1;
  const pos = new Float32Array(rows * cols * 3);
  const nrm = new Float32Array(rows * cols * 3);
  for (let j = 0; j < rows; j++) {
    const [s, r] = profile[j];
    const jp = Math.max(0, j - 1);
    const jn = Math.min(rows - 1, j + 1);
    const ds = profile[jn][0] - profile[jp][0];
    const dr = profile[jn][1] - profile[jp][1];
    // tangent (dr, ds) in (radial, axial) -> outward normal (ds, -dr)
    let nr = ds;
    let na = -dr;
    const l = Math.hypot(nr, na) || 1;
    nr /= l;
    na /= l;
    for (let i = 0; i < cols; i++) {
      const phi = (i / segs) * Math.PI * 2;
      const cx = Math.sin(phi);
      const cz = Math.cos(phi);
      const k = (j * cols + i) * 3;
      pos[k] = cx * r;
      pos[k + 1] = s;
      pos[k + 2] = cz * r;
      nrm[k] = cx * nr;
      nrm[k + 1] = na;
      nrm[k + 2] = cz * nr;
    }
  }
  const idx = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      // outward-facing winding (verified: sin/cos ordering above yields CCW from outside)
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(idx);
  fixWinding(g);
  return g;
}

/**
 * Makes sure triangle winding agrees with the stored normals (flips all triangles if the
 * majority disagree). Cheap sanity guard for hand-built geometry.
 */
export function fixWinding(g) {
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const index = g.index.array;
  let agree = 0;
  let disagree = 0;
  for (let t = 0; t < index.length; t += 3) {
    const i0 = index[t], i1 = index[t + 1], i2 = index[t + 2];
    _a.fromBufferAttribute(pos, i0);
    _b.fromBufferAttribute(pos, i1).sub(_a);
    _c.fromBufferAttribute(pos, i2).sub(_a);
    _b.cross(_c);
    if (_b.lengthSq() < 1e-14) continue;
    _n.fromBufferAttribute(nrm, i0);
    _p.fromBufferAttribute(nrm, i1);
    _n.add(_p);
    _p.fromBufferAttribute(nrm, i2);
    _n.add(_p);
    if (_b.dot(_n) >= 0) agree++;
    else disagree++;
  }
  if (disagree > agree) {
    const arr = g.index.array;
    for (let t = 0; t < arr.length; t += 3) {
      const tmp = arr[t + 1];
      arr[t + 1] = arr[t + 2];
      arr[t + 2] = tmp;
    }
    g.index.needsUpdate = true;
  }
  return g;
}

// ---------------------------------------------------------------------------
// Surfaces used to "paint" decals (crisp colour patches that follow a curved surface)
// ---------------------------------------------------------------------------

function makeFrame(d0, t1Hint) {
  const t1 = new THREE.Vector3();
  if (t1Hint) t1.copy(t1Hint);
  else t1.crossVectors(UP, d0);
  if (t1.lengthSq() < 1e-8) t1.set(1, 0, 0);
  // orthogonalise
  t1.addScaledVector(d0, -t1.dot(d0)).normalize();
  const t2 = new THREE.Vector3().crossVectors(d0, t1).normalize();
  return { t1, t2 };
}

/**
 * Axis-aligned ellipsoid surface. map(x, y) projects the 2D decal coordinate (x = right when
 * looking at the surface from outside, y = up) onto the ellipsoid, gnomonic-style around d0.
 */
export class EllipsoidSurface {
  constructor(center, radii, dir, t1Hint) {
    this.c = new THREE.Vector3().copy(center);
    this.r = new THREE.Vector3().copy(radii);
    this.d0 = new THREE.Vector3().copy(dir).normalize();
    const f = makeFrame(this.d0, t1Hint);
    this.t1 = f.t1;
    this.t2 = f.t2;
  }

  map(x, y, lift, outP, outN) {
    const d = _sd.copy(this.d0).addScaledVector(this.t1, x).addScaledVector(this.t2, y).normalize();
    const r = this.r;
    const k = Math.sqrt((d.x / r.x) ** 2 + (d.y / r.y) ** 2 + (d.z / r.z) ** 2);
    const lam = 1 / Math.max(k, 1e-6);
    outP.copy(d).multiplyScalar(lam);
    outN.set(outP.x / (r.x * r.x), outP.y / (r.y * r.y), outP.z / (r.z * r.z)).normalize();
    outP.add(this.c).addScaledVector(outN, lift);
  }
}

/**
 * Surface of revolution around a vertical axis through (cx, *, cz), cross-section scaled by
 * zScale in Z. profileFn(y) -> radius (0 outside the valid range), dProfileFn(y) -> dr/dy.
 */
export class RevolvedSurface {
  constructor(origin, dir, profileFn, dProfileFn, zScale = 1, maxDist = 1, t1Hint) {
    this.o = new THREE.Vector3().copy(origin);
    this.d0 = new THREE.Vector3().copy(dir).normalize();
    this.f = profileFn;
    this.df = dProfileFn;
    this.zs = zScale;
    this.maxDist = maxDist;
    const fr = makeFrame(this.d0, t1Hint);
    this.t1 = fr.t1;
    this.t2 = fr.t2;
  }

  inside(p) {
    const rho = Math.hypot(p.x, p.z / this.zs);
    return rho < this.f(p.y);
  }

  map(x, y, lift, outP, outN) {
    const d = _sd.copy(this.d0).addScaledVector(this.t1, x).addScaledVector(this.t2, y).normalize();
    // bisection along the ray from the (inside) origin
    let lo = 0;
    let hi = this.maxDist;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) * 0.5;
      _sq.copy(this.o).addScaledVector(d, mid);
      if (this.inside(_sq)) lo = mid;
      else hi = mid;
    }
    outP.copy(this.o).addScaledVector(d, lo);
    const rho = Math.max(Math.hypot(outP.x, outP.z / this.zs), 1e-6);
    outN.set(outP.x / rho, -this.df(outP.y), outP.z / (this.zs * this.zs * rho)).normalize();
    outP.addScaledVector(outN, lift);
  }
}

// ---------------------------------------------------------------------------
// Decal builders
// ---------------------------------------------------------------------------

/** Ellipse outline (CCW) as [x,y] points. rot rotates the ellipse (radians, CCW). */
export function ellipseShape(cx, cy, rx, ry, rot = 0, n = 28) {
  const pts = [];
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = Math.cos(t) * rx;
    const y = Math.sin(t) * ry;
    pts.push([cx + x * cr - y * sr, cy + x * sr + y * cr]);
  }
  return pts;
}

/** Keeps the part of a convex polygon where a*x + b*y + c >= 0 (Sutherland–Hodgman). */
export function clipShape(pts, a, b, c) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const P = pts[i];
    const Q = pts[(i + 1) % pts.length];
    const dp = a * P[0] + b * P[1] + c;
    const dq = a * Q[0] + b * Q[1] + c;
    if (dp >= 0) out.push(P);
    if ((dp >= 0) !== (dq >= 0)) {
      const t = dp / (dp - dq);
      out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]);
    }
  }
  return out;
}

/** Filled convex decal. shape: CCW [x,y] points. */
export function fillDecal(shape, surf, lift, rings = 4) {
  const n = shape.length;
  let cx = 0;
  let cy = 0;
  for (const [x, y] of shape) {
    cx += x;
    cy += y;
  }
  cx /= n;
  cy /= n;
  const pos = [];
  const nrm = [];
  const push = (x, y) => {
    surf.map(x, y, lift, _p, _n);
    pos.push(_p.x, _p.y, _p.z);
    nrm.push(_n.x, _n.y, _n.z);
  };
  push(cx, cy);
  for (let r = 1; r <= rings; r++) {
    const t = r / rings;
    for (let i = 0; i < n; i++) push(cx + (shape[i][0] - cx) * t, cy + (shape[i][1] - cy) * t);
  }
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(0, 1 + i, 1 + ((i + 1) % n));
  for (let r = 1; r < rings; r++) {
    const a = 1 + (r - 1) * n;
    const b = 1 + r * n;
    for (let i = 0; i < n; i++) {
      const i1 = (i + 1) % n;
      idx.push(a + i, b + i, b + i1, a + i, b + i1, a + i1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  fixWinding(g);
  return g;
}

/**
 * Stroke decal along a 2D path. width may be a number or fn(u in 0..1) -> width.
 */
export function strokeDecal(path, width, surf, lift) {
  const n = path.length;
  const pos = [];
  const nrm = [];
  for (let i = 0; i < n; i++) {
    const p0 = path[Math.max(0, i - 1)];
    const p1 = path[Math.min(n - 1, i + 1)];
    let tx = p1[0] - p0[0];
    let ty = p1[1] - p0[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    const w = (typeof width === 'function' ? width(i / (n - 1)) : width) * 0.5;
    const nx = -ty * w;
    const ny = tx * w;
    surf.map(path[i][0] + nx, path[i][1] + ny, lift, _p, _n);
    pos.push(_p.x, _p.y, _p.z);
    nrm.push(_n.x, _n.y, _n.z);
    surf.map(path[i][0] - nx, path[i][1] - ny, lift, _p, _n);
    pos.push(_p.x, _p.y, _p.z);
    nrm.push(_n.x, _n.y, _n.z);
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    const L0 = i * 2;
    const R0 = L0 + 1;
    const L1 = L0 + 2;
    const R1 = L0 + 3;
    idx.push(R0, R1, L1, R0, L1, L0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  fixWinding(g);
  return g;
}

/**
 * Crisp band on a sphere around the great circle in the XY plane (normal +Z).
 * halfAngle = half width of the band in radians. Rotate the result to place it.
 */
export function sphereBand(radius, halfAngle, segs = 96, rows = 4) {
  const pos = [];
  const nrm = [];
  for (let i = 0; i < segs; i++) {
    const th = (i / segs) * Math.PI * 2;
    for (let j = 0; j <= rows; j++) {
      const ph = -halfAngle + (2 * halfAngle * j) / rows;
      const x = Math.cos(ph) * Math.cos(th);
      const y = Math.cos(ph) * Math.sin(th);
      const z = Math.sin(ph);
      pos.push(x * radius, y * radius, z * radius);
      nrm.push(x, y, z);
    }
  }
  const idx = [];
  const R = rows + 1;
  for (let i = 0; i < segs; i++) {
    const i1 = (i + 1) % segs;
    for (let j = 0; j < rows; j++) {
      const a = i * R + j;
      const b = i1 * R + j;
      const c = i1 * R + j + 1;
      const d = i * R + j + 1;
      idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  fixWinding(g);
  return g;
}

// ---------------------------------------------------------------------------
// Hachimaki band that hugs an ellipsoidal head
// ---------------------------------------------------------------------------

/**
 * Closed band (torus topology) wrapped around an ellipsoid (radii A,B,C, centred at origin).
 * y0 = band centre height, tilt = rotation about X (negative lifts the front),
 * halfH = half band height, thick = radial thickness, gap = distance from the head surface.
 */
export function headBand(A, B, C, y0, tilt, halfH, thick, gap = 0.002, segs = 64, prof = 14) {
  const st = Math.sin(tilt);
  const ct = Math.cos(tilt);
  const profile = [];
  for (let k = 0; k < prof; k++) {
    const t = (k / prof) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const e = 0.35; // squarish rounded rectangle
    const h = Math.sign(s) * Math.pow(Math.abs(s), e) * halfH;
    const d = gap + thick * 0.5 + Math.sign(c) * Math.pow(Math.abs(c), e) * thick * 0.5;
    profile.push([h, d]);
  }
  const pos = [];
  for (let i = 0; i < segs; i++) {
    const phi = (i / segs) * Math.PI * 2;
    const sp = Math.sin(phi);
    const cp = Math.cos(phi);
    for (let k = 0; k < prof; k++) {
      const [h, d] = profile[k];
      const Y = y0 + h;
      // solve for rho: point p' = (rho cp, Y, rho sp) in band frame, p = Rx(tilt) p' on ellipsoid
      const qa = (cp * cp) / (A * A) + (sp * sp * st * st) / (B * B) + (sp * sp * ct * ct) / (C * C);
      const qb = (-2 * Y * ct * sp * st) / (B * B) + (2 * Y * st * sp * ct) / (C * C);
      const qc = (Y * Y * ct * ct) / (B * B) + (Y * Y * st * st) / (C * C) - 1;
      const disc = Math.max(qb * qb - 4 * qa * qc, 0);
      const rho = (-qb + Math.sqrt(disc)) / (2 * qa);
      const R = rho + d;
      const x = R * cp;
      const yb = Y;
      const zb = R * sp;
      // rotate about X by tilt
      pos.push(x, yb * ct - zb * st, yb * st + zb * ct);
    }
  }
  const idx = [];
  for (let i = 0; i < segs; i++) {
    const i1 = (i + 1) % segs;
    for (let k = 0; k < prof; k++) {
      const k1 = (k + 1) % prof;
      const a = i * prof + k;
      const b = i1 * prof + k;
      const c = i1 * prof + k1;
      const d = i * prof + k1;
      idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // make normals point away from the head centre (flip winding if needed)
  const p = g.attributes.position;
  const nn = g.attributes.normal;
  let dot = 0;
  for (let i = 0; i < p.count; i++) dot += p.getX(i) * nn.getX(i) + p.getZ(i) * nn.getZ(i);
  if (dot < 0) {
    const arr = g.index.array;
    for (let t = 0; t < arr.length; t += 3) {
      const tmp = arr[t + 1];
      arr[t + 1] = arr[t + 2];
      arr[t + 2] = tmp;
    }
    g.computeVertexNormals();
  }
  return g;
}

// ---------------------------------------------------------------------------
// Rig geometry builder: bakes parts (in bone-local space) into merged skinned geometries.
// ---------------------------------------------------------------------------

export class RigGeometryBuilder {
  /**
   * @param {Object<string, THREE.Vector3>} bonePos  bind-pose world position per bone name
   * @param {Object<string, number>} boneIndex        skeleton index per bone name
   */
  constructor(bonePos, boneIndex) {
    this.bonePos = bonePos;
    this.boneIndex = boneIndex;
    this.lists = { body: [], face: [], outline: [] };
  }

  /**
   * Adds a rigid part.
   * opts: { bone, color, pos:[x,y,z], rot:[x,y,z], order, target:'body'|'face', outline:boolean }
   */
  add(geo, opts) {
    const { bone, color, colorFn, pos, rot, order = 'XYZ', target = 'body', outline = false, world = false } = opts;
    const bp = this.bonePos[bone];
    if (!bp) throw new Error(`unknown bone ${bone}`);
    if (pos || rot) {
      _e.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0, order);
      _q.setFromEuler(_e);
      _m.compose(_p.set(pos ? pos[0] : 0, pos ? pos[1] : 0, pos ? pos[2] : 0), _q, _s.set(1, 1, 1));
      geo.applyMatrix4(_m);
    }
    // geometry is authored in bone-local space unless `world` is set (bind pose has no rotations)
    if (!world) geo.translate(bp.x, bp.y, bp.z);
    this._finish(geo, colorFn ? null : color, bone, colorFn || null, null);
    this.lists[target].push(geo);
    if (outline) this.lists.outline.push(geo);
    return geo;
  }

  /**
   * Adds a part with per-vertex colour and blended weights. Geometry must already be in
   * bind-pose model space. colorFn(i, pos, outColor), weightFn(i, pos, outIdx[4], outW[4]).
   */
  addCustom(geo, { colorFn, weightFn, target = 'body', outline = false }) {
    this._finish(geo, null, null, colorFn, weightFn);
    this.lists[target].push(geo);
    if (outline) this.lists.outline.push(geo);
    return geo;
  }

  _finish(geo, color, bone, colorFn, weightFn) {
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
    }
    if (!geo.index) {
      const n = geo.attributes.position.count;
      const idx = new Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      geo.setIndex(idx);
    }
    const n = geo.attributes.position.count;
    const col = new Float32Array(n * 3);
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const pos = geo.attributes.position;
    const outIdx = [0, 0, 0, 0];
    const outW = [0, 0, 0, 0];
    if (color !== null && color !== undefined) _col.set(color);
    const bi = bone ? this.boneIndex[bone] : 0;
    for (let i = 0; i < n; i++) {
      if (colorFn) {
        _p.fromBufferAttribute(pos, i);
        colorFn(i, _p, _col);
      }
      col[i * 3] = _col.r;
      col[i * 3 + 1] = _col.g;
      col[i * 3 + 2] = _col.b;
      if (weightFn) {
        _p.fromBufferAttribute(pos, i);
        outIdx[0] = outIdx[1] = outIdx[2] = outIdx[3] = 0;
        outW[0] = outW[1] = outW[2] = outW[3] = 0;
        weightFn(i, _p, outIdx, outW);
        for (let k = 0; k < 4; k++) {
          si[i * 4 + k] = outIdx[k];
          sw[i * 4 + k] = outW[k];
        }
      } else {
        si[i * 4] = bi;
        sw[i * 4] = 1;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  }

  build() {
    const out = {};
    for (const key of Object.keys(this.lists)) {
      const list = this.lists[key];
      out[key] = list.length ? mergeGeometries(list, false) : null;
    }
    // part geometries are no longer needed
    const seen = new Set();
    for (const key of Object.keys(this.lists)) {
      for (const g of this.lists[key]) {
        if (!seen.has(g)) {
          seen.add(g);
          g.dispose();
        }
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Static (non-skinned) merged part builder: position/normal/color only.
// ---------------------------------------------------------------------------

export class StaticGeometryBuilder {
  constructor() {
    this.lists = { main: [], outline: [] };
  }

  add(geo, { color, colorFn, pos, rot, order = 'XYZ', outline = false, target = 'main' }) {
    if (pos || rot) {
      _e.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0, order);
      _q.setFromEuler(_e);
      _m.compose(_p.set(pos ? pos[0] : 0, pos ? pos[1] : 0, pos ? pos[2] : 0), _q, _s.set(1, 1, 1));
      geo.applyMatrix4(_m);
    }
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
    }
    if (!geo.index) {
      const n = geo.attributes.position.count;
      const idx = new Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      geo.setIndex(idx);
    }
    const n = geo.attributes.position.count;
    const col = new Float32Array(n * 3);
    const pa = geo.attributes.position;
    if (color !== undefined && color !== null) _col.set(color);
    for (let i = 0; i < n; i++) {
      if (colorFn) {
        _p.fromBufferAttribute(pa, i);
        colorFn(i, _p, _col);
      }
      col[i * 3] = _col.r;
      col[i * 3 + 1] = _col.g;
      col[i * 3 + 2] = _col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!this.lists[target]) this.lists[target] = [];
    this.lists[target].push(geo);
    if (outline) this.lists.outline.push(geo);
    return geo;
  }

  build() {
    const out = {};
    const seen = new Set();
    for (const key of Object.keys(this.lists)) {
      const list = this.lists[key];
      out[key] = list.length ? mergeGeometries(list, false) : null;
    }
    for (const key of Object.keys(this.lists)) {
      for (const g of this.lists[key]) {
        if (!seen.has(g)) {
          seen.add(g);
          g.dispose();
        }
      }
    }
    return out;
  }
}

/** Builds a copy of a geometry with smooth (position-merged) normals for inverted-hull outlines. */
export function smoothNormalsCopy(geo) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.attributes.position.clone());
  if (geo.index) g.setIndex(geo.index.clone());
  const m = mergeVertices(g, 1e-4);
  g.dispose();
  m.computeVertexNormals();
  return m;
}
