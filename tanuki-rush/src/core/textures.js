import * as THREE from 'three';

// Procedural canvas textures (no image files). All are generated once at startup.

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function speckle(ctx, w, h, n, colors, seed, size = [1, 3]) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[(r() * colors.length) | 0];
    const s = size[0] + r() * (size[1] - size[0]);
    ctx.fillRect(r() * w, r() * h, s, s);
  }
}

function finish(c, { repeat = true, aniso = 8, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

// Street: u = across full width (0 = left edge), v = along (one tile = TILE_LEN meters).
export const STREET_TILE = 12;
function streetTexture() {
  const W = 512, H = 512;
  const [c, g] = canvas(W, H);
  // asphalt
  g.fillStyle = '#5b5f66'; g.fillRect(0, 0, W, H);
  speckle(g, W, H, 9000, ['#50545b', '#676b72', '#5f636a', '#4a4e55', '#72767c'], 7);
  // sidewalks at both edges (~11% each)
  const sw = Math.round(W * 0.11);
  for (const x0 of [0, W - sw]) {
    g.fillStyle = '#c9c2b4'; g.fillRect(x0, 0, sw, H);
    speckle(g, sw, H, 800, ['#bdb6a8', '#d4cdc0'], 11 + x0, [1, 2]);
    g.save(); g.translate(x0, 0);
    g.strokeStyle = 'rgba(120,112,100,0.55)'; g.lineWidth = 2;
    for (let y = 0; y <= H; y += 42) { g.beginPath(); g.moveTo(0, y); g.lineTo(sw, y); g.stroke(); }
    g.beginPath(); g.moveTo(sw / 2, 0); g.lineTo(sw / 2, H); g.stroke();
    g.restore();
  }
  // curbs
  g.fillStyle = '#e8e4da'; g.fillRect(sw - 6, 0, 6, H); g.fillRect(W - sw, 0, 6, H);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(sw, 0, 4, H); g.fillRect(W - sw - 4, 0, 4, H);
  // centre double yellow
  g.fillStyle = '#f2c230'; g.fillRect(W / 2 - 9, 0, 6, H); g.fillRect(W / 2 + 3, 0, 6, H);
  // lane dashes (white)
  g.fillStyle = '#f4f4f0';
  for (const lx of [sw + (W / 2 - sw) * 0.5, W / 2 + (W / 2 - sw) * 0.5]) {
    g.fillRect(lx - 3, 0, 6, H * 0.45);
  }
  // edge lines
  g.fillRect(sw + 10, 0, 4, H); g.fillRect(W - sw - 14, 0, 4, H);
  // subtle tyre wear
  g.fillStyle = 'rgba(30,30,35,0.10)';
  for (const lx of [0.3, 0.38, 0.62, 0.7]) g.fillRect(W * lx - 10, 0, 20, H);
  return finish(c);
}

export const ROOF_TILE = 10;
function roofTexture() {
  const W = 512, H = 512;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#b9b6ae'; g.fillRect(0, 0, W, H);
  speckle(g, W, H, 7000, ['#aeaba3', '#c4c1b9', '#a5a29a'], 21);
  g.strokeStyle = '#8f8c85'; g.lineWidth = 3;
  for (let y = 0; y <= H; y += 128) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  for (let x = 0; x <= W; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  // painted run-lane arrows (a hint of "course")
  g.fillStyle = 'rgba(255,190,40,0.9)';
  g.beginPath(); g.moveTo(W / 2 - 40, 300); g.lineTo(W / 2, 220); g.lineTo(W / 2 + 40, 300);
  g.lineTo(W / 2 + 22, 300); g.lineTo(W / 2, 262); g.lineTo(W / 2 - 22, 300); g.closePath(); g.fill();
  // edges
  g.fillStyle = '#d8d4ca'; g.fillRect(0, 0, 18, H); g.fillRect(W - 18, 0, 18, H);
  g.fillStyle = '#e34b2f'; g.fillRect(18, 0, 6, H); g.fillRect(W - 24, 0, 6, H);
  return finish(c);
}

export const LOOP_TILE = 8;
function loopTexture() {
  const W = 512, H = 512;
  const [c, g] = canvas(W, H);
  const grd = g.createLinearGradient(0, 0, W, 0);
  grd.addColorStop(0, '#2a67c9'); grd.addColorStop(0.5, '#4a8ff0'); grd.addColorStop(1, '#2a67c9');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  // chevrons pointing forward (+v is forward)
  g.fillStyle = 'rgba(255,255,255,0.85)';
  for (let k = 0; k < 2; k++) {
    const y = 90 + k * 256;
    g.beginPath();
    g.moveTo(W * 0.25, y + 90); g.lineTo(W * 0.5, y); g.lineTo(W * 0.75, y + 90);
    g.lineTo(W * 0.75, y + 140); g.lineTo(W * 0.5, y + 50); g.lineTo(W * 0.25, y + 140);
    g.closePath(); g.fill();
  }
  // hazard edges
  const stripe = 32;
  for (const x0 of [0, W - 40]) {
    for (let y = -stripe; y < H + stripe; y += stripe * 2) {
      g.fillStyle = '#ffd21f'; g.fillRect(x0, y, 40, stripe);
      g.fillStyle = '#1c1c22'; g.fillRect(x0, y + stripe, 40, stripe);
    }
  }
  return finish(c);
}

export const BRIDGE_TILE = 12;
function bridgeTexture() {
  const W = 512, H = 512;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#4e525a'; g.fillRect(0, 0, W, H);
  speckle(g, W, H, 9000, ['#454950', '#5a5e66', '#50545c'], 31);
  g.fillStyle = '#f4f4f0';
  g.fillRect(24, 0, 6, H); g.fillRect(W - 30, 0, 6, H);
  for (const lx of [W / 3, (2 * W) / 3]) g.fillRect(lx - 3, 0, 6, H * 0.4);
  g.fillStyle = '#8c8f96'; g.fillRect(0, 0, 18, H); g.fillRect(W - 18, 0, 18, H);
  return finish(c);
}

export const PIER_TILE = 6;
function pierTexture() {
  const W = 512, H = 512;
  const [c, g] = canvas(W, H);
  const r = rng(41);
  const plank = 32;
  for (let y = 0; y < H; y += plank) {
    const v = 0.85 + r() * 0.25;
    g.fillStyle = `rgb(${(150 * v) | 0},${(104 * v) | 0},${(66 * v) | 0})`;
    g.fillRect(0, y, W, plank - 3);
    g.fillStyle = '#3d2a1c'; g.fillRect(0, y + plank - 3, W, 3);
    g.fillStyle = 'rgba(60,40,25,0.25)';
    for (let k = 0; k < 6; k++) g.fillRect(r() * W, y + r() * plank, 40 + r() * 80, 1);
  }
  return finish(c);
}

export const PLAZA_TILE = 8;
function plazaTexture() {
  const W = 512, H = 512;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#d8cfbf'; g.fillRect(0, 0, W, H);
  const r = rng(51);
  const t = 64;
  for (let y = 0; y < H; y += t) for (let x = 0; x < W; x += t) {
    const k = ((x / t + y / t) % 2) ? '#cbbfa9' : '#e0d7c6';
    g.fillStyle = k; g.fillRect(x + 1, y + 1, t - 2, t - 2);
    if (r() < 0.1) { g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(x + 1, y + 1, t - 2, t - 2); }
  }
  return finish(c);
}

export const RAILING_TILE = 4;
function railingTexture() {
  const W = 256, H = 128;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#e9edf2'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#d23a2e';
  for (let x = 0; x < W; x += 64) g.fillRect(x, 0, 32, H);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, H - 10, W, 10);
  g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillRect(0, 0, W, 6);
  return finish(c);
}

function concreteTexture() {
  const W = 256, H = 256;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#9d9a94'; g.fillRect(0, 0, W, H);
  speckle(g, W, H, 3000, ['#95928c', '#a7a49e', '#8d8a84'], 61);
  return finish(c);
}

let cache = null;
export function getTextures() {
  if (cache) return cache;
  cache = {
    street: streetTexture(),
    roof: roofTexture(),
    loop: loopTexture(),
    bridge: bridgeTexture(),
    pier: pierTexture(),
    plaza: plazaTexture(),
    railing: railingTexture(),
    concrete: concreteTexture(),
  };
  return cache;
}

export function setAnisotropy(max) {
  const t = getTextures();
  for (const k of Object.keys(t)) { t[k].anisotropy = Math.min(max, 8); t[k].needsUpdate = true; }
}
