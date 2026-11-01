import * as THREE from 'three';

// A Track is a ribbon defined by a dense, uniformly spaced list of frames
// (position / tangent / up / right) plus per-sample gameplay attributes.
// Everything that moves "along the course" (player, camera, truck, objects)
// works in track coordinates: s (distance along), x (lateral, +right), h (height along up).

export const STYLES = ['street', 'roof', 'facade', 'bridge', 'loop', 'pier', 'plaza', 'rail', 'highway', 'board'];
export const WALL_LEFT = 1;
export const WALL_RIGHT = 2;

const _v = new THREE.Vector3();

export class Track {
  /**
   * @param {object} d  raw arrays produced by TrackBuilder.build()
   */
  constructor(d) {
    this.name = d.name || 'track';
    this.kind = d.kind || 'road'; // 'road' | 'rail'
    this.spacing = d.spacing;
    this.count = d.count;
    this.length = (d.count - 1) * d.spacing;
    this.pos = d.pos;
    this.up = d.up;
    this.tan = new Float32Array(d.count * 3);
    this.right = new Float32Array(d.count * 3);
    this.kU = new Float32Array(d.count); // curvature toward up (+ = concave / valley)
    this.kR = new Float32Array(d.count); // curvature toward right (+ = turning right)
    this.halfWidth = d.halfWidth;
    this.floor = d.floor;
    this.walls = d.walls;
    this.style = d.style;
    this.zone = d.zone;
    this.stick = d.stick;
    this.solid = d.solid;
    this.groundDrop = d.groundDrop;
    this.zones = d.zones || ['city'];
    this.marks = d.marks || {};
    this._computeFrames();
    this._computeBounds();
  }

