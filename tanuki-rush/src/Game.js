import * as THREE from 'three';
import { Renderer } from './core/Renderer.js';
import { Events, clamp, smoothstep, damp } from './core/Events.js';
import { Input } from './input/Input.js';
import { buildTrackMesh, buildRailMesh } from './track/TrackMesh.js';
import { makeFrame } from './track/Track.js';
import { Sky } from './level/Sky.js';
import { Ocean } from './level/Ocean.js';
import { buildLevel } from './level/cityLevel.js';
import { Player } from './player/Player.js';
import { PlaceholderModel } from './player/PlaceholderModel.js';
import { CameraRig } from './camera/CameraRig.js';
import { GroundRefs, buildTerrain } from './level/Terrain.js';
import { buildCityDecor } from './level/CityDecor.js';
import { buildLandmarks } from './level/Landmarks.js';
import { TrackHash } from './core/geo.js';
import { Particles } from './fx/Particles.js';
import { PostFX } from './fx/PostFX.js';
import { Objects } from './objects/Objects.js';
import { Truck } from './objects/Truck.js';
import { HUD, formatTime } from './ui/HUD.js';
import { setAnisotropy } from './core/textures.js';
import { Bot } from './core/Bot.js';

// Optional modules (written separately); glob import tolerates their absence.
const modelModules = import.meta.glob('./player/TanukiModel.js');
const audioModules = import.meta.glob('./audio/AudioEngine.js');

const SUN_DIR = new THREE.Vector3(-0.45, 0.72, 0.52).normalize();
const SECTION_NAMES = {
  board: 'HILLTOP DESCENT',
  city: 'SLOPE STREET',
  roof: 'ROOFTOP RUN',
  chase: 'RUNAWAY TRUCK',
  bay: 'BAYSIDE HIGHWAY',
};
const QUALITY = {
  low: { pixelRatio: 0.75, samples: 0, far: 0.6 },
  mid: { pixelRatio: 1.0, samples: 2, far: 0.8 },
  high: { pixelRatio: 1.5, samples: 4, far: 1.0 },
};
const STORE_KEY = 'tanuki-rush-v1';
const noop = () => {};
const NULL_AUDIO = new Proxy({}, { get: () => noop });
const Z_AXIS = new THREE.Vector3(0, 0, 1);

export class Game {
  constructor(container) {
    container.style.cssText = 'position:fixed;inset:0;overflow:hidden;background:#000;';
    this.container = container;
    this.params = new URLSearchParams(location.search);
    this.save = this._loadSave();
    const touchDevice = matchMedia('(pointer: coarse)').matches;
    this.quality = this.params.get('q') || this.save.quality || (touchDevice ? 'mid' : 'high');

    this.R = new Renderer(container);
    this.scene = this.R.scene;
    this.camera = this.R.camera;
    this.events = new Events();
    this.input = new Input();
    this.hud = new HUD(this.input);
    this.audio = NULL_AUDIO;
    this.muted = !!this.save.muted;
    this.fxScale = this.save.softFx ? 0.4 : 1;

    this._setupEnvironment();
    this.level = buildLevel();
    this._buildWorld();

    this.fx = new Particles(2600);
    this.scene.add(this.fx.points);
    this.player = new Player(this.level, this.events);
    this.model = new PlaceholderModel();
    this.scene.add(this.model.root);
    this._shadow = this._makeBlobShadow();
    this.rig = new CameraRig(this.camera, this.level.main);
    this.rig.hints = this.level.cameraHints || [];
    this.rig.shakeScale = this.fxScale < 1 ? 0.5 : 1;
    this.objects = new Objects(this.scene, this.level, this.events, this.fx);
    this.truck = new Truck(this.scene, this.level, this.events, this.fx, this.objects);

    this.post = new PostFX(this.R.renderer, { samples: QUALITY[this.quality]?.samples ?? 4 });
    this.R.onResize.push((w, h) => {
      this.post.setSize(w, h);
      this.fx.setViewportHeight(h);
      const aspect = w / Math.max(1, h);
      this.rig.fovScale = aspect < 1 ? 1 + Math.min(0.45, (1 - aspect) * 0.8) : 1;
    });
    this.applyQuality(this.quality);
    setAnisotropy(this.R.renderer.capabilities.getMaxAnisotropy());

    this._wireEvents();
    this.state = 'boot';
    this.time = 0;
    this.runTime = 0;
    this.deaths = 0;
    this.enemiesDown = 0;
    this.last = performance.now();
    this.F = makeFrame();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._q = new THREE.Quaternion();

    this._loadOptional();
    this.debug = this.params.has('debug');
    this.bot = this.params.has('bot') ? new Bot(this) : null;
  }

