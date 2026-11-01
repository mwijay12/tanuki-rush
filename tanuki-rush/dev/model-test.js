// Standalone preview page for the TANUKI RUSH hero model.
// Open http://localhost:5173/dev/model-test.html (Vite dev server).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TanukiModel, TANUKI_STATES } from '../src/player/TanukiModel.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// match the game's renderer defaults (ACES, exposure 1.05); switchable in the UI
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd0ff);
scene.fog = new THREE.Fog(0x8fd0ff, 40, 140);

const hemi = new THREE.HemisphereLight(0xd6ecff, 0x9a8a70, 1.35);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d6, 2.4);
sun.position.set(3.5, 7, 4.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -4;
sun.shadow.camera.right = 4;
sun.shadow.camera.top = 4;
sun.shadow.camera.bottom = -4;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 20;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(sun.target);

// ground with a scrolling grid texture
function makeGridTexture() {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#a3a6aa';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = '#8b8e93';
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    const p = (i / 4) * S;
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, S);
    g.moveTo(0, p);
    g.lineTo(S, p);
    g.stroke();
  }
  g.strokeStyle = '#6f7277';
  g.lineWidth = 5;
  g.strokeRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
const TILE = 4; // metres per texture repeat
const gridTex = makeGridTexture();
gridTex.repeat.set(200 / TILE, 200 / TILE);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshLambertMaterial({ map: gridTex }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// road edge posts that scroll by for speed reference
const posts = [];
{
  const geo = new THREE.BoxGeometry(0.25, 1.2, 0.25);
  const matA = new THREE.MeshLambertMaterial({ color: 0xff7a3d });
  const matB = new THREE.MeshLambertMaterial({ color: 0xffffff });
  for (let i = 0; i < 24; i++) {
    for (const x of [-9, 9]) {
      const p = new THREE.Mesh(geo, i % 2 ? matA : matB);
      p.position.set(x, 0.6, -20 + i * 5);
      p.castShadow = true;
      scene.add(p);
      posts.push(p);
    }
  }
}

// height reference (1.3 m)
const refPole = new THREE.Mesh(
  new THREE.CylinderGeometry(0.02, 0.02, 1.3, 8),
  new THREE.MeshBasicMaterial({ color: 0xff3366 }),
);
refPole.position.set(0.9, 0.65, 0);
refPole.visible = false;
scene.add(refPole);

// ---------------------------------------------------------------------------
const model = new TanukiModel();
scene.add(model.root);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.05, 400);
camera.position.set(2.2, 1.4, 3.4);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.68, 0);
controls.enableDamping = true;
controls.update();

// ---------------------------------------------------------------------------
// UI
const $ = (id) => document.getElementById(id);
const statesEl = $('states');
const stateButtons = {};
for (const s of TANUKI_STATES) {
  const b = document.createElement('button');
  b.textContent = s;
  b.onclick = () => setState(s);
  statesEl.appendChild(b);
  stateButtons[s] = b;
}
const params = { speed: 0, steer: 0, boost: false, airborne: false, timeScale: 1 };
function setState(s) {
  model.setState(s);
  for (const k of Object.keys(stateButtons)) stateButtons[k].classList.toggle('on', k === model.state);
}
setState('idle');

const bindRange = (id, key, fmt = (v) => v.toFixed(2)) => {
  const el = $(id);
  const out = $(id + 'V');
  const apply = () => {
    params[key] = parseFloat(el.value);
    if (out) out.textContent = fmt(params[key]);
  };
  el.addEventListener('input', apply);
  apply();
  return el;
};
bindRange('speed', 'speed', (v) => v.toFixed(1));
bindRange('steer', 'steer');
bindRange('tscale', 'timeScale');
$('steer').addEventListener('dblclick', (e) => {
  e.target.value = 0;
  e.target.dispatchEvent(new Event('input'));
});
$('boost').addEventListener('change', (e) => (params.boost = e.target.checked));
$('airborne').addEventListener('change', (e) => (params.airborne = e.target.checked));
$('tonemap').addEventListener('change', (e) => {
  const v = e.target.value;
  renderer.toneMapping = v === 'aces' ? THREE.ACESFilmicToneMapping : v === 'agx' ? THREE.AgXToneMapping : THREE.NoToneMapping;
  renderer.toneMappingExposure = v === 'none' ? 1 : 1.05;
});

let chase = false;
const saved = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 40 };
function setChase(on) {
  chase = on;
  $('chase').checked = on;
  if (on) {
    saved.pos.copy(camera.position);
    saved.target.copy(controls.target);
    saved.fov = camera.fov;
    camera.fov = 80;
    controls.enabled = false;
  } else {
    camera.fov = saved.fov;
    camera.position.copy(saved.pos);
    controls.target.copy(saved.target);
    controls.enabled = true;
  }
  camera.updateProjectionMatrix();
}
$('chase').addEventListener('change', (e) => setChase(e.target.checked));

