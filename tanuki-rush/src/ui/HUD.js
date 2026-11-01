import './hud.css';

const LEAF_SVG = `<svg class="leaf-icon" viewBox="0 0 40 40"><path d="M20 2 C31 10 33 24 20 36 C7 24 9 10 20 2 Z" fill="#ffc629" stroke="#0c1633" stroke-width="3"/><path d="M20 6 L20 37" stroke="#d98a0b" stroke-width="2.5"/></svg>`;

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  return `${m}'${String(s).padStart(2, '0')}"${String(cs).padStart(2, '0')}`;
}

export class HUD {
  constructor(input) {
    this.input = input;
    const root = el('div');
    root.id = 'ui';
    document.body.appendChild(root);
    this.root = root;

    // ---- in-game HUD
    this.hud = el('div', 'hud hidden');
    this.hud.innerHTML = `
      <div class="hud-top">
        <div class="hud-row"><span class="hud-label">SCORE</span><span class="hud-value" data-k="score">0</span></div>
        <div class="hud-row"><span class="hud-label">TIME</span><span class="hud-value" data-k="time">0'00"00</span></div>
        <div class="hud-row hud-leaves"><span class="hud-label">${LEAF_SVG}</span><span class="hud-value" data-k="leaves">0</span></div>
      </div>
      <div class="hud-right"><div class="section-name" data-k="section"></div></div>
      <div class="hud-bottom">
        <div class="speedo"><span class="num" data-k="speed">0</span><span class="unit">km/h</span></div>
        <div class="boost-label" data-k="boostLabel">BOOST</div>
        <div class="boost"><div class="fill" data-k="boostFill"></div><div class="ticks"></div></div>
      </div>
      <div class="warning" data-k="warning">WARNING</div>
      <div class="popups" data-k="popups"></div>`;
    root.appendChild(this.hud);
    this.k = {};
    this.hud.querySelectorAll('[data-k]').forEach((n) => { this.k[n.dataset.k] = n; });
    this.leavesRow = this.hud.querySelector('.hud-leaves');
    this.boostBar = this.hud.querySelector('.boost');

    this.msgHost = el('div');
    root.appendChild(this.msgHost);

    this.fadeEl = el('div', 'fade');
    root.appendChild(this.fadeEl);

    // ---- screens
    this.title = el('div', 'screen title hidden');
    root.appendChild(this.title);
    this.results = el('div', 'screen results hidden');
    root.appendChild(this.results);
    this.pause = el('div', 'screen pause hidden');
    root.appendChild(this.pause);
    this.settings = el('div', 'screen settings hidden');
    root.appendChild(this.settings);
    this.credits = el('div', 'screen settings credits hidden');
    root.appendChild(this.credits);
    this.intro = el('div', 'screen settings intro hidden');
    root.appendChild(this.intro);

    this.loading = el('div', 'loading', 'LOADING…');
    root.appendChild(this.loading);

    this._last = {};
    // Touch steering divisor: smaller = more sensitive. Persisted on its own so
    // the game's save schema does not need to change.
    this.steerDiv = Number(localStorage.getItem('tanuki_steerDiv')) || 50;
    this._buildTouch();
  }

  doneLoading() { this.loading.classList.add('done'); setTimeout(() => this.loading.remove(), 600); }

  showHUD(on) { this.hud.classList.toggle('hidden', !on); }

  set(key, value) {
    if (this._last[key] === value) return;
    this._last[key] = value;
    this.k[key].textContent = value;
  }

  update({ score, time, leaves, speed, boost, boosting, section }) {
    this.set('score', String(score));
    this.set('time', formatTime(time));
    if (leaves > (this._lastLeaves ?? 0)) {
      const v = this.k.leaves;
      v.classList.remove('bump'); void v.offsetWidth; v.classList.add('bump');
    }
    this._lastLeaves = leaves;
    this.set('leaves', String(leaves));
    this.set('speed', String(Math.round(speed * 3.6)));
    if (section !== undefined) this.set('section', section);
    const zero = leaves === 0;
    if (this._zero !== zero) { this._zero = zero; this.leavesRow.classList.toggle('zero', zero); }
    const b = Math.round(boost * 200) / 200;
    if (this._boost !== b) { this._boost = b; this.k.boostFill.style.transform = `scaleX(${b})`; }
    if (this._boosting !== boosting) { this._boosting = boosting; this.boostBar.classList.toggle('active', boosting); }
    const full = boost >= 0.999;
    if (this._full !== full) { this._full = full; this.k.boostLabel.classList.toggle('full', full); this.k.boostLabel.textContent = full ? 'BOOST  MAX' : 'BOOST'; }
  }