  _computeFrames() {
    const n = this.count, P = this.pos, T = this.tan, U = this.up, R = this.right;
    const t = new THREE.Vector3(), u = new THREE.Vector3(), r = new THREE.Vector3();
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
      a.fromArray(P, i0 * 3); b.fromArray(P, i1 * 3);
      t.subVectors(b, a);
      if (t.lengthSq() < 1e-10) t.set(0, 0, 1);
      t.normalize();
      u.fromArray(U, i * 3);
      u.addScaledVector(t, -u.dot(t));
      if (u.lengthSq() < 1e-8) u.set(0, 1, 0);
      u.normalize();
      r.crossVectors(t, u).normalize();
      t.toArray(T, i * 3); u.toArray(U, i * 3); r.toArray(R, i * 3);
    }
    // curvature from tangent derivative
    const dt = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
      const ds = (i1 - i0) * this.spacing || 1;
      a.fromArray(T, i0 * 3); b.fromArray(T, i1 * 3);
      dt.subVectors(b, a).multiplyScalar(1 / ds);
      u.fromArray(U, i * 3); r.fromArray(R, i * 3);
      this.kU[i] = dt.dot(u);
      this.kR[i] = dt.dot(r);
    }
  }

  _computeBounds() {
    const box = new THREE.Box3();
    for (let i = 0; i < this.count; i++) box.expandByPoint(_v.fromArray(this.pos, i * 3));
    this.bounds = box;
  }

  clampS(s) { return s < 0 ? 0 : s > this.length ? this.length : s; }

  index(s) { return Math.min(this.count - 1, Math.max(0, Math.round(s / this.spacing))); }

  /**
   * Interpolated frame at distance s. `out` must have Vector3 fields pos, tan, up, right.
   * Discrete attributes come from the nearest sample.
   */
  sample(s, out) {
    const f = this.clampS(s) / this.spacing;
    let i = Math.floor(f);
    if (i >= this.count - 1) i = this.count - 2;
    const t = f - i;
    const j = i * 3, k = j + 3;
    const P = this.pos, T = this.tan, U = this.up, R = this.right;
    out.pos.set(P[j] + (P[k] - P[j]) * t, P[j + 1] + (P[k + 1] - P[j + 1]) * t, P[j + 2] + (P[k + 2] - P[j + 2]) * t);
    out.tan.set(T[j] + (T[k] - T[j]) * t, T[j + 1] + (T[k + 1] - T[j + 1]) * t, T[j + 2] + (T[k + 2] - T[j + 2]) * t).normalize();
    out.up.set(U[j] + (U[k] - U[j]) * t, U[j + 1] + (U[k + 1] - U[j + 1]) * t, U[j + 2] + (U[k + 2] - U[j + 2]) * t);
    out.up.addScaledVector(out.tan, -out.up.dot(out.tan)).normalize();
    out.right.crossVectors(out.tan, out.up).normalize();
    const n = t < 0.5 ? i : i + 1;
    out.i = n;
    out.s = this.clampS(s);
    out.kU = this.kU[i] + (this.kU[i + 1] - this.kU[i]) * t;
    out.kR = this.kR[i] + (this.kR[i + 1] - this.kR[i]) * t;
    out.halfWidth = this.halfWidth[i] + (this.halfWidth[i + 1] - this.halfWidth[i]) * t;
    out.floor = this.floor[n];
    out.walls = this.walls[n];
    out.style = this.style[n];
    out.zone = this.zone[n];
    out.stick = this.stick[n];
    return out;
  }

  /** World position of track coords (s, x, h). */
  point(s, x, h, out, frame = _tmpFrame) {
    this.sample(s, frame);
    return out.copy(frame.pos).addScaledVector(frame.right, x).addScaledVector(frame.up, h);
  }

  /**
   * Project a world point onto the track near hintS.
   * Returns {s, x, h, d2} in `out` (and fills out.frame).
   */
  project(p, hintS, out, window = 48) {
    const n = this.count, P = this.pos, sp = this.spacing;
    let i0 = Math.round(hintS / sp);
    const lo = Math.max(0, i0 - window), hi = Math.min(n - 1, i0 + window);
    let best = -1, bestD = Infinity;
    for (let i = lo; i <= hi; i++) {
      const j = i * 3;
      const dx = p.x - P[j], dy = p.y - P[j + 1], dz = p.z - P[j + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return this._refine(p, best, out);
  }

  /** Global coarse search (used when there is no good hint). */
  projectGlobal(p, out, stride = 8) {
    const n = this.count, P = this.pos;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < n; i += stride) {
      const j = i * 3;
      const dx = p.x - P[j], dy = p.y - P[j + 1], dz = p.z - P[j + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return this.project(p, best * this.spacing, out, stride + 2);
  }

  _refine(p, i, out) {
    const T = this.tan, P = this.pos;
    const j = i * 3;
    const along = (p.x - P[j]) * T[j] + (p.y - P[j + 1]) * T[j + 1] + (p.z - P[j + 2]) * T[j + 2];
    let s = i * this.spacing + Math.max(-this.spacing, Math.min(this.spacing, along));
    s = this.clampS(s);
    const f = out.frame || (out.frame = makeFrame());
    this.sample(s, f);
    _v.subVectors(p, f.pos);
    out.s = s;
    out.x = _v.dot(f.right);
    out.h = _v.dot(f.up);
    out.along = _v.dot(f.tan);
    out.d2 = _v.lengthSq();
    return out;
  }

  /** Horizontal heading (radians, atan2(x,z)) of the tangent at s. */
  headingAt(s) {
    const i = this.index(s) * 3;
    return Math.atan2(this.tan[i], this.tan[i + 2]);
  }

  zoneName(s) { return this.zones[this.zone[this.index(s)]]; }
}

export function makeFrame() {
  return {
    pos: new THREE.Vector3(), tan: new THREE.Vector3(), up: new THREE.Vector3(), right: new THREE.Vector3(),
    i: 0, s: 0, kU: 0, kR: 0, halfWidth: 0, floor: 1, walls: 0, style: 0, zone: 0, stick: 0,
  };
}
const _tmpFrame = makeFrame();

// ---------------------------------------------------------------------------
// TrackBuilder: a "turtle" that walks forward with heading / pitch / roll and
// records fine raw points, then resamples to a uniform spacing.
// Angles in degrees for the public API.
//   turn  > 0 : turn RIGHT        pitch > 0 : nose UP        roll > 0 : right side DOWN
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180;
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _q = new THREE.Quaternion();
const _f = new THREE.Vector3();

const EASES = {
  linear: () => 1,
  sine: (t) => Math.sin(Math.PI * t),
  // flat middle, smooth ends (good for loops / long constant curves)
  plateau: (t) => smooth01(t / 0.18) * smooth01((1 - t) / 0.18),
  in: (t) => Math.sin(Math.PI * 0.5 * t),       // ramps in, ends at full rate
  out: (t) => Math.cos(Math.PI * 0.5 * t),      // starts at full rate, ramps out
};
function smooth01(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }

export class TrackBuilder {
  constructor({ start = new THREE.Vector3(), heading = 0, pitch = 0, roll = 0, step = 0.25, name = 'main', kind = 'road' } = {}) {
    this.name = name;
    this.kind = kind;
    this.p = start.clone();
    this.heading = heading * DEG;
    this.pitch = pitch * DEG;
    this.roll = roll * DEG;
    this.step = step;
    this.zones = [];
    this._attrs = null;
    this.set({ halfWidth: 9, floor: 1, walls: WALL_LEFT | WALL_RIGHT, style: 'street', zone: 'city', stick: 0, solid: 0, groundDrop: 0 });
    this.raw = [];
    this.dist = 0;
    this.marksRaw = {};
    this._bank = 0;
    this._emit();
  }

  set(a) {
    const next = { ...(this._attrs || {}), ...a };
    if (typeof next.zone === 'string') {
      let zi = this.zones.indexOf(next.zone);
      if (zi < 0) { zi = this.zones.length; this.zones.push(next.zone); }
      next.zoneIndex = zi;
    }
    next.styleIndex = STYLES.indexOf(next.style);
    if (next.styleIndex < 0) throw new Error('Unknown style ' + next.style);
    this._attrs = Object.freeze(next);
    return this;
  }

  get attrs() { return this._attrs; }

  mark(name) { this.marksRaw[name] = this.raw.length - 1; return this; }

  _quat() {
    _e.set(-this.pitch, this.heading, this.roll + this._bank, 'YXZ');
    return _q.setFromEuler(_e);
  }

  _emit() {
    const q = this._quat();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    this.raw.push({ p: this.p.clone(), up, a: this._attrs });
  }

  /**
   * Generic segment.
   * opts: turn, pitch, roll (deltas in degrees), pitchTo, rollTo (absolute),
   *       bank (transient roll peak, degrees, + = right side down), drift (lateral meters, + = right),
   *       ease (name of EASES), rise (extra vertical meters added smoothly)
   */
  seg(len, opts = {}) {
    let { turn = 0, pitch = 0, roll = 0, bank = 0, drift = 0, ease = 'sine', rise = 0 } = opts;
    if (opts.pitchTo !== undefined) pitch = opts.pitchTo - this.pitch / DEG;
    if (opts.rollTo !== undefined) roll = opts.rollTo - this.roll / DEG;
    const n = Math.max(1, Math.ceil(len / this.step));
    const ds = len / n;
    const fn = EASES[ease] || EASES.sine;
    const w = new Float64Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) { w[i] = Math.max(0, fn((i + 0.5) / n)); sum += w[i]; }
    if (sum <= 0) { w.fill(1); sum = n; }
    // drift & rise use a smoothstep profile (derivative is a bell)
    let prevD = 0;
    for (let i = 0; i < n; i++) {
      const k = w[i] / sum;
      this.heading -= turn * DEG * k;
      this.pitch += pitch * DEG * k;
      this.roll += roll * DEG * k;
      const t = (i + 1) / n;
      this._bank = bank * DEG * Math.sin(Math.PI * t);
      const q = this._quat();
      _f.set(0, 0, 1).applyQuaternion(q);
      this.p.addScaledVector(_f, ds);
      const dNow = smooth01(t);
      const dd = dNow - prevD;
      prevD = dNow;
      if (drift) {
        // horizontal right vector for current heading
        this.p.x += -Math.cos(this.heading) * drift * dd;
        this.p.z += Math.sin(this.heading) * drift * dd;
      }
      if (rise) this.p.y += rise * dd;
      this.dist += ds;
      this._emit();
    }
    this._bank = 0;
    return this;
  }

  straight(len, opts = {}) { return this.seg(len, { ...opts, ease: opts.ease || 'linear' }); }
  turn(deg, len, opts = {}) { return this.seg(len, { ...opts, turn: deg }); }
  pitchTo(deg, len, opts = {}) { return this.seg(len, { ...opts, pitchTo: deg }); }

  /** Vertical loop of given radius. drift = lateral offset so exit does not overlap entry. */
  loop(radius, drift = 12, opts = {}) {
    // plateau ease makes the arc slightly longer than 2πR; compensate a little
    const len = 2 * Math.PI * radius * 1.12;
    this.seg(len, { ...opts, pitch: 360, drift, ease: 'plateau' });
    // normalise pitch back
    this.pitch -= 2 * Math.PI;
    return this;
  }

  /** Corkscrew: a roll of 360° while travelling, with lateral drift. */
  corkscrew(len, dir = 1, opts = {}) {
    this.seg(len, { ...opts, roll: 360 * dir, ease: 'plateau' });
    this.roll -= 2 * Math.PI * dir;
    return this;
  }

  pose() {
    return { p: this.p.clone(), heading: this.heading / DEG, pitch: this.pitch / DEG, roll: this.roll / DEG };
  }

  build(spacing = 1) {
    const raw = this.raw, n = raw.length;
    const L = new Float64Array(n);
    for (let i = 1; i < n; i++) L[i] = L[i - 1] + raw[i].p.distanceTo(raw[i - 1].p);
    const total = L[n - 1];
    const count = Math.floor(total / spacing) + 1;
    const pos = new Float32Array(count * 3), up = new Float32Array(count * 3);
    const halfWidth = new Float32Array(count), groundDrop = new Float32Array(count);
    const floor = new Uint8Array(count), walls = new Uint8Array(count), style = new Uint8Array(count);
    const zone = new Uint8Array(count), stick = new Uint8Array(count), solid = new Uint8Array(count);
    const pa = new THREE.Vector3(), ua = new THREE.Vector3();
    let j = 0;
    for (let k = 0; k < count; k++) {
      const s = k * spacing;
      while (j < n - 2 && L[j + 1] < s) j++;
      const seg = L[j + 1] - L[j];
      const t = seg > 1e-9 ? Math.min(1, Math.max(0, (s - L[j]) / seg)) : 0;
      pa.lerpVectors(raw[j].p, raw[j + 1].p, t);
      ua.lerpVectors(raw[j].up, raw[j + 1].up, t).normalize();
      pa.toArray(pos, k * 3);
      ua.toArray(up, k * 3);
      const a = (t < 0.5 ? raw[j] : raw[j + 1]).a;
      halfWidth[k] = a.halfWidth;
      groundDrop[k] = a.groundDrop;
      floor[k] = a.floor ? 1 : 0;
      walls[k] = a.walls;
      style[k] = a.styleIndex;
      zone[k] = a.zoneIndex;
      stick[k] = a.stick ? 1 : 0;
      solid[k] = a.solid ? 1 : 0;
    }
    // smooth half-width transitions (±8 m moving average)
    const hw2 = new Float32Array(count);
    const win = Math.round(8 / spacing);
    for (let k = 0; k < count; k++) {
      let acc = 0, c = 0;
      for (let q = Math.max(0, k - win); q <= Math.min(count - 1, k + win); q++) { acc += halfWidth[q]; c++; }
      hw2[k] = acc / c;
    }
    const marks = {};
    for (const [name, ri] of Object.entries(this.marksRaw)) marks[name] = L[ri];
    return new Track({
      name: this.name, kind: this.kind, spacing, count, pos, up, halfWidth: hw2, groundDrop,
      floor, walls, style, zone, stick, solid, zones: this.zones, marks,
    });
  }
}

/**
 * Build a rail (or any secondary track) that runs parallel to `base` between s0 and s1,
 * offset by x(t), h(t) (t = 0..1). Returns a Track of kind 'rail'.
 */
export function offsetTrack(base, s0, s1, xFn, hFn, { name = 'rail', kind = 'rail', spacing = 1, style = 'rail' } = {}) {
  const f = makeFrame();
  const len = s1 - s0;
  const count = Math.max(2, Math.floor(len / spacing) + 1);
  const pos = new Float32Array(count * 3), up = new Float32Array(count * 3);
  const p = new THREE.Vector3();
  for (let k = 0; k < count; k++) {
    const t = k / (count - 1);
    const s = s0 + len * t;
    base.sample(s, f);
    p.copy(f.pos).addScaledVector(f.right, xFn(t)).addScaledVector(f.up, hFn(t));
    p.toArray(pos, k * 3);
    f.up.toArray(up, k * 3);
  }
  // resample uniformly by arc length (offsets change lengths)
  const L = new Float64Array(count);
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let k = 1; k < count; k++) L[k] = L[k - 1] + a.fromArray(pos, (k - 1) * 3).distanceTo(b.fromArray(pos, k * 3));
  const total = L[count - 1];
  const n2 = Math.max(2, Math.floor(total / spacing) + 1);
  const pos2 = new Float32Array(n2 * 3), up2 = new Float32Array(n2 * 3);
  let j = 0;
  for (let k = 0; k < n2; k++) {
    const s = k * spacing;
    while (j < count - 2 && L[j + 1] < s) j++;
    const seg = L[j + 1] - L[j];
    const t = seg > 1e-9 ? Math.min(1, Math.max(0, (s - L[j]) / seg)) : 0;
    a.fromArray(pos, j * 3); b.fromArray(pos, (j + 1) * 3); a.lerp(b, t).toArray(pos2, k * 3);
    a.fromArray(up, j * 3); b.fromArray(up, (j + 1) * 3); a.lerp(b, t).normalize().toArray(up2, k * 3);
  }
  const si = STYLES.indexOf(style);
  return new Track({
    name, kind, spacing, count: n2, pos: pos2, up: up2,
    halfWidth: new Float32Array(n2).fill(0), groundDrop: new Float32Array(n2),
    floor: new Uint8Array(n2).fill(1), walls: new Uint8Array(n2), style: new Uint8Array(n2).fill(si),
    zone: new Uint8Array(n2), stick: new Uint8Array(n2).fill(1), solid: new Uint8Array(n2), zones: ['rail'],
  });
}