const VIEWS = {
  front: { pos: [0, 0.85, 3.3], target: [0, 0.68, 0] },
  three: { pos: [2.2, 1.35, 2.6], target: [0, 0.68, 0] },
  side: { pos: [3.4, 0.85, 0], target: [0, 0.68, 0] },
  back: { pos: [0.4, 1.2, -3.3], target: [0, 0.68, 0] },
  face: { pos: [0.35, 1.05, 1.45], target: [0, 0.93, 0] },
};
function setView(name, fov = 40) {
  const v = VIEWS[name];
  if (!v) return;
  if (chase) setChase(false);
  camera.fov = fov;
  camera.updateProjectionMatrix();
  camera.position.fromArray(v.pos);
  controls.target.fromArray(v.target);
  controls.update();
}
for (const b of document.querySelectorAll('.views button')) b.onclick = () => setView(b.dataset.view);

// ---------------------------------------------------------------------------
const timer = new THREE.Timer();
timer.connect(document);
let paused = false;
$('pause').addEventListener('change', (e) => (paused = e.target.checked));
let turn = 0;
let fpsAcc = 0;
let fpsFrames = 0;
let fps = 0;
let updAcc = 0;
let updMs = 0;
const statsEl = $('stats');

const MOVING_STATES = new Set(['run', 'ball', 'board', 'grind']);
const scrollEl = $('scroll');
const turntableEl = $('turntable');

function step(dt) {
  const t0 = performance.now();
  model.update(dt, params);
  updAcc += performance.now() - t0;

  const moving = MOVING_STATES.has(model.state) && scrollEl.checked;
  if (moving) {
    const d = params.speed * dt;
    gridTex.offset.y += d / TILE;
    gridTex.offset.y %= 1;
    for (const p of posts) {
      p.position.z -= d;
      if (p.position.z < -20) p.position.z += 120;
    }
  }
  if (turntableEl.checked) {
    turn += dt * 0.6;
    model.root.rotation.y = turn;
  } else {
    model.root.rotation.y = 0;
  }
}

function render() {
  if (chase) {
    const r = model.root.position;
    camera.position.set(r.x, r.y + 2.0, r.z - 5.5);
    camera.lookAt(r.x, r.y + 1.0, r.z + 4);
  } else {
    controls.update();
  }
  renderer.render(scene, camera);
}

function frame() {
  requestAnimationFrame(frame);
  timer.update();
  const raw = Math.min(timer.getDelta(), 0.1);
  const dt = paused ? 0 : raw * params.timeScale;
  step(dt);
  render();
  fpsAcc += raw;
  fpsFrames++;
  if (fpsAcc > 0.5) {
    fps = fpsFrames / fpsAcc;
    updMs = updAcc / fpsFrames;
    fpsAcc = 0;
    fpsFrames = 0;
    updAcc = 0;
    const info = renderer.info.render;
    let modelCalls = 0;
    model.root.traverseVisible((o) => {
      if (o.isMesh || o.isPoints) modelCalls++;
    });
    statsEl.textContent =
      `state   ${model.state}\n` +
      `fps     ${fps.toFixed(0)}\n` +
      `update  ${updMs.toFixed(3)} ms\n` +
      `model   ${modelCalls} draw calls\n` +
      `scene   ${info.calls} calls (incl. shadows)\n` +
      `tris    ${info.triangles}`;
  }
}
frame();

// keyboard: 1..9,0,- = states, C = chase cam, B = boost, space = pause
window.addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'range') return;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-'];
  const i = keys.indexOf(e.key);
  if (i >= 0 && i < TANUKI_STATES.length) setState(TANUKI_STATES[i]);
  else if (e.key === 'c' || e.key === 'C') setChase(!chase);
  else if (e.key === 'b' || e.key === 'B') {
    params.boost = !params.boost;
    $('boost').checked = params.boost;
  } else if (e.key === ' ') {
    paused = !paused;
    $('pause').checked = paused;
    e.preventDefault();
  }
});
$('pole').addEventListener('change', (e) => (refPole.visible = e.target.checked));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// hooks for automated checks
window.__tanuki = {
  THREE,
  model,
  scene,
  camera,
  controls,
  renderer,
  params,
  setState,
  setView,
  setChase,
  refPole,
  step: (dt, n = 1) => {
    for (let i = 0; i < n; i++) step(dt);
    render();
  },
  pause: (on) => {
    paused = on;
    $('pause').checked = on;
  },
  hideUI: (on) => {
    $('ui').style.display = on ? 'none' : '';
  },
  /** Free camera: position, target, fov (disables the chase cam). */
  cam: (px, py, pz, tx, ty, tz, fov = 40) => {
    if (chase) setChase(false);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.position.set(px, py, pz);
    controls.target.set(tx, ty, tz);
    controls.update();
  },
  /** Sets the UI params (speed/steer/boost/airborne) and keeps the sliders in sync. */
  set: (o) => {
    Object.assign(params, o);
    if (o.speed !== undefined) {
      $('speed').value = o.speed;
      $('speedV').textContent = Number(o.speed).toFixed(1);
    }
    if (o.steer !== undefined) {
      $('steer').value = o.steer;
      $('steerV').textContent = Number(o.steer).toFixed(2);
    }
    if (o.boost !== undefined) $('boost').checked = !!o.boost;
    if (o.airborne !== undefined) $('airborne').checked = !!o.airborne;
  },
};