  warning(on) {
    if (this._warn === on) return;
    this._warn = on;
    this.k.warning.classList.toggle('on', on);
  }

  message(text, { cls = '', duration = 1.2 } = {}) {
    if (this._msg) this._msg.remove();
    const m = el('div', 'msg pop ' + cls, text);
    this.msgHost.appendChild(m);
    this._msg = m;
    clearTimeout(this._msgT);
    if (duration > 0) {
      this._msgT = setTimeout(() => { m.classList.remove('pop'); m.classList.add('out'); setTimeout(() => m.remove(), 400); }, duration * 1000);
    }
    return m;
  }

  clearMessage() { if (this._msg) { this._msg.remove(); this._msg = null; } }

  popup(text, color) {
    const p = el('div', 'popup', text);
    if (color) p.style.color = color;
    const host = this.k.popups;
    const n = host.children.length;
    p.style.top = `${-n * 30}px`;
    host.appendChild(p);
    setTimeout(() => p.remove(), 1150);
  }

  fade(on) { this.fadeEl.classList.toggle('on', on); }

  rearView(on) {
    if (!this.rearEl) { this.rearEl = el('div', 'rearview', '<span>REAR</span>'); this.root.appendChild(this.rearEl); }
    if (this._rear === on) return;
    this._rear = on;
    this.rearEl.classList.toggle('on', on);
  }

  placeRearView(x, y, w, h) {
    const k = `${x},${y},${w},${h}`;
    if (this._rearPos === k) return;
    this._rearPos = k;
    Object.assign(this.rearEl.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
  }

  hint(text) {
    if (!this.hintEl) { this.hintEl = el('div', 'hint'); this.root.appendChild(this.hintEl); }
    this.hintEl.textContent = text;
    this.hintEl.classList.remove('show');
    void this.hintEl.offsetWidth;
    this.hintEl.classList.add('show');
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => this.hintEl.classList.remove('show'), 3200);
  }

  clearHint() { if (this.hintEl) this.hintEl.classList.remove('show'); }

  // ------------------------------------------------------------------ title
  showTitle({ onStart, quality, onQuality, best, muted, onMute, softFx = false, onSoftFx = () => false, onSettings = () => {} }) {
    const touch = this.isTouch;
    this.title.innerHTML = `
      <div class="logo"><span class="l1">TANUKI <span class="acc">RUSH</span></span><span class="l2">MOBILE EDITION · MADE IN TZ</span></div>
      <div class="stage-card">STAGE 1 — HILLSIDE CITY</div>
      <div class="press">${touch ? 'TAP TO START' : 'PRESS ENTER / CLICK'}</div>
      <div class="controls">
        ${touch
          ? `<span class="k">DRAG LEFT</span><span>Steer left / right</span><span class="k">JUMP</span><span>Jump · again in air: homing attack</span><span class="k">BOOST</span><span>Boost (uses the gauge)</span><span class="k">II</span><span>Pause</span>`
          : `<span class="k">← → / A D</span><span>Steer left / right (running is automatic)</span>
        <span class="k">SPACE / J</span><span>Jump · again in air: homing attack</span>
        <span class="k">SHIFT / K</span><span>Boost (collect leaves to fill the gauge)</span>
        <span class="k">↓ / S</span><span>Brake</span>
        <span class="k">After a ramp ↑↓←→</span><span>Trick!</span>
        <span class="k">ESC / P</span><span>Pause</span>`}
      </div>
      <div class="opts">
        <button class="btn" data-settings="1">⚙ SETTINGS</button>
        <button class="btn" data-credits="1">★ CREDITS</button>
        <span style="align-self:center">QUALITY</span>
        ${['low', 'mid', 'high'].map((q) => `<button class="btn ${q === quality ? 'sel' : ''}" data-q="${q}">${{ low: 'LOW', mid: 'MID', high: 'HIGH' }[q]}</button>`).join('')}
        <button class="btn" data-mute="1">${muted ? '🔇 SOUND OFF' : '🔊 SOUND ON'}</button>
        <button class="btn" data-softfx="1" title="Softens motion blur and speed lines">${softFx ? '🌙 REDUCED FX' : '⚡ FULL FX'}</button>
      </div>
      ${best ? `<div class="stage-card">BEST  ${best}</div>` : ''}
      ${touch ? '<div class="rotate-hint">📱 Best in landscape</div>' : ''}
      <div class="credit">© 2026 Mwijay · game by tanuu5 · MIT</div>`;
    this.title.classList.remove('hidden');
    this.title.onclick = (e) => {
      const q = e.target.closest('[data-q]');
      if (q) { e.stopPropagation(); onQuality(q.dataset.q); this.title.querySelectorAll('[data-q]').forEach((b) => b.classList.toggle('sel', b === q)); return; }
      const m = e.target.closest('[data-mute]');
      if (m) { e.stopPropagation(); const now = onMute(); m.textContent = now ? '🔇 SOUND OFF' : '🔊 SOUND ON'; return; }
      const f = e.target.closest('[data-softfx]');
      if (f) { e.stopPropagation(); const now = onSoftFx(); f.textContent = now ? '🌙 REDUCED FX' : '⚡ FULL FX'; return; }
      if (e.target.closest('[data-settings]')) { e.stopPropagation(); onSettings(); return; }
      if (e.target.closest('[data-credits]')) { e.stopPropagation(); this.showCredits(); return; }
      onStart();
    };
  }

