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
    this.shop = el('div', 'screen shop hidden');
    root.appendChild(this.shop);

    this.loading = el('div', 'loading', 'LOADING…');
    this.loading.style.backgroundImage =
      "linear-gradient(rgba(10,26,68,.82), rgba(10,26,68,.96)), url('./og-image.jpg')";
    this.loading.style.backgroundSize = 'cover';
    this.loading.style.backgroundPosition = 'center';
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
  showTitle({ onStart, onSettings, onShop, bestTime, bestRank, streak = 0, missions, tokens, trailName }) {
    const completed = missions.filter((mission) => mission.done).length;
    this.title.innerHTML = `
      <div class="title-shell">
        <div class="title-main">
          <div class="edition-tag"><span class="edition-dot"></span> MOBILE EDITION <span class="edition-divider">/</span> MADE IN TANZANIA</div>
          <div class="title-logo" aria-label="Tanuki Rush"><span>TANUKI</span><strong>RUSH<span class="logo-arrow">↗</span></strong></div>
          <p class="title-description">One city. One speedy tanuki.<br><b>How fast can you make it down?</b></p>
          <div class="title-actions">
            <button class="ride-btn" data-start="1"><span>LET’S RIDE</span><span class="ride-arrow">↗</span></button>
            <button class="garage-btn" data-shop="1"><span class="garage-icon">✦</span> TRAILS <span class="garage-count">${tokens} ◈</span></button>
          </div>
          <div class="title-stats">
            <div><span>BEST TIME</span><strong>${bestTime || '—'}</strong></div>
            <div><span>BEST RANK</span><strong>${bestRank || '—'}</strong></div>
            <div><span>STREAK</span><strong>${streak > 0 ? `${streak} DAY${streak === 1 ? '' : 'S'}` : '—'}</strong></div>
          </div>
        </div>
        <aside class="mission-card" aria-label="Daily missions">
          <div class="mission-topline"><span>YOUR NEXT CHALLENGE</span><span class="mission-spark">✳</span></div>
          <div class="mission-heading"><div><h2>DAILY RUNS<span>.</span></h2><p>Three fresh goals, every day.</p></div><b>${completed}<small>/3</small></b></div>
          <div class="mission-list">${missions.map((mission, i) => `
            <div class="mission-item ${mission.done ? 'complete' : ''}">
              <span class="mission-number">${mission.done ? '✓' : `0${i + 1}`}</span>
              <span class="mission-label">${mission.label}</span>
              <span class="mission-reward">${mission.done ? 'DONE' : `+${mission.reward} ◈`}</span>
            </div>`).join('')}</div>
          <div class="mission-foot"><span>✦ PLAY OFFLINE</span><span>${trailName.toUpperCase()} EQUIPPED</span></div>
        </aside>
      </div>
      <div class="title-footer">
        <span class="course-label"><i></i> STAGE 01 <b>HILLSIDE CITY</b></span>
        <div class="title-links"><button data-help="1">HOW TO PLAY</button><button data-settings="1">SETTINGS</button><button data-credits="1">CREDITS</button></div>
        <span class="title-credit">ORIGINAL GAME BY TANUU5 · MIT</span>
      </div>`;
    this.title.style.backgroundImage = "linear-gradient(95deg, rgba(5,12,31,.97) 0%, rgba(5,12,31,.84) 47%, rgba(5,12,31,.48) 100%), url('./og-image.jpg')";
    this.title.classList.remove('hidden');
    this.title.onclick = (e) => {
      if (e.target.closest('[data-start]')) { onStart(); return; }
      if (e.target.closest('[data-shop]')) { onShop(); return; }
      if (e.target.closest('[data-settings]')) { onSettings(); return; }
      if (e.target.closest('[data-credits]')) { this.showCredits(); return; }
      if (e.target.closest('[data-help]')) this.showIntro();
    };
  }

  hideTitle() { this.title.classList.add('hidden'); this.title.onclick = null; }

  get hasOpenOverlay() {
    return [this.settings, this.credits, this.intro, this.shop].some((screen) => !screen.classList.contains('hidden'));
  }

  // --------------------------------------------------------------- trail shop
  showShop({ getState, onSelect, onClose }) {
    let notice = '';
    const render = () => {
      const { tokens, trails, owned, equipped } = getState();
      this.shop.innerHTML = `
        <div class="shop-inner">
          <div class="shop-header"><div><div class="eyebrow">MAKE YOUR MARK</div><h2>THE TRAIL SHOP<span>.</span></h2>
            <p>Earn leaf tokens from runs and daily goals. Trails change your boost colours, not your speed.</p></div>
            <div class="shop-wallet"><small>YOUR TOKENS</small><strong>◈ ${tokens}</strong></div></div>
          <div class="trail-grid">${trails.map((trail) => {
            const isOwned = owned.includes(trail.id), isEquipped = equipped === trail.id;
            return `<div class="trail-card ${isEquipped ? 'equipped' : ''}">
              <div class="trail-art" style="--trail-color:${trail.swatch}"><span>✦</span><i></i><i></i><i></i></div>
              <div class="trail-name">${trail.name}</div><div class="trail-desc">${trail.description}</div>
              <button data-trail="${trail.id}" ${isEquipped ? 'disabled' : ''}>${isEquipped ? '✓ EQUIPPED' : isOwned ? 'EQUIP' : `UNLOCK · ${trail.price} ◈`}</button>
            </div>`;
          }).join('')}</div>
          <div class="shop-bottom"><span class="shop-notice" role="status">${notice || 'Cosmetic only · no pay-to-win'}</span><button class="shop-back" data-shop-back="1">← BACK TO TITLE</button></div>
        </div>`;
    };
    render();
    this.shop.classList.remove('hidden');
    this.shop.onclick = (e) => {
      const choice = e.target.closest('[data-trail]');
      if (choice) {
        const result = onSelect(choice.dataset.trail);
        notice = result.ok ? (result.purchased ? `${result.trail.name} unlocked and equipped!` : `${result.trail.name} equipped!`) : 'Not enough leaf tokens yet. Finish a run to earn more!';
        render();
        return;
      }
      if (e.target.closest('[data-shop-back]')) onClose();
    };
  }

  hideShop() { this.shop.classList.add('hidden'); this.shop.onclick = null; }

  // ------------------------------------------------------------------ settings
  /** Modal settings panel. Purely a view: every change is applied by the caller. */
  showSettings({ quality, onQuality, muted, onMute, onResetAudio = async () => false, softFx, onSoftFx, onClose, haptics = null, onHaptics = () => false, reminders = null, onReminders = async () => false }) {
    const qLabel = { low: 'LOW', mid: 'MID', high: 'HIGH' };
    const sensLabel = (d) => (d <= 32 ? 'HIGH' : d >= 70 ? 'LOW' : 'MID');
    const sensStep = (dir) => {
      const steps = [78, 50, 26];
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
        <div class="set-row"><span class="set-label">RESTORE AUDIO<span class="set-hint">if sound stops</span></span>
          <span class="set-ctl"><button class="btn" data-reset-audio="1" aria-live="polite">RESET</button></span></div>
        <div class="set-row"><span class="set-label">EFFECTS</span>
          <span class="set-ctl"><button class="btn" data-softfx="1">${softFx ? 'REDUCED' : 'FULL'}</button></span></div>
        <div class="set-row"><span class="set-label">STEER SENSITIVITY<span class="set-hint">touch only</span></span>
          <span class="set-ctl"><button class="btn" data-sens="-1">−</button><button class="btn" data-sensval="1">${sensLabel(this.steerDiv)}</button><button class="btn" data-sens="1">+</button></span></div>
        ${haptics === null ? '' : `<div class="set-row"><span class="set-label">HAPTICS<span class="set-hint">vibration</span></span>
          <span class="set-ctl"><button class="btn" data-haptics="1">${haptics ? 'ON' : 'OFF'}</button></span></div>`}
        ${reminders === null ? '' : `<div class="set-row"><span class="set-label">REMINDERS<span class="set-hint">optional notifications</span></span>
          <span class="set-ctl"><button class="btn" data-reminders="1">${reminders ? 'ON' : 'OFF'}</button></span></div>`}
      </div>
      <button class="btn big" data-close="1">BACK</button>
      <div class="credit">© 2026 Mwijay · game by tanuu5 · MIT</div>`;
    this.settings.classList.remove('hidden');
    this.settings.onclick = async (e) => {
      const q = e.target.closest('[data-q]');
      if (q) { e.stopPropagation(); onQuality(q.dataset.q); this.settings.querySelectorAll('[data-q]').forEach((b) => b.classList.toggle('sel', b === q)); return; }
      const m = e.target.closest('[data-mute]');
      if (m) { e.stopPropagation(); m.textContent = onMute() ? 'OFF' : 'ON'; return; }
      const resetAudio = e.target.closest('[data-reset-audio]');
      if (resetAudio) {
        e.stopPropagation();
        resetAudio.disabled = true;
        resetAudio.textContent = 'RESETTING…';
        try { resetAudio.textContent = await onResetAudio() ? 'DONE' : 'TRY AGAIN'; }
        catch (_) { resetAudio.textContent = 'TRY AGAIN'; }
        finally { resetAudio.disabled = false; }
        return;
      }
      const f = e.target.closest('[data-softfx]');
      if (f) { e.stopPropagation(); f.textContent = onSoftFx() ? 'REDUCED' : 'FULL'; return; }
      const h = e.target.closest('[data-haptics]');
      if (h) { e.stopPropagation(); h.textContent = onHaptics() ? 'ON' : 'OFF'; return; }
      const remindersButton = e.target.closest('[data-reminders]');
      if (remindersButton) {
        e.stopPropagation();
        remindersButton.disabled = true;
        try { remindersButton.textContent = await onReminders() ? 'ON' : 'OFF'; }
        finally { remindersButton.disabled = false; }
        return;
      }
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
    const touch = this.isTouch;
    const steps = [
      { n: '01', t: 'STEER', d: touch ? 'Drag on the left half of the screen. The stick follows your thumb.' : 'Use the arrow keys or A and D to steer. Running is automatic.' },
      { n: '02', t: 'JUMP', d: touch ? 'Tap JUMP. Tap again in mid-air for a homing attack.' : 'Press SPACE or J to jump. Press again in mid-air for a homing attack.' },
      { n: '03', t: 'BOOST', d: touch ? 'Hold BOOST to spend your gauge and smash through obstacles.' : 'Hold SHIFT or K to boost. Collect leaves to refill the gauge.' },
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
    const newlyDone = new Set(r.award?.newlyCompleted.map((m) => m.id) || []);
    const missions = r.award?.missions || [];
    this.results.innerHTML = `
      <div class="results-layout">
        <section class="result-main">
          <div class="eyebrow">STAGE 01 / HILLSIDE CITY</div>
          <h2>COURSE CLEAR<span>!</span></h2>
          <p class="result-subtitle">Nice run. Ready to beat it?</p>
          <div class="result-stats">
            <div><span>TIME</span><strong>${formatTime(r.time)}</strong>${r.newRecord ? '<em>NEW BEST</em>' : ''}</div>
            <div><span>TOTAL SCORE</span><strong>${r.total.toLocaleString()}</strong></div>
            <div><span>LEAVES COLLECTED</span><strong>${r.collected}</strong></div>
          </div>
          ${r.tier.next ? `<div class="result-progress"><div><span>NEXT UP: RANK ${r.tier.next}</span><span>${r.tier.need.toLocaleString()} PTS TO GO</span></div><i><b style="width:${Math.round(r.tier.progress * 100)}%"></b></i></div>` : '<div class="result-progress maxed">★ MAX RANK — AMAZING RUN</div>'}
          <div class="result-actions"><button class="ride-btn" data-a="retry">RUN IT BACK <span>↗</span></button><button class="garage-btn" data-a="title">TITLE</button></div>
        </section>
        <aside class="result-side">
          <div class="result-grade"><div><span>YOUR RANK</span><strong class="rank-${r.rank}">${r.rank}</strong></div>
            <div class="result-earned"><span>${r.award ? 'LEAF TOKENS EARNED' : 'PRACTICE RUN'}</span><strong>${r.award ? `+${r.award.total} ◈` : 'NO REWARDS'}</strong><small>${r.award ? `${r.award.base} from your run · ${r.award.bonus} from goals` : 'Finish a normal run to earn tokens.'}</small></div>
          </div>
          ${r.award ? `<div class="result-missions"><div class="result-mission-title">DAILY GOALS <span>${missions.filter((m) => m.done).length}/3 COMPLETE</span></div>
            ${missions.map((m) => `<div class="result-mission ${m.done ? 'complete' : ''}"><span>${m.done ? '✓' : '○'}</span><b>${m.label}</b><small>${newlyDone.has(m.id) ? `+${m.reward} ◈` : m.done ? 'DONE' : `+${m.reward} ◈`}</small></div>`).join('')}
          </div>` : ''}
          ${r.streak > 0 ? `<div class="result-streak">✦ ${r.streak}-DAY STREAK</div>` : ''}
        </aside>
      </div>`;
    this.results.classList.remove('hidden');
    this.results.onclick = (e) => {
      const a = e.target.closest('[data-a]');
      if (!a) return;
      if (a.dataset.a === 'retry') onRetry(); else onTitle();
    };
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
    t.innerHTML = `<div class="tpad"><div class="steer-guide" aria-hidden="true"><span>↔</span> DRAG TO STEER</div><div class="tstick"><div class="knob"></div></div></div>
      <div class="tbtn jump" data-b="jump">JUMP</div><div class="tbtn boost" data-b="boost">BOOST</div>
      <div class="tbtn brake" data-b="brake">BRAKE</div><div class="tbtn pausebtn" data-b="pause">II</div>`;
    this.root.appendChild(t);
    this.touchEl = t;
    const inp = this.input;
    const pad = t.querySelector('.tpad'), stick = t.querySelector('.tstick'), knob = t.querySelector('.knob');
    let sid = null, sx = 0, sy = 0;
    const resetSteer = () => {
      const active = sid; sid = null;
      if (active !== null) {
        try { if (pad.hasPointerCapture(active)) pad.releasePointerCapture(active); } catch (_) { /* best-effort */ }
      }
      inp.touch.steer = 0;
      stick.style.display = 'none';
    };
    this._resetSteer = resetSteer;
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      // Keep the first steering finger if another touches the left side.
      if (sid !== null) return;
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
    const end = (e) => { if (e.pointerId === sid) resetSteer(); };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    pad.addEventListener('lostpointercapture', end);
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
      this._resetSteer();
      inp.touch.jump = false; inp.touch.boost = false; inp.touch.brake = false;
      this.touchEl.querySelectorAll('.tbtn.down').forEach((b) => b.classList.remove('down'));
    }
  }
}
