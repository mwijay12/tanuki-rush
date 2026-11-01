// Giant magic leaf surfboard (~1.9 m x 0.8 m), tip pointing +Z, with a soft glow and sparkles.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { smoothNormalsCopy } from './geometry.js';

const LEN = 1.9;
const HALF_W = 0.4;
const THICK = 0.028;
const BEVEL = 0.013;
export const BOARD_TOP_LOCAL = THICK + 2 * BEVEL; // top surface height above the board group origin

function leafHalfWidth(t) {
  // t: 0 = base (stem end, -Z) .. 1 = tip (+Z)
  const body = Math.pow(Math.sin(Math.PI * (0.06 + 0.94 * t)), 0.62);
  return HALF_W * body * (1.06 - 0.2 * t);
}

function makeLeafTexture() {
  const W = 256;
  const H = 512;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  // uv mapping: u = 0.5 + x / 0.9, v = (z + 1.1) / 2.2  (canvas y = (1 - v) * H)
  const toU = (x) => (0.5 + x / 0.9) * W;
  const toY = (z) => (1 - (z + 1.1) / 2.2) * H;
  const zOf = (t) => -LEN / 2 + t * LEN;

  // base fill
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#2f8f2a');
  grad.addColorStop(0.3, '#63c43a');
  grad.addColorStop(0.5, '#a6e04c');
  grad.addColorStop(0.7, '#63c43a');
  grad.addColorStop(1, '#2f8f2a');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // golden sheen toward the tip
  const tip = g.createLinearGradient(0, 0, 0, H);
  tip.addColorStop(0, 'rgba(255, 214, 80, 0.55)');
  tip.addColorStop(0.45, 'rgba(255, 214, 80, 0.0)');
  g.fillStyle = tip;
  g.fillRect(0, 0, W, H);

  // leaf outline rim (darker)
  g.beginPath();
  for (let i = 0; i <= 64; i++) {
    const t = i / 64;
    const x = leafHalfWidth(t);
    const px = toU(x);
    const py = toY(zOf(t));
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  for (let i = 64; i >= 0; i--) {
    const t = i / 64;
    g.lineTo(toU(-leafHalfWidth(t)), toY(zOf(t)));
  }
  g.closePath();
  g.lineWidth = 12;
  g.strokeStyle = '#2a7a22';
  g.stroke();

  // veins
  g.lineCap = 'round';
  g.strokeStyle = '#f4f8b8';
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(toU(0), toY(zOf(-0.02)));
  g.lineTo(toU(0), toY(zOf(0.97)));
  g.stroke();
  g.lineWidth = 3.5;
  g.strokeStyle = 'rgba(240, 250, 170, 0.9)';
  for (let k = 0; k < 7; k++) {
    const t0 = 0.1 + k * 0.115;
    const t1 = Math.min(0.98, t0 + 0.2);
    for (const s of [1, -1]) {
      const xEnd = s * leafHalfWidth(t1) * 0.88;
      g.beginPath();
      g.moveTo(toU(0), toY(zOf(t0)));
      g.quadraticCurveTo(toU(xEnd * 0.45), toY(zOf(t0 + 0.07)), toU(xEnd), toY(zOf(t1)));
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeRadialTexture(inner, outer) {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, inner);
  gr.addColorStop(1, outer);
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSparkTexture() {
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(S / 2, 4);
  g.lineTo(S / 2, S - 4);
  g.moveTo(4, S / 2);
  g.lineTo(S - 4, S / 2);
  g.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildLeafGeometry() {
  const shape = new THREE.Shape();
  const n = 48;
  // stem nub at the base, then the right edge to the tip, then the left edge back
  shape.moveTo(-0.035, -LEN / 2 - 0.13);
  shape.lineTo(0.035, -LEN / 2 - 0.13);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    shape.lineTo(Math.max(leafHalfWidth(t), i === 0 ? 0.035 : 0), -LEN / 2 + t * LEN);
  }
  for (let i = n - 1; i >= 0; i--) {
    const t = i / n;
    shape.lineTo(-Math.max(leafHalfWidth(t), i === 0 ? 0.035 : 0), -LEN / 2 + t * LEN);
  }
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: THICK,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelSegments: 2,
    curveSegments: 4,
    steps: 1,
  });
  // shape XY -> board: x = across, z = along (tip +Z), y = up
  g.rotateX(Math.PI / 2);
  g.translate(0, THICK + BEVEL, 0); // bottom at y = 0
  // planar UVs from the top, then curl the edges and the nose
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    const z = pos.getZ(i);
    uv[i * 2] = 0.5 + x / 0.9;
    uv[i * 2 + 1] = (z + 1.1) / 2.2;
    const ax = x / HALF_W;
    y += 0.085 * ax * ax; // curled edges
    const nose = Math.max(0, (z - 0.45) / 0.5);
    y += 0.13 * nose * nose; // upturned tip
    const tail = Math.max(0, (-z - 0.72) / 0.3);
    y += 0.045 * tail * tail;
    x *= 1 - 0.04 * nose;
    pos.setXYZ(i, x, y, z);
  }
  g.deleteAttribute('normal');
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const merged = mergeVertices(g, 1e-4);
  g.dispose();
  merged.computeVertexNormals();
  return merged;
}

export class LeafBoard {
  constructor(gradientMap, outlineMaterial, outlineHook) {
    this.group = new THREE.Object3D();
    this.group.name = 'TanukiLeafBoard';
    this.visual = new THREE.Object3D(); // scaled for the appear/disappear pop
    this.group.add(this.visual);

    this.texture = makeLeafTexture();
    this.geometry = buildLeafGeometry();
    this.material = new THREE.MeshToonMaterial({ map: this.texture, gradientMap });
    this.material.name = 'TanukiLeafBoard';
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.castShadow = true;
    this.outlineGeometry = smoothNormalsCopy(this.geometry);
    this.outline = new THREE.Mesh(this.outlineGeometry, outlineMaterial);
    this.outline.onBeforeRender = outlineHook;
    this.visual.add(this.mesh, this.outline);

    // glow under the board
    this.glowTexture = makeRadialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    this.glowMaterial = new THREE.MeshBasicMaterial({
      map: this.glowTexture,
      color: 0xb6ff6a,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.glowGeometry = new THREE.PlaneGeometry(1.5, 2.6);
    this.glowGeometry.rotateX(-Math.PI / 2);
    this.glow = new THREE.Mesh(this.glowGeometry, this.glowMaterial);
    this.glow.renderOrder = 1;
    this.glow.frustumCulled = false;
    this.group.add(this.glow);

    // sparkles
    this.count = 26;
    this.sparkPos = new Float32Array(this.count * 3);
    this.sparkCol = new Float32Array(this.count * 3);
    this.sparkLife = new Float32Array(this.count);
    this.sparkMax = new Float32Array(this.count);
    this.sparkVel = new Float32Array(this.count * 3);
    const sg = new THREE.BufferGeometry();
    this.sparkPosAttr = new THREE.BufferAttribute(this.sparkPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.sparkColAttr = new THREE.BufferAttribute(this.sparkCol, 3).setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('position', this.sparkPosAttr);
    sg.setAttribute('color', this.sparkColAttr);
    sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 5);
    this.sparkGeometry = sg;
    this.sparkTexture = makeSparkTexture();
    this.sparkMaterial = new THREE.PointsMaterial({
      size: 0.13,
      map: this.sparkTexture,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      toneMapped: false,
    });
    this.sparks = new THREE.Points(sg, this.sparkMaterial);
    this.sparks.frustumCulled = false;
    this.sparks.renderOrder = 2;
    this.group.add(this.sparks);
    for (let i = 0; i < this.count; i++) this._respawn(i, Math.random());

    this.show = 0; // 0..1 appear animation
    this.target = 0;
    this.group.visible = false;
  }

  _respawn(i, age = 0) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const t = Math.random();
    const z = -LEN / 2 + t * LEN;
    const x = side * leafHalfWidth(t) * (0.6 + 0.5 * Math.random());
    this.sparkPos[i * 3] = x;
    this.sparkPos[i * 3 + 1] = 0.02 + Math.random() * 0.1;
    this.sparkPos[i * 3 + 2] = z;
    this.sparkVel[i * 3] = side * (0.1 + Math.random() * 0.25);
    this.sparkVel[i * 3 + 1] = 0.15 + Math.random() * 0.4;
    this.sparkVel[i * 3 + 2] = -0.5 - Math.random() * 1.0;
    this.sparkMax[i] = 0.45 + Math.random() * 0.5;
    this.sparkLife[i] = age * this.sparkMax[i];
  }

  setActive(on) {
    this.target = on ? 1 : 0;
    if (on) this.group.visible = true;
  }

  /** hoverY: board group height above root; returns nothing. */
  update(dt, t, speed, boost) {
    const rate = this.target > this.show ? 9 : 14;
    this.show += (this.target - this.show) * (1 - Math.exp(-dt * rate));
    if (this.target === 0 && this.show < 0.02) {
      this.show = 0;
      this.group.visible = false;
      return;
    }
    // overshooting pop on appear
    const s = this.show;
    const pop = s + Math.sin(s * Math.PI) * 0.18 * this.target;
    this.visual.scale.setScalar(Math.max(0.001, pop));
    this.glowMaterial.opacity = (0.45 + 0.15 * Math.sin(t * 6) + 0.25 * boost) * s;

    const drift = 1 + speed * 0.08;
    for (let i = 0; i < this.count; i++) {
      let life = this.sparkLife[i] + dt;
      if (life >= this.sparkMax[i]) {
        this._respawn(i, 0);
        life = 0;
      }
      this.sparkLife[i] = life;
      const k = i * 3;
      this.sparkPos[k] += this.sparkVel[k] * dt;
      this.sparkPos[k + 1] += this.sparkVel[k + 1] * dt;
      this.sparkPos[k + 2] += this.sparkVel[k + 2] * dt * drift;
      const a = life / this.sparkMax[i];
      const fade = Math.sin(Math.min(1, a) * Math.PI) * s * (0.8 + 0.4 * boost);
      this.sparkCol[k] = 1.0 * fade;
      this.sparkCol[k + 1] = 0.95 * fade;
      this.sparkCol[k + 2] = 0.55 * fade;
    }
    this.sparkPosAttr.needsUpdate = true;
    this.sparkColAttr.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.outlineGeometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.glowGeometry.dispose();
    this.glowMaterial.dispose();
    this.glowTexture.dispose();
    this.sparkGeometry.dispose();
    this.sparkMaterial.dispose();
    this.sparkTexture.dispose();
  }
}