  hideTitle() { this.title.classList.add('hidden'); this.title.onclick = null; }

  // ------------------------------------------------------------------ settings
  /** Modal settings panel. Purely a view: every change is applied by the caller. */
  showSettings({ quality, onQuality, muted, onMute, softFx, onSoftFx, onClose }) {
    const qLabel = { low: 'LOW', mid: 'MID', high: 'HIGH' };
    const sensLabel = (d) => (d <= 32 ? 'HIGH' : d >= 70 ? 'LOW' : 'MID');
    const sensStep = (dir) => {
      const steps = [26, 50, 78];
      const i = steps.indexOf(this.steerDiv);
      const next = steps[Math.max(0, Math.min(steps.length - 1, (i === -1 ? 1 : i) + dir))];
      this.steerDiv = next;
      localStorage.setItem('tanuki_steerDiv', String(next));
      return sensLabel(next);
    };
    this.settings.innerHTML = `
      <div class="set-title">SETTINGS</div>
      <div class="set-rows">
        <div class="set-row"><span class="set-label">QUALITY</span>
          <span class="set-ctl">${['low', 'mid', 'high'].map((q) => `<button class="btn ${q === quality ? 'sel' : ''}" data-q="${q}">${qLabel[q]}</button>`).join('')}</span></div>
        <div class="set-row"><span class="set-label">SOUND</span>
          <span class="set-ctl"><button class="btn" data-mute="1">${muted ? 'OFF' : 'ON'}</button></span></div>
        <div class="set-row"><span class="set-label">EFFECTS</span>
          <span class="set-ctl"><button class="btn" data-softfx="1">${softFx ? 'REDUCED' : 'FULL'}</button></span></div>
        <div class="set-row"><span class="set-label">STEER SENSITIVITY<span class="set-hint">touch only</span></span>
          <span class="set-ctl"><button class="btn" data-sens="-1">−</button><button class="btn" data-sensval="1">${sensLabel(this.steerDiv)}</button><button class="btn" data-sens="1">+</button></span></div>
      </div>
      <button class="btn big" data-close="1">BACK</button>
      <div class="credit">© 2026 Mwijay · game by tanuu5 · MIT</div>`;
    this.settings.classList.remove('hidden');
    this.settings.onclick = (e) => {
      const q = e.target.closest('[data-q]');
      if (q) { e.stopPropagation(); onQuality(q.dataset.q); this.settings.querySelectorAll('[data-q]').forEach((b) => b.classList.toggle('sel', b === q)); return; }
      const m = e.target.closest('[data-mute]');
      if (m) { e.stopPropagation(); m.textContent = onMute() ? 'OFF' : 'ON'; return; }
      const f = e.target.closest('[data-softfx]');
      if (f) { e.stopPropagation(); f.textContent = onSoftFx() ? 'REDUCED' : 'FULL'; return; }
      const s = e.target.closest('[data-sens]');
      if (s) {
        e.stopPropagation();
        const label = sensStep(Number(s.dataset.sens));
        this.settings.querySelector('[data-sensval]').textContent = label;
        return;
      }
      if (e.target.closest('[data-credits]')) { e.stopPropagation(); this.showCredits(true); return; }
      if (e.target.closest('[data-close]')) { e.stopPropagation(); onClose(); }
    };
  }