  // ======================================================================= setup
  _loadSave() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
  }
  _writeSave() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.save)); } catch { /* storage unavailable */ }
  }

  _loadOptional() {
    const jobs = [];
    const ml = modelModules['./player/TanukiModel.js'];
    if (ml) jobs.push(ml().then((m) => {
      try {
        const model = new m.TanukiModel();
        this.scene.remove(this.model.root);
        this.model.dispose?.();
        this.model = model;
        this.scene.add(model.root);
      } catch (e) { console.warn('TanukiModel failed, using placeholder', e); }
    }).catch((e) => console.warn('model load failed', e)));
    const al = audioModules['./audio/AudioEngine.js'];
    if (al) jobs.push(al().then((m) => { this._AudioEngine = m.AudioEngine; }).catch((e) => console.warn('audio load failed', e)));
    this._optionalReady = Promise.all(jobs);
  }

  async _initAudio() {
    if (this.audio !== NULL_AUDIO || !this._AudioEngine) return;
    if (this._audioInit) return this._audioInit;
    this._audioInit = (async () => {
      try {
        const a = new this._AudioEngine();
        await a.init();
        a.setMuted?.(this.muted);
        this.audio = a;
        if (this.state === 'title') a.playMusic('title');
      } catch (e) { console.warn('audio init failed', e); }
    })();
    return this._audioInit;
  }

  _setupEnvironment() {
    const scene = this.scene;
    this.fogColor = new THREE.Color(0xcfe8fb);
    scene.fog = new THREE.Fog(this.fogColor, 420, 5200);
    this.hemi = new THREE.HemisphereLight(0xd6ecff, 0x9a8a70, 1.35);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d6, 2.4);
    this.sun.position.copy(SUN_DIR).multiplyScalar(100);
    scene.add(this.sun);
    this.sky = new Sky({ sunDir: SUN_DIR });
    scene.add(this.sky.mesh);
    this.ocean = new Ocean({ sunDir: SUN_DIR, level: 0 });
    scene.add(this.ocean.mesh);
  }

  _buildWorld() {
    const { main, rails } = this.level;
    const t0 = performance.now();
    this.scene.add(buildTrackMesh(main));
    for (const r of rails) this.scene.add(buildRailMesh(r));
    const refs = new GroundRefs(main);
    const terrain = buildTerrain(main, refs);
    this.scene.add(terrain.mesh);
    this.field = terrain.field;
    const hash = new TrackHash([main, ...rails]);
    const decor = buildCityDecor({ main, rails, hash, refs, field: this.field, openSides: this.level.openSides });
    this.scene.add(decor);
    this.archS = decor.userData.archS || [];
    this.scene.add(buildLandmarks({ main, field: this.field, hash, refs }));
    if (this.params.has('debug')) console.log('world built in', (performance.now() - t0).toFixed(0), 'ms');
  }

  _makeBlobShadow() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    m.renderOrder = 5;
    this.scene.add(m);
    return m;
  }

  applyQuality(q) {
    const Q = QUALITY[q] || QUALITY.high;
    this.quality = q in QUALITY ? q : 'high';
    this.save.quality = this.quality;
    this._writeSave();
    this.R.pixelRatio = Math.min(window.devicePixelRatio || 1, Q.pixelRatio);
    if (this.post.samples !== Q.samples) { this.post.samples = Q.samples; this.post.setSamples(Q.samples); }
    this.R.resize();
    this.scene.fog.far = 5200 * Q.far;
    this.camera.far = 7500 * Q.far;
    this.camera.updateProjectionMatrix();
  }

  // ======================================================================= events
  _wireEvents() {
    const ev = this.events;
    const A = () => this.audio;
    ev.on('jump', () => A().play('jump'));
    ev.on('land', ({ impact }) => {
      if (impact > 10) {
        A().play('land', { volume: clamp(impact / 30, 0.3, 1) });
        this.fx.burst(this.player.pos, 10, { speed: 4, color: 0xd8d2c4, size: 1.1, life: 0.5, drag: 3, alpha: 0.35, up: 1.5 });
        if (impact > 22) this.rig.shake(0.35, 0.25);
      }
    });
    ev.on('leaf', () => {
      this._leafCombo = (this._leafComboT > 0 ? (this._leafCombo || 0) + 1 : 0);
      this._leafComboT = 0.5;
      A().play('leaf', { pitch: 1 + Math.min(this._leafCombo, 12) * 0.035, pan: (Math.random() - 0.5) * 0.4 });
    });
    ev.on('hurt', ({ lost, pos }) => {
      this.input.rumble(0.9, 0.6, 260);
      A().play('hurt');
      if (lost > 0) A().play('leafScatter');
      this.objects.scatterLeaves(pos, lost);
      this.rig.shake(0.8, 0.4);
      this.post.doFlash(0xff3030, 0.35);
    });
    ev.on('death', ({ reason }) => {
      A().play('death');
      this.deaths++;
      if (reason === 'hit') this.post.doFlash(0xff3030, 0.5);
      this.hud.message('MISS…', { cls: 'small', duration: 1.2 });
    });
    ev.on('boostStart', () => {
      this.input.rumble(0.5, 0.8, 180);
      A().play('boostStart');
      A().setBoost(true);
      this.rig.kick(10, 3.2);
      this.rig.shake(0.3, 0.3);
      this.post.doFlash(0xbff4ff, 0.25);
      this.post.shock();
      const p = this.player.pos;
      for (let k = 0; k < 36; k++) {
        const a = (k / 36) * Math.PI * 2;
        this._tmp.set(Math.cos(a) * 16, Math.sin(a) * 16 * 0.6 + 2, 0).applyQuaternion(this.player.visualQuat);
        this.fx.spawn(this._tmp2.copy(p).addScaledVector(this.player.upV, 0.8), this._tmp, { color: 0x9ff0ff, size: 0.9, life: 0.35, drag: 3 });
      }
    });
    ev.on('boostEnd', () => A().setBoost(false));
    ev.on('homing', () => A().play('homing'));
    ev.on('airdash', () => { A().play('airdash'); this.rig.kick(3, 1); });
    ev.on('homingHit', (e) => { this.objects.destroyEnemy(e, 'homing'); this.rig.shake(0.25, 0.15); this.input.rumble(0.3, 0.6, 90); });
    ev.on('enemyDown', () => { A().play('enemyPop'); this.enemiesDown++; });
    ev.on('dashPanel', () => { A().play('dashPanel'); this.rig.kick(5, 1.5); this.post.doFlash(0xfff2a0, 0.12); });
    ev.on('ramp', ({ big }) => { A().play('ramp'); if (big) this.rig.kick(6, 2); });
    ev.on('trick', ({ count }) => {
      A().play('trick', { pitch: 1 + count * 0.08 });
      this.hud.popup(['TRICK!', 'COOL!', 'NICE!', 'GREAT!', 'AWESOME!', 'AMAZING!!'][Math.min(count - 1, 5)], '#7ff0ff');
    });
    ev.on('trickFinish', ({ count, score }) => {
      A().play('trickFinish');
      this.objects.addScore(score, `TRICK x${count}`, this.player.pos);
      this.player.addBoost(0.05 * count);
    });
    ev.on('spring', () => A().play('spring'));
    ev.on('dashRing', () => { A().play('dashRing'); this.rig.kick(6, 2); });
    ev.on('railLand', () => A().play('railLand'));
    ev.on('railEnd', () => A().setGrind(false));
    ev.on('lockon', () => A().play('lockon', { volume: 0.5 }));
    ev.on('carSmash', ({ byTruck }) => {
      A().play(byTruck ? 'crash' : 'carHit');
      if (!byTruck) this.rig.shake(0.5, 0.25);
    });
    ev.on('checkpoint', ({ s }) => {
      A().play('checkpoint');
      this.checkpoint = { s, time: this.runTime };
      this.hud.popup('CHECKPOINT', '#7dffb0');
    });
    ev.on('score', ({ points, reason }) => {
      if (reason === 'RING' || reason === 'TRUCK') return;
      this.hud.popup(`${reason}  +${points}`);
    });
    ev.on('goal', () => this._goal());
    ev.on('truckIntro', () => {
      A().play('truckHorn');
      A().play('crash');
      this.hud.message('LOOK OUT!', { cls: 'small yellow', duration: 1.6 });
      this.rig.shake(0.9, 0.6);
      if (!this.bot) this.cine = { t: 0, dur: 1.7, scale: 0.3 };
    });
    ev.on('truckHorn', () => A().play('truckHorn'));
    ev.on('truckHit', () => { A().play('crash'); this.rig.shake(1.2, 0.5); this.input.rumble(1, 1, 400); });
    ev.on('truckDown', () => {
      A().play('crash');
      this.hud.popup('TRUCK DOWN!  +2000', '#ffb03a');
      this.objects.addScore(2000, 'TRUCK', null);
    });
  }

  // ======================================================================= flow
  /** Compile every shader up front (hidden objects included) so nothing stutters mid-run. */
  async precompile() {
    const hidden = [];
    this.scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    try {
      const r = this.R.renderer;
      if (r.compileAsync) await r.compileAsync(this.scene, this.camera, this.scene);
      else r.compile(this.scene, this.camera);
      r.setRenderTarget(this.post.rt);
      r.render(this.scene, this.camera);
      r.setRenderTarget(null);
    } catch (e) { console.warn('precompile failed', e); }
    for (const o of hidden) o.visible = false;
  }

  async start() {
    await Promise.race([this._optionalReady, new Promise((r) => setTimeout(r, 4000))]);
    await this.precompile();
    this.hud.doneLoading();
    this.toTitle();
    // create / unlock the AudioContext inside the very first user gesture (autoplay policies)
    const unlock = () => {
      if (!this._AudioEngine) return;
      this._initAudio();
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    // auto-pause when the tab is hidden (not while automated testing)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !this.debugPaused && (this.state === 'play' || this.state === 'countdown')) this.pause();
    });
    const loop = (now) => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      if (!this.debugPaused) this.frame(dt);
    };
    requestAnimationFrame(loop);
  }

  toTitle() {
    this.state = 'title';
    this.hud.showHUD(false);
    this.hud.hideResults();
    this.hud.hidePause();
    this.hud.showTouch(false);
    this.hud.clearMessage();
    this.hud.clearHint();
    this.hud.warning(false);
    this.titleS = 30;
    this.player.reset(this.level.startS, { board: true });
    this.truck.reset();
    this.hud.showTitle({
      onStart: () => this.startRun(),
      quality: this.quality,
      onQuality: (q) => this.applyQuality(q),
      best: this.save.bestTime ? `${formatTime(this.save.bestTime)}  ／  ${this.save.bestScore || 0} pts  ／  RANK ${this.save.bestRank || '-'}` : '',
      muted: this.muted,
      onMute: () => { this.muted = !this.muted; this.save.muted = this.muted; this._writeSave(); this.audio.setMuted(this.muted); return this.muted; },
      softFx: this.fxScale < 1,
      onSoftFx: () => {
        this.save.softFx = !this.save.softFx;
        this.fxScale = this.save.softFx ? 0.4 : 1;
        this.rig.shakeScale = this.save.softFx ? 0.5 : 1;
        this._writeSave();
        return this.save.softFx;
      },
    });
    this.audio.setWind(0); this.audio.setTruck(0); this.audio.setGrind(false); this.audio.setBoost(false);
    this.audio.playMusic('title');
  }

  async startRun() {
    if (this._starting) return;
    this._starting = true;
    this.hud.hideTitle();
    this.hud.hideResults();
    this.hud.hidePause();
    await this._initAudio();
    this._starting = false;
    this.audio.play('uiSelect');
    this.resetRun();
    this.state = 'countdown';
    this.countdown = 3.6;
    this._lastCount = 4;
    this.hud.showHUD(true);
    this.hud.showTouch(true);
    this.hud.fade(false);
    this.audio.stopMusic(0.4);
  }

  resetRun() {
    const s0 = this.params.has('s') ? parseFloat(this.params.get('s')) : this.level.startS;
    this.player.reset(s0, { board: this.level.main.zoneName(s0) === 'board' });
    this.player.leaves = 0;
    this.player.boostGauge = 0.5;
    this.objects.resetFrom(-10);
    this.objects.score = 0;
    this.objects.clearTransient();
    const red = new THREE.Color(0xff3030);
    for (const cp of this.objects.checkpoints) { cp.active = false; for (const li of cp.lamps) this.objects.cpLamps.setColorAt(li, red); }
    if (this.objects.cpLamps.instanceColor) this.objects.cpLamps.instanceColor.needsUpdate = true;
    this.truck.reset();
    this.fx.clear();
    this.runTime = 0;
    this.deaths = 0;
    this.enemiesDown = 0;
    this.checkpoint = { s: s0, time: 0 };
    this.goalT = 0;
    this.respawnT = 0;
    this.rig.override = null;
    this.rig.overrideBlend = 0;
    this.cine = null;
    this._zone = null;
    this._hintsShown = new Set();
    this.hud.clearHint();
    this.rig.snap(this.player);
  }

  pause() {
    if (this.state !== 'play' && this.state !== 'countdown') return;
    this.prevState = this.state;
    this.state = 'paused';
    this.audio.pause();
    this.hud.showPause({
      onResume: () => this.resume(),
      onRestart: () => { this.hud.hidePause(); this.audio.resume(); this.startRun(); },
      onTitle: () => { this.audio.resume(); this.toTitle(); },
    });
  }

  resume() {
    if (this.state !== 'paused') return;
    this.hud.hidePause();
    this.audio.resume();
    this.state = this.prevState || 'play';
  }

  _goal() {
    if (this.state !== 'play') return;
    this.hud.clearHint();
    this.state = 'goal';
    this.goalT = 0;
    this.player.goal();
    this.audio.setWind(0); this.audio.setBoost(false); this.audio.setGrind(false); this.audio.setTruck(0);
    this.audio.playJingle('clear');
    this.hud.message('GOAL!', { cls: 'yellow', duration: 2.4 });
    this.hud.showTouch(false);
    this.hud.warning(false);
    const p = this.player.pos;
    for (let k = 0; k < 4; k++) {
      this._tmp2.set((Math.random() - 0.5) * 10, 8 + Math.random() * 4, (Math.random() - 0.5) * 10);
      this.fx.burst(this._tmp.copy(p).add(this._tmp2), 60,
        { speed: 14, colors: [0xff4f4f, 0x2d9cff, 0xffc933, 0x35d08a, 0xff7ad9, 0xffffff], size: 0.5, life: 2.2, drag: 1.2, gravity: 6 });
    }
  }

  _results() {
    this.state = 'results';
    const t = this.runTime;
    const score = this.objects.score;
    const timeBonus = Math.max(0, Math.round(((210 - t) * 120) / 10) * 10);
    const leafBonus = this.player.leaves * 50;
    const total = Math.max(0, score + timeBonus + leafBonus - this.deaths * 1000);
    const rank = total >= 40000 ? 'S' : total >= 31000 ? 'A' : total >= 22000 ? 'B' : total >= 13000 ? 'C' : 'D';
    const testRun = !!this.bot || this.params.has('s');
    const newRecord = !testRun && (!this.save.bestTime || t < this.save.bestTime);
    if (newRecord) this.save.bestTime = t;
    if (!testRun && (!this.save.bestScore || total > this.save.bestScore)) { this.save.bestScore = total; this.save.bestRank = rank; }
    this._writeSave();
    this.hud.showHUD(false);
    this.hud.showResults({ time: t, leaves: this.player.leaves, enemies: this.enemiesDown, score, timeBonus, leafBonus, total, rank, newRecord }, {
      onRetry: () => this.startRun(),
      onTitle: () => this.toTitle(),
    });
    setTimeout(() => this.audio.play('rankReveal'), 1700);
  }

  _respawn() {
    const cp = this.checkpoint;
    this.player.reset(cp.s, { board: this.level.main.zoneName(cp.s) === 'board' });
    this.player.leaves = 0;
    this.player.invuln = 1.5;
    this.objects.resetFrom(cp.s);
    this.objects.clearTransient();
    this.truck.onRespawn(cp.s);
    this.rig.snap(this.player);
    this.hud.fade(false);
  }

  // ======================================================================= main loop
  /** Debug: advance the simulation without rendering. */
  simulate(seconds, dt = 1 / 60, onFrame = null) {
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) { this.frame(dt, true); if (onFrame) onFrame(i * dt); }
    this.frame(0.0001);
  }

  frame(dt, noRender = false) {
    this.time += dt;
    const inp = this.input;
    inp.update();

    if (inp.take('pause')) {
      if (this.state === 'paused') this.resume();
      else if (this.state === 'results') { this.toTitle(); inp.clearLatched(); }
      else this.pause();
    }
    if (this.state === 'paused') {
      if (inp.take('confirm')) this.resume();
      else if (inp.take('retry')) { this.hud.hidePause(); this.audio.resume(); this.startRun(); }
    }

    switch (this.state) {
      case 'title': this._updateTitle(dt); break;
      case 'countdown': this._updateCountdown(dt); break;
      case 'play': this._updatePlay(dt); break;
      case 'goal': this._updateGoal(dt); break;
      case 'results': this._updateResults(dt); break;
      case 'paused': inp.clearLatched(); if (!noRender) this._render(); return;
      default: break;
    }
    inp.clearLatched();
    if (!noRender) this._render();
  }

  _updateTitle(dt) {
    const inp = this.input;
    if (inp.take('confirm') || inp.take('jump')) { this.startRun(); return; }
    // drone fly-over along the course
    const main = this.level.main;
    this.titleS = (this.titleS + dt * 24) % (main.length - 200);
    const F = this.F;
    main.sample(this.titleS, F);
    const pos = this._tmp.copy(F.pos).addScaledVector(F.right, 10).addScaledVector(F.up, 18);
    pos.y = Math.max(pos.y, F.pos.y + 10);
    main.sample(this.titleS + 80, F);
    const look = this._tmp2.copy(F.pos).addScaledVector(F.up, 3);
    if (this.camera.position.distanceToSquared(pos) > 400 * 400) this.camera.position.copy(pos);
    this.camera.position.lerp(pos, 1 - Math.exp(-2.5 * dt));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(look);
    if (Math.abs(this.camera.fov - 62) > 0.1) { this.camera.fov = 62; this.camera.updateProjectionMatrix(); }
    this._updateWorld(dt, true);
    this._setFX(0, 0, 0, 0.3);
    this.model.root.visible = false;
    this._shadow.visible = false;
  }

  _updateCountdown(dt) {
    this.countdown -= dt;
    const n = Math.ceil(this.countdown - 0.6);
    if (n !== this._lastCount && n >= 1 && n <= 3) {
      this._lastCount = n;
      this.hud.message(String(n), { duration: 0.7 });
      this.audio.play('countdown');
    }
    if (this.countdown <= 0.6 && this._lastCount !== 0) {
      this._lastCount = 0;
      this.hud.message('GO!', { cls: 'yellow', duration: 0.9 });
      this.audio.play('go');
      this.audio.playMusic('stage');
      this.state = 'play';
    }
    this.input.clearLatched();
    this._updateModel(dt);
    this.rig.update(dt, this.player);
    this._updateWorld(dt, true);
    this._setFX(0, 0, 0, 0.25);
    this.hud.update({ score: 0, time: 0, leaves: 0, speed: 0, boost: this.player.boostGauge, boosting: false, section: SECTION_NAMES.board });
  }

  _updatePlay(rdt) {
    const p = this.player;
    const inp = this.input;
    // cinematic slow-motion (truck reveal)
    const cine = this.cine;
    const dt = cine ? rdt * cine.scale : rdt;
    this.runTime += dt;
    this._leafComboT = Math.max(0, (this._leafComboT || 0) - dt);

    if (this.bot) { this.bot.update(dt); inp.update(); }
    // physics substeps (<= 1/120 s each)
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) p.step(h, inp, i === 0);

    // board → running transition (mid-air after the last board ramp)
    if (p.onBoard && p.mainS > this.level.boardEndS && p.state !== 'dead') {
      p.onBoard = false;
      this.audio.play('poof');
      this.fx.burst(p.pos, 50, { speed: 9, colors: [0x9be870, 0xd8f5b0, 0xffffff, 0xffd23a], size: 1.2, life: 0.8, drag: 2.5, alpha: 0.8, grow: 1 });
      this.hud.popup('LEAF BOARD → DASH!', '#b6ff8a');
    }

    this.objects.update(dt, p, this.camera);
    this.truck.update(dt, p);

    // falling into the sea or below the ground ends the attempt right away
    if (p.state === 'air' && p.mainH < -2) {
      const ground = this.field.height(p.pos.x, p.pos.z);
      if (p.pos.y < 0.3 && ground < 0) {
        this.fx.burst(this._tmp.set(p.pos.x, 0.5, p.pos.z), 70, { speed: 12, colors: [0xffffff, 0xcfefff, 0x9fd8ff], size: 1.0, life: 0.9, drag: 1.5, gravity: 14, up: 9, alpha: 0.8 });
        p.vel.multiplyScalar(0.15);
        p.die('water');
      } else if (p.pos.y < ground + 0.4) {
        p.vel.set(0, 0, 0);
        p.die('fall');
      }
    }

    // death / respawn
    if (p.state === 'dead') {
      this.respawnT += dt;
      if (this.respawnT > 1.0) this.hud.fade(true);
      if (this.respawnT > 1.6) { this.respawnT = 0; this._respawn(); }
    }

    if (cine) this._updateCine(rdt);
    this.rig.truckPush = damp(this.rig.truckPush, this.truck.active ? clamp((34 - this.truck.gap) / 22, 0, 1) : 0, 3, rdt);
    this._updateModel(dt);
    this.rig.update(rdt, p);
    this._updateWorld(dt, true);
    this._updateSpeedFX(rdt);

    // pass-by whooshes (overhead arches, parked cars close by)
    this._whoosh(p);

    // continuous audio
    const sp = p.speed;
    this.audio.setWind(p.state === 'dead' ? 0 : clamp((sp - 8) / 80, 0, 1));
    this.audio.setGrind(p.state === 'rail', clamp(sp / 70, 0, 1));
    this.audio.setTruck(this.truck.proximity);
    this.audio.setMusicIntensity(this.truck.active ? 1 : 0);

    // tutorial hints
    if (this.level.hints && p.state !== 'dead') {
      for (const h of this.level.hints) {
        if (!this._hintsShown.has(h) && p.mainS >= h.s && p.mainS < h.s + 80) {
          this._hintsShown.add(h);
          this.hud.hint(this.hud.isTouch && h.touch ? h.touch : h.text);
        }
      }
    }

    const zone = this.level.main.zoneName(p.mainS);
    if (zone !== this._zone) {
      if (this._zone && zone !== 'board' && SECTION_NAMES[zone]) this.hud.message(SECTION_NAMES[zone], { cls: 'small', duration: 1.4 });
      this._zone = zone;
    }
    this.hud.update({ score: this.objects.score, time: this.runTime, leaves: p.leaves, speed: sp, boost: p.boostGauge, boosting: p.boosting, section: SECTION_NAMES[zone] || '' });
    this.hud.warning(this.truck.danger);
  }

  _whoosh(p) {
    const s = p.mainS, prev = this._prevWhooshS ?? s;
    this._prevWhooshS = s;
    if (p.speed < 35 || s <= prev) return;
    const vol = clamp((p.speed - 35) / 50, 0.25, 0.8);
    for (const a of this.archS) if (a > prev + 6 && a <= s + 6) this.audio.play('whoosh', { volume: vol, pitch: 0.8 + p.speed / 160 });
    for (const c of this.objects.cars) {
      if (c.state !== 'parked' || Math.abs(c.x - p.mainX) > 4.5) continue;
      if (c.s > prev + 3 && c.s <= s + 3) this.audio.play('whoosh', { volume: vol * 0.8, pitch: 1.1 + p.speed / 200, pan: Math.sign(c.x - p.mainX) * 0.6 });
    }
  }

  /** Look-back shot at the truck while time slows down. */
  _updateCine(rdt) {
    const c = this.cine;
    c.t += rdt;
    const p = this.player;
    const F = this.F;
    this.level.main.sample(p.mainS, F);
    const pos = this._cinePos || (this._cinePos = new THREE.Vector3());
    const tgt = this._cineTgt || (this._cineTgt = new THREE.Vector3());
    pos.copy(p.pos).addScaledVector(F.tan, 7).addScaledVector(F.up, 2.6).addScaledVector(F.right, -3.5);
    tgt.copy(p.pos).lerp(this.truck.mesh.position, 0.55).addScaledVector(F.up, 3);
    this.rig.setOverride(pos, tgt, 7);
    c.scale = c.t < c.dur - 0.25 ? 0.3 : 1;
    if (c.t >= c.dur) { this.cine = null; this.rig.setOverride(null); }
  }

  _updateGoal(dt) {
    this.goalT += dt;
    const p = this.player;
    p.step(dt, this.input, true);
    this.objects.update(dt, p, this.camera);
    this._updateModel(dt);
    this._orbitCamera(dt, this.goalT * 0.5 + 0.6, 7 - Math.min(this.goalT, 2) * 0.8, 2.2, 4);
    this._updateWorld(dt, true);
    this._setFX(0, 0, 0, 0.3);
    this.hud.update({ score: this.objects.score, time: this.runTime, leaves: p.leaves, speed: p.speed, boost: p.boostGauge, boosting: false });
    if (this.goalT > 3.2) this._results();
  }

  _updateResults(dt) {
    this.goalT += dt;
    const p = this.player;
    p.step(dt, this.input, false);
    this._updateModel(dt);
    this._orbitCamera(dt, this.goalT * 0.35 + 0.6, 5.5, 1.8, 3, 1.1);
    this._updateWorld(dt, true);
    this._setFX(0, 0, 0, 0.35);
    if (this.input.take('confirm') || this.input.take('retry')) this.startRun();
  }

  _orbitCamera(dt, ang, r, h, rate, screenShift = 0) {
    const p = this.player;
    const F = this.F;
    this.level.main.sample(p.mainS, F);
    this._tmp.copy(p.pos).addScaledVector(F.tan, Math.cos(ang) * r).addScaledVector(F.right, Math.sin(ang) * r).addScaledVector(F.up, h);
    this.camera.position.lerp(this._tmp, 1 - Math.exp(-rate * dt));
    this.camera.up.set(0, 1, 0);
    this._tmp2.copy(p.pos).addScaledVector(F.up, 1.0);
    if (screenShift) {
      // shift the look target sideways so the hero sits right of centre (results layout)
      const toCam = this._tmp.subVectors(this.camera.position, this._tmp2).setY(0).normalize();
      this._tmp2.x += -toCam.z * screenShift; this._tmp2.z += toCam.x * screenShift;
    }
    this.camera.lookAt(this._tmp2);
    this.camera.fov = damp(this.camera.fov, 60, 3, dt);
    this.camera.updateProjectionMatrix();
  }

  _updateModel(dt) {
    const p = this.player;
    const m = this.model;
    m.root.visible = p.state !== 'dead' || (p.deadReason === 'hit' && p.deadTimer < 1.2) || (p.deadReason === 'fall' && p.deadTimer < 0.05);
    if (p.invuln > 0 && p.state !== 'dead') m.root.visible = Math.floor(p.invuln * 14) % 2 === 0;
    m.root.position.copy(p.pos);
    m.root.quaternion.copy(p.visualQuat);
    // trick spins
    if (p.trick.anim) {
      const k = Math.min(1, p.trick.t / 0.42);
      const e = k * Math.PI * 2;
      const flip = p.trick.anim === 'up' || p.trick.anim === 'down';
      const axis = flip ? this._tmp.set(1, 0, 0) : this._tmp.set(0, 1, 0);
      const sign = p.trick.anim === 'down' || p.trick.anim === 'left' ? -1 : 1;
      m.root.quaternion.multiply(this._q.setFromAxisAngle(axis, e * sign));
      if (flip) {
        const c = this._tmp2.set(0, 0.7, 0).applyQuaternion(p.visualQuat);
        m.root.position.add(c).sub(this._tmp.set(0, 0.7, 0).applyQuaternion(m.root.quaternion));
      }
    }
    m.setState(p.modelState);
    m.update(dt, { speed: p.speed, steer: this.input.steer, boost: p.boosting, airborne: p.state !== 'ground' });

    // blob shadow on the course below the hero
    const P = p.proj;
    const F = P.frame;
    if (F && p.state !== 'dead' && F.floor && P.h > -0.5 && P.h < 30 && Math.abs(P.x) < F.halfWidth + 0.5) {
      this._shadow.visible = true;
      this._shadow.position.copy(F.pos).addScaledVector(F.right, P.x).addScaledVector(F.up, 0.06 + (p.lift || 0));
      this._shadow.quaternion.setFromUnitVectors(Z_AXIS, F.up);
      const k = clamp(1 - P.h / 20, 0.3, 1);
      this._shadow.scale.setScalar(k);
      this._shadow.material.opacity = k;
    } else this._shadow.visible = false;

    // speed / boost / grind particles
    if (p.state !== 'dead' && this.state === 'play') {
      if (p.boosting) {
        for (let k = 0; k < 2; k++) {
          const side = Math.random() < 0.5 ? -1 : 1;
          this._tmp.set(side * (0.5 + Math.random() * 0.4), 0.3 + Math.random() * 1.2, 0.2).applyQuaternion(p.visualQuat).add(p.pos);
          this._tmp2.set(side * (4 + Math.random() * 5), Math.random() * 2, 0).applyQuaternion(p.visualQuat).addScaledVector(p.vel, 0.92);
          this.fx.spawn(this._tmp, this._tmp2, { color: Math.random() < 0.5 ? 0x7fe8ff : 0xffffff, size: 0.22, life: 0.22, drag: 1 });
        }
      }
      if (p.state === 'rail') {
        for (let k = 0; k < 3; k++) {
          this._tmp.set((Math.random() - 0.5) * 3, Math.random() * 4, (Math.random() - 0.5) * 3).addScaledVector(p.vel, -0.12);
          this.fx.spawn(p.pos, this._tmp, { color: Math.random() < 0.5 ? 0xffd27a : 0xfff6d8, size: 0.28, life: 0.3, drag: 1, gravity: 20 });
        }
      }
    }
  }

  _updateSpeedFX(dt) {
    const p = this.player;
    const sp = p.state === 'dead' ? 0 : p.speed;
    const b = p.boosting ? 1 : 0;
    this._boostFX = damp(this._boostFX || 0, b, b ? 8 : 2.5, dt);
    const bf = this._boostFX;
    const blur = smoothstep(28, 92, sp) * 0.085 + bf * 0.045;
    const lines = clamp(smoothstep(40, 85, sp) * 0.9 + bf * 0.7, 0, 1.4);
    const ca = smoothstep(35, 90, sp) * 0.012 + bf * 0.012;
    const vig = 0.22 + smoothstep(20, 80, sp) * 0.25 + bf * 0.12;
    this._setFX(blur, lines, ca, vig);
    // vanishing point: project a point ahead along the velocity
    const v = this._tmp.copy(p.vel);
    if (v.lengthSq() < 4) v.copy(p.fwd);
    v.normalize().multiplyScalar(80).add(p.pos);
    v.project(this.camera);
    const cx = clamp(v.x * 0.5 + 0.5, 0.3, 0.7), cy = clamp(v.y * 0.5 + 0.5, 0.3, 0.72);
    const c = this.post.uniforms.uCenter.value;
    c.x = damp(c.x, Number.isFinite(cx) ? cx : 0.5, 8, dt);
    c.y = damp(c.y, Number.isFinite(cy) ? cy : 0.55, 8, dt);
  }

  _setFX(blur, lines, ca, vig) {
    const u = this.post.uniforms;
    const k = this.fxScale;
    u.uBlur.value = blur * k;
    u.uLines.value = lines * k;
    u.uCA.value = ca * k;
    u.uVignette.value = vig;
    u.uWarn.value = this.state === 'play' && this.truck.danger ? 0.6 : 0;
  }

  _updateWorld(dt, particles) {
    this.sky.update(dt, this.camera);
    this.ocean.update(dt, this.camera);
    if (particles) this.fx.update(dt);
    this.post.update(dt);
  }

  _render() {
    this.post.render(this.scene, this.camera);
    this._renderRearView();
  }

  /** Picture-in-picture rear view while the truck is right behind the hero. */
  _renderRearView() {
    const show = this.state === 'play' && this.truck.danger && !this.cine && this.quality !== 'low' && this.player.state !== 'dead';
    this.hud.rearView(show);
    if (!show) return;
    const r = this.R.renderer;
    const w = this.R.width, h = this.R.height;
    const pw = Math.round(Math.min(w * 0.3, 380)), ph = Math.round(pw * 0.5);
    const px = w - pw - 18, top = this.hud.touchEl.classList.contains('on') ? 70 : 44;
    const py = h - top - ph;
    if (!this.rearCam) this.rearCam = new THREE.PerspectiveCamera(55, 1, 0.5, 1500);
    const cam = this.rearCam;
    const p = this.player, F = this.F;
    this.level.main.sample(p.mainS, F);
    cam.aspect = pw / ph;
    cam.updateProjectionMatrix();
    // "mirror" just above the hero's shoulder, looking back at the truck
    cam.position.copy(p.pos).addScaledVector(F.tan, 1.2).addScaledVector(F.up, 2.4).addScaledVector(F.right, 1.4);
    cam.up.set(0, 1, 0);
    cam.lookAt(this._tmp.copy(this.truck.mesh.position).addScaledVector(F.up, 3.2));
    r.setScissorTest(true);
    r.setScissor(px, py, pw, ph);
    r.setViewport(px, py, pw, ph);
    r.render(this.scene, cam);
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    this.hud.placeRearView(px, top, pw, ph);
  }
}
