// Hachimaki ribbon tails: two cloth strips rebuilt every frame on the CPU (no allocation).
// Positions are computed in the model root's space so the flow direction is independent of
// the body lean: they hang at rest and stream back (fanning out in a V) with speed.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export class HachimakiRibbons {
  constructor(material, { segments = 24, width = 0.092, lengths = [0.5, 0.44] } = {}) {
    this.N = segments;
    this.width = width;
    this.lengths = lengths;
    const strips = 2;
    const vps = (segments + 1) * 2;
    this.vps = vps;
    const count = vps * strips;
    this.pos = new Float32Array(count * 3);
    this.nrm = new Float32Array(count * 3);
    const idx = [];
    for (let s = 0; s < strips; s++) {
      const o = s * vps;
      for (let i = 0; i < segments; i++) {
        const a = o + i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3);
    this.nrmAttr = new THREE.BufferAttribute(this.nrm, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.nrmAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('normal', this.nrmAttr);
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 4);
    this.geometry = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.name = 'HachimakiRibbons';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;

    // scratch
    this._pts = new Float32Array((segments + 1) * 3);
    this._dir = new THREE.Vector3();
    this._hang = new THREE.Vector3();
    this._stream = new THREE.Vector3();
    this._curve = new THREE.Vector3();
    this._w0 = new THREE.Vector3();
    this._n0 = new THREE.Vector3();
    this._T = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._nb = new THREE.Vector3();
    this._nn = new THREE.Vector3();
    this._P = new THREE.Vector3();
    this._wave = 0;
  }

  /**
   * @param {number} dt     frame time (s)
   * @param {THREE.Vector3[]} anchors  [left, right] knot points (root space)
   * @param {object} o      { speed, lift, steer, boost }
   */
  update(dt, anchors, o) {
    const speed = Math.max(0, o.speed);
    // how straight the ribbons stream (fast response: ~76% at 10 m/s) ...
    const flow = 1 - Math.exp(-speed / 7);
    // ... and how long / energetic they get (keeps growing up to top speed)
    const energy = smooth(0, 40, speed);
    const lift = o.lift;
    // travelling-wave phase is integrated (never omega*time) so speed changes don't make it jump
    const omega = 4 + 10 * flow + 14 * energy + 6 * o.boost;
    this._wave = (this._wave + omega * dt) % 6283.185307179586;
    for (let j = 0; j < 2; j++) this._strip(j, this._wave, anchors[j], flow, energy, lift, o.steer, o.boost);
    this.posAttr.needsUpdate = true;
    this.nrmAttr.needsUpdate = true;
  }

  _strip(j, wt, A, s01, energy, lift, steer, boost) {
    const N = this.N;
    const sx = j === 0 ? 1 : -1;
    const L = this.lengths[j] * (1 + 0.3 * s01 + 0.6 * energy + 0.15 * boost);
    const ph = j * 1.9;

    // base flow direction: hang (low speed) -> stream back in a V (high speed)
    const hang = this._hang.set(sx * 0.42, -1.0, -0.3).normalize();
    const stream = this._stream.set(sx * 0.5, 0.26, -1.0).normalize();
    const dir = this._dir.copy(hang).lerp(stream, s01);
    dir.y += lift * 0.9;
    if (lift < 0) dir.z *= 1 + lift * 0.6; // straight down when launched upward
    const dl = dir.length();
    if (dl < 1e-5) dir.set(0, -1, 0);
    else dir.multiplyScalar(1 / dl);

    // curvature: gravity sag at low speed, centrifugal drift when steering
    const curve = this._curve.set(steer * 0.35 * (0.3 + s01), -0.55 * (1 - s01) * (1 - Math.abs(lift)), 0.12 * (1 - s01));

    // ribbon frame
    const w0 = this._w0.crossVectors(dir, UP);
    if (w0.lengthSq() < 1e-6) w0.set(1, 0, 0);
    else w0.normalize();
    const n0 = this._n0.crossVectors(w0, dir).normalize();

    const lambda = 0.55 - 0.12 * s01 - 0.1 * energy;
    const k = (Math.PI * 2) / lambda;
    const amp = (0.035 + 0.03 * s01 + 0.04 * energy + 0.02 * boost) * (0.6 + 0.4 * L);
    const pts = this._pts;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const d = u * L;
      const env = Math.pow(u, 1.25);
      const wave = Math.sin(k * d - wt + ph) * amp * env;
      const wave2 = Math.sin(k * 0.62 * d - wt * 0.73 + 1.7 + ph) * amp * 0.45 * env;
      const P = this._P.copy(A).addScaledVector(dir, d).addScaledVector(curve, d * d);
      P.addScaledVector(n0, wave).addScaledVector(w0, wave2);
      pts[i * 3] = P.x;
      pts[i * 3 + 1] = P.y;
      pts[i * 3 + 2] = P.z;
    }

    const pos = this.pos;
    const nrm = this.nrm;
    const base = j * this.vps * 3;
    const T = this._T;
    const b = this._b;
    const nb = this._nb;
    const nn = this._nn;
    const twistAmp = 0.45 + 0.55 * s01;
    for (let i = 0; i <= N; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(N, i + 1);
      T.set(pts[i1 * 3] - pts[i0 * 3], pts[i1 * 3 + 1] - pts[i0 * 3 + 1], pts[i1 * 3 + 2] - pts[i0 * 3 + 2]);
      const tl = T.length();
      if (tl < 1e-6) T.copy(dir);
      else T.multiplyScalar(1 / tl);
      // width axis: w0 made perpendicular to the tangent, then twisted around it
      b.copy(w0).addScaledVector(T, -w0.dot(T));
      const bl = b.length();
      if (bl < 1e-5) b.copy(n0);
      else b.multiplyScalar(1 / bl);
      nb.crossVectors(T, b);
      const u = i / N;
      const tw = twistAmp * u * Math.sin(k * 0.5 * u * L - wt * 0.8 + ph + 0.8);
      const ct = Math.cos(tw);
      const st = Math.sin(tw);
      // b' = b cos + nb sin
      const bx = b.x * ct + nb.x * st;
      const by = b.y * ct + nb.y * st;
      const bz = b.z * ct + nb.z * st;
      const hw = this.width * 0.5 * (1 - 0.3 * u);
      const px = pts[i * 3];
      const py = pts[i * 3 + 1];
      const pz = pts[i * 3 + 2];
      const o = base + i * 6;
      pos[o] = px + bx * hw;
      pos[o + 1] = py + by * hw;
      pos[o + 2] = pz + bz * hw;
      pos[o + 3] = px - bx * hw;
      pos[o + 4] = py - by * hw;
      pos[o + 5] = pz - bz * hw;
      // face normal consistent with triangle winding: T x b'
      nn.set(T.y * bz - T.z * by, T.z * bx - T.x * bz, T.x * by - T.y * bx);
      const nl = nn.length();
      if (nl < 1e-6) nn.copy(n0);
      else nn.multiplyScalar(1 / nl);
      nrm[o] = nn.x;
      nrm[o + 1] = nn.y;
      nrm[o + 2] = nn.z;
      nrm[o + 3] = nn.x;
      nrm[o + 4] = nn.y;
      nrm[o + 5] = nn.z;
    }
  }

  dispose() {
    this.geometry.dispose();
  }
}
