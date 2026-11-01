import * as THREE from 'three';
import { mergeColored } from '../core/geo.js';

// Geometry / material factories for course objects (all procedural).

function canvasTex(w, h, draw, { repeat = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function leafGeometry(scale = 1) {
  const s = new THREE.Shape();
  s.moveTo(0, -0.5);
  s.bezierCurveTo(0.34, -0.36, 0.42, 0.1, 0, 0.55);
  s.bezierCurveTo(-0.42, 0.1, -0.34, -0.36, 0, -0.5);
  const leaf = new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1, curveSegments: 10 });
  leaf.translate(0, 0, -0.035);
  const g = mergeColored([
    { geo: leaf, color: 0xffc629 },
    { geo: new THREE.BoxGeometry(0.035, 0.85, 0.16), color: 0xd98a0b, pos: [0, 0.02, 0] },
    { geo: new THREE.BoxGeometry(0.05, 0.28, 0.05), color: 0xb86d08, pos: [0, -0.6, 0], rot: [0, 0, 0.3] },
  ]);
  g.scale(scale, scale, scale);
  return g;
}

export function leafMaterial() {
  return new THREE.MeshPhongMaterial({ vertexColors: true, emissive: 0x7a4800, specular: 0xfff2c0, shininess: 70 });
}

export function panelTexture() {
  return canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#1b2a6b'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 2; k++) {
      const y = k * 128;
      const grd = g.createLinearGradient(0, y, 0, y + 128);
      grd.addColorStop(0, '#ffe45c'); grd.addColorStop(1, '#ff8a1f');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(w * 0.12, y + 110); g.lineTo(w * 0.5, y + 30); g.lineTo(w * 0.88, y + 110);
      g.lineTo(w * 0.7, y + 110); g.lineTo(w * 0.5, y + 68); g.lineTo(w * 0.3, y + 110);
      g.closePath(); g.fill();
    }
    g.strokeStyle = '#ffffff'; g.lineWidth = 8; g.strokeRect(4, -10, w - 8, h + 20);
  }, { repeat: true });
}

export function rampGeometry(L, W, H) {
  // wedge: z from -L (ground) to 0 (lip, height H); x in [-W/2, W/2]
  const x0 = -W / 2, x1 = W / 2;
  const P = [
    // top slope
    [x0, 0, -L], [x1, 0, -L], [x1, H, 0], [x0, H, 0],
    // back face (vertical at lip)
    [x0, H, 0], [x1, H, 0], [x1, 0, 0], [x0, 0, 0],
    // left side
    [x0, 0, -L], [x0, H, 0], [x0, 0, 0],
    // right side
    [x1, 0, -L], [x1, 0, 0], [x1, H, 0],
  ];
  const pos = [], uv = [], idx = [];
  P.forEach((p) => pos.push(...p));
  uv.push(0, 0, 1, 0, 1, 1, 0, 1,  0, 0, 1, 0, 1, 0.2, 0, 0.2,  0, 0, 1, 1, 1, 0,  0, 0, 1, 0, 1, 1);
  idx.push(0, 3, 2, 0, 2, 1);           // top (normal up/back)
  idx.push(4, 6, 5, 4, 7, 6);           // back
  idx.push(8, 10, 9);                   // left
  idx.push(11, 13, 12);                 // right
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

export function rampTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#2b73e0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    for (let k = 0; k < 3; k++) {
      const y = 200 - k * 80;
      g.beginPath();
      g.moveTo(w * 0.2, y + 40); g.lineTo(w * 0.5, y); g.lineTo(w * 0.8, y + 40);
      g.lineTo(w * 0.8, y + 58); g.lineTo(w * 0.5, y + 18); g.lineTo(w * 0.2, y + 58);
      g.closePath(); g.fill();
    }
    for (let y = 0; y < h; y += 32) {
      g.fillStyle = '#ffd21f'; g.fillRect(0, y, 18, 16); g.fillRect(w - 18, y, 18, 16);
      g.fillStyle = '#1c1c22'; g.fillRect(0, y + 16, 18, 16); g.fillRect(w - 18, y + 16, 18, 16);
    }
  });
}