  hideSettings() { this.settings.classList.add('hidden'); this.settings.onclick = null; }
  get settingsOpen() { return !this.settings.classList.contains('hidden'); }

  // ------------------------------------------------------------------ credits
  showCredits(fromSettings = false) {
    this.credits.innerHTML = `
      <div class="set-title">CREDITS</div>
      <div class="cred-list">
        <div class="cred-block">
          <div class="cred-role">MOBILE EDITION</div>
          <div class="cred-name">Mwijay Davie</div>
          <div class="cred-note">Made in Tanzania · Android build, settings, onboarding, English UI</div>
        </div>
        <div class="cred-block">
          <div class="cred-role">ORIGINAL GAME &amp; HTML</div>
          <div class="cred-name">tanuu5</div>
          <div class="cred-note">TANUKI RUSH — Three.js, MIT License © 2026</div>
        </div>
        <div class="cred-block">
          <div class="cred-role">ENGINE &amp; TOOLING</div>
          <div class="cred-note">three.js · Vite · Flutter · Dart</div>
        </div>
      </div>
      <button class="btn big" data-back="1">BACK</button>`;
    this.credits.classList.remove('hidden');
    this.credits.onclick = (e) => {
      if (!e.target.closest('[data-back]')) return;
      e.stopPropagation();
      this.credits.classList.add('hidden');
      this.credits.onclick = null;
      if (fromSettings) this.settings.classList.remove('hidden');
    };
  }

  // ---------------------------------------------------------------- onboarding
  /** First-run coaching. Shown once, then never again unless storage is cleared. */
  showIntro(onDone) {
    const steps = [
      { n: '01', t: 'STEER', d: 'Drag anywhere on the left half of the screen. The stick follows your thumb.' },
      { n: '02', t: 'JUMP', d: 'Tap JUMP. Tap it again in mid-air to lock on and homing-attack an enemy.' },
      { n: '03', t: 'BOOST', d: 'Hold BOOST to spend your leaf gauge. You smash through enemies and cars.' },
    ];
    this.intro.innerHTML = `
      <div class="set-title">HOW TO PLAY</div>
      <div class="intro-steps">
        ${steps.map((s) => `<div class="intro-step"><span class="intro-n">${s.n}</span>
          <div><div class="intro-t">${s.t}</div><div class="intro-d">${s.d}</div></div></div>`).join('')}
      </div>
      <div class="intro-foot">Collect leaves to refill the gauge · reach the bay before the truck catches you</div>
      <button class="btn big" data-go="1">GOT IT</button>`;
    this.intro.classList.remove('hidden');
    this.intro.onclick = (e) => {
      if (!e.target.closest('[data-go]')) return;
      e.stopPropagation();
      this.intro.classList.add('hidden');
      this.intro.onclick = null;
      onDone?.();
    };
  }

  // ------------------------------------------------------------------ results
  showResults(r, { onRetry, onTitle }) {
    const rows = [
      ['TIME', formatTime(r.time) + (r.newRecord ? '<span class="newrec">NEW RECORD!</span>' : '')],
      ['LEAVES', `${r.leaves}`],
      ['ENEMIES', `${r.enemies}`],
      ['SCORE', `${r.score}`],
      ['TIME BONUS', `${r.timeBonus}`],
      ['LEAF BONUS', `${r.leafBonus}`],
      ['TOTAL', `<span class="total">${r.total}</span>`],
    ];
    this.results.innerHTML = `
      <div class="res-title">COURSE CLEAR!</div>
      <div class="res-table">${rows.map(([k, v], i) => `<div class="k" style="animation-delay:${0.25 + i * 0.18}s">${k}</div><div class="v" style="animation-delay:${0.25 + i * 0.18}s">${v}</div>`).join('')}</div>
      <div class="res-actions">
        <button class="btn big" data-a="retry">RETRY</button>
        <button class="btn big" data-a="title">TITLE</button>
      </div>
      ${this.isTouch ? '' : '<div class="stage-card">ENTER / R retry · ESC title</div>'}
      <div class="rank"><div class="lbl">RANK</div><div class="letter rank-${r.rank}">${r.rank}</div></div>`;
    this.results.classList.remove('hidden');
    this.results.onclick = (e) => {
      const a = e.target.closest('[data-a]');
      if (!a) return;
      if (a.dataset.a === 'retry') onRetry(); else onTitle();
    };
    setTimeout(() => this.results.querySelector('.letter')?.classList.add('show'), 1700);
  }

