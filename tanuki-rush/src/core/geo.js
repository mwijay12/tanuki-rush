import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Merge primitive parts into one geometry with a per-vertex color attribute.
 * parts: [{ geo, color, pos?:[x,y,z], rot?:[x,y,z], scale?:[x,y,z] }]
 */
export function mergeColored(parts) {
  const geos = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (const part of parts) {
    let g = part.geo.index ? part.geo.toNonIndexed() : part.geo.clone();
    g.deleteAttribute('uv');
    e.set(...(part.rot || [0, 0, 0]));
    q.setFromEuler(e);
    s.set(...(part.scale || [1, 1, 1]));
    p.set(...(part.pos || [0, 0, 0]));
    m.compose(p, q, s);
    g.applyMatrix4(m);
    const c = new THREE.Color(part.color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(g);
  }
  const out = mergeGeometries(geos, false);
  out.computeBoundingSphere();
  return out;
}

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Spatial hash of track samples for fast "is anything of the course near here?" queries. */
export class TrackHash {
  constructor(tracks, { step = 2, cell = 24 } = {}) {
    this.cell = cell;
    this.map = new Map();
    for (const t of tracks) {
      const stride = Math.max(1, Math.round(step / t.spacing));
      for (let i = 0; i < t.count; i += stride) {
        const x = t.pos[i * 3], y = t.pos[i * 3 + 1], z = t.pos[i * 3 + 2];
        const e = { x, y, z, hw: Math.max(1.2, t.halfWidth[i]), up: t.up[i * 3 + 1], track: t, i };
        const k = this._key(Math.floor(x / cell), Math.floor(z / cell));
        let a = this.map.get(k);
        if (!a) { a = []; this.map.set(k, a); }
        a.push(e);
      }
    }
  }
  _key(cx, cz) { return (cx * 73856093) ^ (cz * 19349663); }
  /** Returns true if any course sample is horizontally within (hw + pad) of (x,z) and vertically within [yLo, yHi]. */
  blocked(x, z, yLo, yHi, pad = 1) {
    const c = this.cell;
    const r = 30;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const a = this.map.get(this._key(cx, cz));
      if (!a) continue;
      for (const e of a) {
        if (e.y < yLo - 3 || e.y > yHi + 6) continue;
        const dx = e.x - x, dz = e.z - z;
        const lim = e.hw + pad;
        if (dx * dx + dz * dz < lim * lim) return true;
      }
    }
    return false;
  }
  minDist(x, z, r = 60) {
    const c = this.cell;
    let best = Infinity;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const a = this.map.get(this._key(cx, cz));
      if (!a) continue;
      for (const e of a) {
        const dx = e.x - x, dz = e.z - z;
        const d = Math.sqrt(dx * dx + dz * dz) - e.hw;
        if (d < best) best = d;
      }
    }
    return best;
  }
}