export function springGeometry() {
  return mergeColored([
    { geo: new THREE.CylinderGeometry(0.85, 0.95, 0.35, 16), color: 0xd8342c, pos: [0, 0.175, 0] },
    { geo: new THREE.CylinderGeometry(0.5, 0.5, 0.5, 12), color: 0x3a3f47, pos: [0, 0.55, 0] },
    { geo: new THREE.TorusGeometry(0.52, 0.07, 6, 16), color: 0xc7ccd4, pos: [0, 0.45, 0], rot: [Math.PI / 2, 0, 0] },
    { geo: new THREE.TorusGeometry(0.52, 0.07, 6, 16), color: 0xc7ccd4, pos: [0, 0.65, 0], rot: [Math.PI / 2, 0, 0] },
    { geo: new THREE.CylinderGeometry(0.9, 0.9, 0.22, 16), color: 0xffd21f, pos: [0, 0.9, 0] },
  ]);
}

export function droneGeometry() {
  const body = new THREE.SphereGeometry(0.62, 16, 12);
  // two-tone: orange top, pale bottom
  const parts = [
    { geo: body, color: 0xff7a2f },
    { geo: new THREE.SphereGeometry(0.64, 16, 6, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), color: 0xe9e4da },
    { geo: new THREE.CylinderGeometry(0.42, 0.42, 0.22, 16), color: 0x2a2d35, pos: [0, 0.02, 0.5], rot: [Math.PI / 2, 0, 0] },
    { geo: new THREE.BoxGeometry(0.5, 0.12, 0.6), color: 0x5b6270, pos: [0.72, 0, 0], rot: [0, 0, -0.3] },
    { geo: new THREE.BoxGeometry(0.5, 0.12, 0.6), color: 0x5b6270, pos: [-0.72, 0, 0], rot: [0, 0, 0.3] },
    { geo: new THREE.CylinderGeometry(0.05, 0.05, 0.4, 6), color: 0x5b6270, pos: [0, 0.8, 0] },
    { geo: new THREE.ConeGeometry(0.16, 0.3, 6), color: 0x5b6270, pos: [0.25, -0.7, 0.1], rot: [0, 0, 0.4] },
    { geo: new THREE.ConeGeometry(0.16, 0.3, 6), color: 0x5b6270, pos: [-0.25, -0.7, 0.1], rot: [0, 0, -0.4] },
  ];
  return mergeColored(parts);
}

export function droneEyeGeometry() {
  const g = new THREE.SphereGeometry(0.2, 12, 8);
  g.translate(0, 0.02, 0.6);
  return g;
}

export function rotorGeometry() {
  return mergeColored([
    { geo: new THREE.BoxGeometry(1.7, 0.04, 0.16), color: 0x2a2d35 },
    { geo: new THREE.BoxGeometry(0.16, 0.04, 1.7), color: 0x2a2d35 },
    { geo: new THREE.CylinderGeometry(0.12, 0.12, 0.1, 8), color: 0xff7a2f },
  ]);
}

export function carGeometries(kind = 'car') {
  if (kind === 'van') {
    const paint = mergeColored([
      { geo: new THREE.BoxGeometry(2.2, 2.0, 5.2), color: 0xffffff, pos: [0, 1.35, 0] },
    ]);
    const trim = mergeColored([
      { geo: new THREE.BoxGeometry(2.24, 0.8, 1.2), color: 0x27313d, pos: [0, 1.85, 2.1] },
      { geo: new THREE.BoxGeometry(2.26, 0.6, 3.0), color: 0x27313d, pos: [0, 1.9, -0.6] },
      { geo: new THREE.BoxGeometry(2.3, 0.3, 5.3), color: 0x3a3a3f, pos: [0, 0.45, 0] },
      ...wheels(2.3, 1.9),
      { geo: new THREE.BoxGeometry(0.4, 0.2, 0.05), color: 0xfff6c0, pos: [0.7, 1.0, 2.62] },
      { geo: new THREE.BoxGeometry(0.4, 0.2, 0.05), color: 0xfff6c0, pos: [-0.7, 1.0, 2.62] },
    ]);
    return { paint, trim, halfLen: 2.65, halfW: 1.15, height: 2.4 };
  }
  const paint = mergeColored([
    { geo: new THREE.BoxGeometry(2.0, 0.75, 4.4), color: 0xffffff, pos: [0, 0.7, 0] },
    { geo: new THREE.BoxGeometry(1.7, 0.62, 2.3), color: 0xffffff, pos: [0, 1.36, -0.25] },
  ]);
  const trim = mergeColored([
    { geo: new THREE.BoxGeometry(1.74, 0.46, 2.1), color: 0x27313d, pos: [0, 1.38, -0.25] },
    { geo: new THREE.BoxGeometry(1.5, 0.42, 0.1), color: 0x27313d, pos: [0, 1.35, 0.92] },
    { geo: new THREE.BoxGeometry(2.05, 0.25, 4.5), color: 0x3a3a3f, pos: [0, 0.38, 0] },
    ...wheels(1.95, 1.45),
    { geo: new THREE.BoxGeometry(0.4, 0.16, 0.05), color: 0xfff6c0, pos: [0.65, 0.78, 2.21] },
    { geo: new THREE.BoxGeometry(0.4, 0.16, 0.05), color: 0xfff6c0, pos: [-0.65, 0.78, 2.21] },
    { geo: new THREE.BoxGeometry(0.4, 0.16, 0.05), color: 0xd62020, pos: [0.65, 0.8, -2.21] },
    { geo: new THREE.BoxGeometry(0.4, 0.16, 0.05), color: 0xd62020, pos: [-0.65, 0.8, -2.21] },
  ]);
  return { paint, trim, halfLen: 2.2, halfW: 1.0, height: 1.7 };
}