  hideResults() { this.results.classList.add('hidden'); this.results.onclick = null; }

  // ------------------------------------------------------------------ pause
  showPause({ onResume, onRestart, onTitle, onSettings = () => {} }) {
    this.pause.innerHTML = `<div class="ttl">PAUSE</div><div class="col">
      <button class="btn big" data-a="resume">RESUME</button>
      <button class="btn big" data-a="restart">RESTART</button>
      <button class="btn big" data-a="settings">SETTINGS</button>
      <button class="btn big" data-a="title">TITLE</button></div>
      ${this.isTouch ? '' : '<div class="stage-card">ESC / ENTER resume · R restart</div>'}`;
    this.pause.classList.remove('hidden');
    this.pause.onclick = (e) => {
      const a = e.target.closest('[data-a]');
      if (!a) return;
      if (a.dataset.a === 'settings') { onSettings(); return; }
      ({ resume: onResume, restart: onRestart, title: onTitle })[a.dataset.a]();
    };
  }

  hidePause() { this.pause.classList.add('hidden'); this.pause.onclick = null; }

  // ------------------------------------------------------------------ touch controls
  get isTouch() { return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window; }

  _buildTouch() {
    const t = el('div', 'touch');
    t.innerHTML = `<div class="tpad"><div class="tstick"><div class="knob"></div></div></div>
      <div class="tbtn jump" data-b="jump">JUMP</div><div class="tbtn boost" data-b="boost">BOOST</div>
      <div class="tbtn brake" data-b="brake">BRAKE</div><div class="tbtn pausebtn" data-b="pause">II</div>`;
    this.root.appendChild(t);
    this.touchEl = t;
    const inp = this.input;
    const pad = t.querySelector('.tpad'), stick = t.querySelector('.tstick'), knob = t.querySelector('.knob');
    let sid = null, sx = 0, sy = 0;
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      sid = e.pointerId; sx = e.clientX; sy = e.clientY;
      try { pad.setPointerCapture(e.pointerId); } catch (_) { /* capture is best-effort */ }
      const r = pad.getBoundingClientRect();
      stick.style.display = 'block';
      stick.style.left = `${sx - r.left - 60}px`; stick.style.top = `${sy - r.top - 60}px`;
      knob.style.transform = '';
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== sid) return;
      const dx = Math.max(-50, Math.min(50, e.clientX - sx));
      inp.touch.steer = Math.abs(dx) < 6 ? 0 : dx / this.steerDiv;
      knob.style.transform = `translateX(${dx}px)`;
    });
    const end = (e) => { if (e.pointerId !== sid) return; sid = null; inp.touch.steer = 0; stick.style.display = 'none'; };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    t.querySelectorAll('.tbtn').forEach((b) => {
      const name = b.dataset.b;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        // Capture keeps the button receiving events after the finger slides, so
        // a held BOOST stays held. Without it the browser retargets to whatever
        // is underneath and the release never reaches this element.
        try { b.setPointerCapture(e.pointerId); } catch (_) { /* best-effort */ }
        b.classList.add('down');
        if (name === 'pause') { inp.press('pause'); return; }
        inp.touch[name] = true;
        inp.press(name === 'brake' ? 'down' : name);
      });
      const up = () => { b.classList.remove('down'); if (name !== 'pause') inp.touch[name] = false; };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      // pointerleave fires on touch the moment the finger drifts a pixel off the
      // circle, which released held buttons instantly. Mouse only.
      b.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') up(); });
    });
  }

  showTouch(on) {
    const t = on && this.isTouch;
    this.touchEl.classList.toggle('on', t);
    this.root.classList.toggle('touching', t);
    if (!t) {
      // Never leave a control stuck down when the layer disappears.
      const inp = this.input;
      inp.touch.steer = 0; inp.touch.jump = false; inp.touch.boost = false; inp.touch.brake = false;
      this.touchEl.querySelectorAll('.tbtn.down').forEach((b) => b.classList.remove('down'));
    }
  }
}
