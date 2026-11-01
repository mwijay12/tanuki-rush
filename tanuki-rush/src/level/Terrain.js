import * as THREE from 'three';

// Heightfield terrain derived from the course: the city sits on a ridge that
// follows the course and falls away to the sea. Ground under elevated / solid
// sections is lowered by the sample's groundDrop.

export class GroundRefs {
  constructor(main, { step = 6 } = {}) {
    const pts = [];
    const n = main.count;
    const stride = Math.max(1, Math.round(step / main.spacing));
    for (let i = 0; i < n; i += stride) {
      const uy = main.up[i * 3 + 1];
      if (uy < 0.8) continue;
      const x = main.pos[i * 3], y = main.pos[i * 3 + 1], z = main.pos[i * 3 + 2];
      const g = y - main.groundDrop[i] - 0.4;
      pts.push({ x, z, y, g, hw: main.halfWidth[i], i, solid: main.solid[i] });
    }
    this.pts = pts;
    this.cell = 80;
    this.grid = new Map();
    for (const p of pts) {
      const k = this._key(Math.floor(p.x / this.cell), Math.floor(p.z / this.cell));
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(p);
    }
  }
  _key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }

  /** Visit reference points within radius r of (x, z). */
  near(x, z, r, fn) {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    const r2 = r * r;
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const a = this.grid.get(this._key(cx, cz));
      if (!a) continue;
      for (const p of a) {
        const dx = p.x - x, dz = p.z - z;
        const d2 = dx * dx + dz * dz;
        if (d2 <= r2) fn(p, d2);
      }
    }
  }

  nearest(x, z, r = 400) {
    let best = null, bd = Infinity;
    this.near(x, z, r, (p, d2) => { if (d2 < bd) { bd = d2; best = p; } });
    return best ? { p: best, d: Math.sqrt(bd) } : null;
  }
}

let lastDist = Infinity;
export function terrainHeight(refs, x, z) {
  let sw = 0, sh = 0, dmin = Infinity, gmin = 0, hwNear = 8;
  lastDist = Infinity;
  refs.near(x, z, 520, (p, d2) => {
    const w = 1 / (d2 + 900);
    sw += w; sh += w * p.g;
    if (d2 < dmin) { dmin = d2; gmin = p.g; hwNear = p.hw; }
  });
  if (sw === 0) return -40;
  dmin = Math.sqrt(dmin);
  lastDist = dmin;
  let h = sh / sw;
  // ridge falls away from the course toward the sea
  h = h - Math.max(0, dmin - 140) * 0.22;
  h = THREE.MathUtils.lerp(h, -40, THREE.MathUtils.smoothstep(dmin, 260, 520));
  // never above the course next to it
  const clear = hwNear + 14;
  if (dmin < clear + 40) {
    const lim = gmin - (dmin < clear ? 4.5 : THREE.MathUtils.lerp(4.5, 0, (dmin - clear) / 40));
    h = Math.min(h, lim);
  }
  return h;
}

export function buildTerrain(main, refs) {
  const b = main.bounds;
  const margin = 700;
  const minX = b.min.x - margin, maxX = b.max.x + margin;
  const minZ = b.min.z - margin, maxZ = b.max.z + margin;
  const res = 24;
  const nx = Math.ceil((maxX - minX) / res) + 1;
  const nz = Math.ceil((maxZ - minZ) / res) + 1;
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const heights = new Float32Array(nx * nz);
  const grass = new THREE.Color(0x7fae55), dry = new THREE.Color(0xb9a77a), sand = new THREE.Color(0xe3d3a3), rock = new THREE.Color(0x8c8a80), city = new THREE.Color(0xa7a197);
  const c = new THREE.Color();
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = minX + i * res, z = minZ + j * res;
      let h = terrainHeight(refs, x, z);
      const dCourse = lastDist;
      // gentle noise
      h += (Math.sin(x * 0.013) * Math.cos(z * 0.011) + Math.sin(x * 0.041 + z * 0.037) * 0.4) * 2.5;
      const k = j * nx + i;
      heights[k] = h;
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      // colour: paved city near the course, parks / hills further out, beaches at the water line
      c.copy(grass).lerp(dry, THREE.MathUtils.clamp((h - 150) / 400, 0, 0.6));
      const urban = 1 - THREE.MathUtils.smoothstep(dCourse, 180, 420);
      const park = (Math.sin(x * 0.011 + 1.3) * Math.sin(z * 0.009 + 0.4)) > 0.55 ? 0.6 : 0;
      c.lerp(city, urban * (1 - park));
      if (h < 1.5) c.copy(sand);
      const n = (Math.sin(x * 0.07) * Math.sin(z * 0.05)) * 0.06;
      col[k * 3] = c.r + n; col[k * 3 + 1] = c.g + n; col[k * 3 + 2] = c.b + n;
    }
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b2 = a + 1, c2 = a + nx, d = c2 + 1;
    idx.push(a, c2, b2, b2, c2, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  const field = {
    minX, minZ, res, nx, nz, heights,
    height(x, z) {
      const fx = (x - minX) / res, fz = (z - minZ) / res;
      const i = Math.floor(fx), j = Math.floor(fz);
      if (i < 0 || j < 0 || i >= nx - 1 || j >= nz - 1) return -40;
      const tx = fx - i, tz = fz - j;
      const h00 = heights[j * nx + i], h10 = heights[j * nx + i + 1], h01 = heights[(j + 1) * nx + i], h11 = heights[(j + 1) * nx + i + 1];
      // match triangle split (a, c2, b2) / (b2, c2, d)
      if (tx + tz <= 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
      return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
    },
  };
  return { mesh, field };
}