function wheels(w, zOff) {
  const out = [];
  for (const x of [-w / 2, w / 2]) for (const z of [-zOff, zOff]) {
    out.push({ geo: new THREE.CylinderGeometry(0.38, 0.38, 0.28, 10), color: 0x1a1a1d, pos: [x, 0.38, z], rot: [0, 0, Math.PI / 2] });
  }
  return out;
}

export function ringGeometry() {
  return new THREE.TorusGeometry(2.3, 0.26, 10, 40);
}

export function checkpointGeometry(hw) {
  const post = (x) => [
    { geo: new THREE.CylinderGeometry(0.16, 0.2, 3.6, 8), color: 0xf2f2f2, pos: [x, 1.8, 0] },
    { geo: new THREE.CylinderGeometry(0.2, 0.2, 0.5, 8), color: 0x2d7ff9, pos: [x, 1.1, 0] },
    { geo: new THREE.CylinderGeometry(0.2, 0.2, 0.5, 8), color: 0x2d7ff9, pos: [x, 2.3, 0] },
    { geo: new THREE.CylinderGeometry(0.34, 0.26, 0.3, 10), color: 0x555a63, pos: [x, 0.15, 0] },
  ];
  return mergeColored([...post(-hw - 0.4), ...post(hw + 0.4)]);
}

export function goalGeometry(hw) {
  const w = hw + 1.6;
  return mergeColored([
    { geo: new THREE.BoxGeometry(1.3, 13, 1.3), color: 0xf4f1ea, pos: [-w, 6.5, 0] },
    { geo: new THREE.BoxGeometry(1.3, 13, 1.3), color: 0xf4f1ea, pos: [w, 6.5, 0] },
    { geo: new THREE.BoxGeometry(1.6, 0.8, 1.6), color: 0xd8342c, pos: [-w, 0.4, 0] },
    { geo: new THREE.BoxGeometry(1.6, 0.8, 1.6), color: 0xd8342c, pos: [w, 0.4, 0] },
  ]);
}

export function goalBannerTexture(text = 'GOAL') {
  return canvasTex(1024, 128, (g, w, h) => {
    const sq = 32;
    for (let y = 0; y < h; y += sq) for (let x = 0; x < w; x += sq) {
      g.fillStyle = ((x + y) / sq) % 2 ? '#111' : '#fff';
      g.fillRect(x, y, sq, sq);
    }
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(w * 0.3, 10, w * 0.4, h - 20);
    g.fillStyle = '#ffd21f';
    g.font = 'italic 900 86px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 4);
  });
}

export function reticleTexture() {
  return canvasTex(128, 128, (g, w, h) => {
    g.translate(w / 2, h / 2);
    g.strokeStyle = '#ff3b3b'; g.lineWidth = 7;
    g.beginPath(); g.arc(0, 0, 44, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#ffffff'; g.lineWidth = 3;
    g.beginPath(); g.arc(0, 0, 52, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#ff3b3b';
    for (let k = 0; k < 4; k++) {
      g.rotate(Math.PI / 2);
      g.beginPath(); g.moveTo(0, -30); g.lineTo(10, -56); g.lineTo(-10, -56); g.closePath(); g.fill();
    }
  });
}
