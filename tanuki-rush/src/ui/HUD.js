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

    this.loading = el('div', 'loading', 'LOADING…');
    root.appendChild(this.loading);

    this._last = {};
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
  showTitle({ onStart, quality, onQuality, best, muted, onMute, softFx = false, onSoftFx = () => false }) {
    const touch = this.isTouch;
    this.title.innerHTML = `
      <div class="logo"><span class="l1">TANUKI <span class="acc">RUSH</span></span><span class="l2">たぬきラッシュ</span></div>
      <div class="stage-card">STAGE 1 — HILLSIDE CITY ／ 坂の街を駆け抜けろ！</div>
      <div class="press">${touch ? 'TAP TO START' : 'PRESS ENTER / CLICK'}</div>
      <div class="controls">
        ${touch
          ? `<span class="k">左ドラッグ</span><span>左右に移動</span><span class="k">JUMP</span><span>ジャンプ / 空中でもう一度：ホーミング</span><span class="k">BOOST</span><span>ブースト（ゲージ消費）</span>`
          : `<span class="k">← → / A D</span><span>左右に移動（走りは自動）</span>
        <span class="k">SPACE / J</span><span>ジャンプ ／ 空中でもう一度：ホーミングアタック</span>
        <span class="k">SHIFT / K</span><span>ブースト（リーフを集めてゲージを溜める）</span>
        <span class="k">↓ / S</span><span>ブレーキ</span>
        <span class="k">ジャンプ台の後 ↑↓←→</span><span>トリック！</span>
        <span class="k">ESC / P</span><span>ポーズ</span>`}
      </div>
      <div class="opts">
        <span style="align-self:center">画質</span>
        ${['low', 'mid', 'high'].map((q) => `<button class="btn ${q === quality ? 'sel' : ''}" data-q="${q}">${{ low: '低', mid: '中', high: '高' }[q]}</button>`).join('')}
        <button class="btn" data-mute="1">${muted ? '🔇 音OFF' : '🔊 音ON'}</button>
        <button class="btn" data-softfx="1" title="画面のブラーや集中線を弱めます">${softFx ? '🌙 演出ひかえめ' : '⚡ 演出フル'}</button>
      </div>
      ${best ? `<div class="stage-card">BEST  ${best}</div>` : ''}
      ${touch ? '<div class="rotate-hint">📱 横向きで遊ぶのがおすすめ！</div>' : ''}
      <div class="credit">© 2026 たぬ ・ MIT License</div>`;
    this.title.classList.remove('hidden');
    this.title.onclick = (e) => {
      const q = e.target.closest('[data-q]');
      if (q) { e.stopPropagation(); onQuality(q.dataset.q); this.title.querySelectorAll('[data-q]').forEach((b) => b.classList.toggle('sel', b === q)); return; }
      const m = e.target.closest('[data-mute]');
      if (m) { e.stopPropagation(); const now = onMute(); m.textContent = now ? '🔇 音OFF' : '🔊 音ON'; return; }
      const f = e.target.closest('[data-softfx]');
      if (f) { e.stopPropagation(); const now = onSoftFx(); f.textContent = now ? '🌙 演出ひかえめ' : '⚡ 演出フル'; return; }
      onStart();
    };
  }

  hideTitle() { this.title.classList.add('hidden'); this.title.onclick = null; }

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
      ${this.isTouch ? '' : '<div class="stage-card">ENTER / R：リトライ　ESC：タイトルへ</div>'}
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
  showPause({ onResume, onRestart, onTitle }) {
    this.pause.innerHTML = `<div class="ttl">PAUSE</div><div class="col">
      <button class="btn big" data-a="resume">RESUME</button>
      <button class="btn big" data-a="restart">RESTART</button>
      <button class="btn big" data-a="title">TITLE</button></div>
      ${this.isTouch ? '' : '<div class="stage-card">ESC / ENTER：再開　R：リスタート</div>'}`;
    this.pause.classList.remove('hidden');
    this.pause.onclick = (e) => {
      const a = e.target.closest('[data-a]');
      if (!a) return;
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
      sid = e.pointerId; sx = e.clientX; sy = e.clientY;
      pad.setPointerCapture(e.pointerId);
      const r = pad.getBoundingClientRect();
      stick.style.display = 'block';
      stick.style.left = `${sx - r.left - 60}px`; stick.style.top = `${sy - r.top - 60}px`;
      knob.style.transform = '';
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== sid) return;
      const dx = Math.max(-50, Math.min(50, e.clientX - sx));
      inp.touch.steer = Math.abs(dx) < 6 ? 0 : dx / 50;
      knob.style.transform = `translateX(${dx}px)`;
    });
    const end = (e) => { if (e.pointerId !== sid) return; sid = null; inp.touch.steer = 0; stick.style.display = 'none'; };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    t.querySelectorAll('.tbtn').forEach((b) => {
      const name = b.dataset.b;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.classList.add('down');
        if (name === 'pause') { inp.press('pause'); return; }
        inp.touch[name] = true;
        inp.press(name === 'brake' ? 'down' : name);
      });
      const up = () => { b.classList.remove('down'); if (name !== 'pause') inp.touch[name] = false; };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
    });
  }

  showTouch(on) {
    const t = on && this.isTouch;
    this.touchEl.classList.toggle('on', t);
    this.root.classList.toggle('touching', t);
  }
}
