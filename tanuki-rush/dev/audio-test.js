// Dev bench for the procedural audio engine: http://127.0.0.1:5173/dev/audio-test.html
import { AudioEngine } from '../src/audio/AudioEngine.js';

const audio = new AudioEngine();
window.audio = audio; // handy for poking at it from the console

const $ = (id) => document.getElementById(id);

/** Any button click is a user gesture: make sure the engine exists before using it. */
const ensure = () => (audio.ready ? Promise.resolve(true) : audio.init().then((ok) => {
  $('init').textContent = ok ? 'Audio ready' : 'Web Audio unavailable';
  return ok;
}));

/** Bind a range input to a callback and show its value in the sibling <output>. */
function slider(id, fn) {
  const el = $(id);
  const out = el.parentElement.querySelector('output');
  const update = () => {
    const v = Number(el.value);
    if (out) out.textContent = v.toFixed(2);
    fn(v);
  };
  el.addEventListener('input', update);
  update();
  return el;
}

function toggle(id, fn) {
  const el = $(id);
  el.addEventListener('click', () => {
    el.classList.toggle('on');
    fn(el.classList.contains('on'));
  });
  return el;
}

// --- engine ------------------------------------------------------------------
$('init').addEventListener('click', () => {
  if (audio.ready) audio.init(); // resumes a suspended context
  else ensure();
});
$('pause').addEventListener('click', () => audio.pause());
$('resume').addEventListener('click', () => audio.resume());
toggle('mute', (on) => audio.setMuted(on));
slider('vMaster', (v) => audio.setMasterVolume(v));
slider('vMusic', (v) => audio.setMusicVolume(v));
slider('vSfx', (v) => audio.setSfxVolume(v));

// --- music -------------------------------------------------------------------
document.querySelectorAll('[data-music]').forEach((b) => b.addEventListener('click', () => ensure().then(() => audio.playMusic(b.dataset.music))));
document.querySelectorAll('[data-jingle]').forEach((b) => b.addEventListener('click', () => ensure().then(() => audio.playJingle(b.dataset.jingle))));
$('stopMusic').addEventListener('click', () => audio.stopMusic(0.5));
const intensity = slider('intensity', (v) => audio.setMusicIntensity(v));

// --- loops -------------------------------------------------------------------
const wind = slider('wind', (v) => audio.setWind(v));
const truck = slider('truck', (v) => audio.setTruck(v));
let grindOn = false;
const grindX = slider('grindX', (v) => audio.setGrind(grindOn, v));
toggle('grind', (on) => {
  grindOn = on;
  audio.setGrind(on, Number(grindX.value));
});
toggle('boost', (on) => audio.setBoost(on));

/** Animate a slider value (and fire its input handler) over `sec` seconds. */
function animate(el, from, to, sec) {
  const t0 = performance.now();
  return new Promise((resolve) => {
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / (sec * 1000));
      el.value = String(from + (to - from) * k);
      el.dispatchEvent(new Event('input'));
      if (k < 1) requestAnimationFrame(step);
      else resolve();
    };
    step();
  });
}

$('chase').addEventListener('click', async () => {
  await ensure();
  audio.playMusic('stage');
  audio.play('truckHorn');
  await Promise.all([animate(truck, 0, 1, 4), animate(intensity, 0, 1, 4)]);
  audio.play('crash', { pan: -0.4 });
  audio.play('truckHorn');
  await new Promise((r) => setTimeout(r, 1500));
  await Promise.all([animate(truck, 1, 0, 2.5), animate(intensity, 1, 0, 2.5)]);
});

$('run').addEventListener('click', async () => {
  await ensure();
  await animate(wind, 0, 1, 2);
  audio.play('dashPanel');
  audio.setBoost(true);
  audio.play('boostStart');
  for (let i = 0; i < 6; i++) setTimeout(() => audio.play('whoosh', { pan: i % 2 ? 0.7 : -0.7 }), 250 + i * 300);
  await new Promise((r) => setTimeout(r, 2200));
  audio.setBoost(false);
  await animate(wind, 1, 0, 1.8);
});

// --- sfx ---------------------------------------------------------------------
const opts = { volume: 1, pitch: 1, pan: 0 };
slider('sVol', (v) => { opts.volume = v; });
slider('sPitch', (v) => { opts.pitch = v; });
slider('sPan', (v) => { opts.pan = v; });

const box = $('sfxButtons');
for (const name of AudioEngine.SFX_NAMES) {
  const b = document.createElement('button');
  b.textContent = name;
  b.addEventListener('click', () => ensure().then(() => audio.play(name, { ...opts })));
  box.appendChild(b);
}

$('leafCombo').addEventListener('click', async () => {
  await ensure();
  for (let i = 0; i < 12; i++) {
    setTimeout(() => audio.play('leaf', { pitch: 1 + i * 0.08, pan: Math.sin(i) * 0.4 }), i * 100);
  }
});

$('stress').addEventListener('click', async () => {
  await ensure();
  const names = AudioEngine.SFX_NAMES;
  for (let i = 0; i < 40; i++) {
    setTimeout(() => {
      const n = names[Math.floor(Math.random() * names.length)];
      audio.play(n, { pitch: 0.8 + Math.random() * 0.5, pan: Math.random() * 2 - 1, volume: 0.8 });
    }, Math.random() * 1000);
  }
});

$('countdownSeq').addEventListener('click', async () => {
  await ensure();
  [0, 1, 2].forEach((i) => setTimeout(() => audio.play('countdown'), i * 1000));
  setTimeout(() => audio.play('go'), 3000);
});

// --- status ------------------------------------------------------------------
setInterval(() => {
  const d = audio.getDebugInfo();
  $('status').textContent = d.ready
    ? `ctx: ${d.state}  t=${d.time.toFixed(1)}s  ${d.sampleRate} Hz${d.paused ? '  [paused]' : ''}\n` +
      `music: ${d.music || '-'}  section: ${d.section || '-'}  bar: ${d.bar}  intensity: ${d.intensity.toFixed(2)}\n` +
      `sfx voices: ${d.sfxVoices}  skipped steps (stalls): ${d.skippedSteps}`
    : 'not initialised — click "Init audio"';
}, 200);
