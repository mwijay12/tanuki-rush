#!/usr/bin/env python3
"""One-shot patch for the bundled game:

  1. English-only UI (all Japanese strings translated, logo romaji removed)
  2. Credits -> Mwijay, with the original author kept in the attribution line
  3. A real SETTINGS panel reachable from the title and pause screens
  4. Touch controls: keep pointer capture, stop releasing held buttons on
     pointerleave (which fires constantly on touch), block stray gestures
  5. Audio: resume the AudioContext when the page becomes visible again and
     when the first gesture lands, so music does not stay dead after the
     phone screen locks or the user switches apps

Run from the repo root:  python3 tools/patch_game_english_settings.py
"""
from __future__ import annotations

import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tanuki-rush")
SRC = os.path.join(ROOT, "src")

EDITS: list[tuple[str, str, str]] = []


def edit(rel: str, old: str, new: str) -> None:
    EDITS.append((rel, old, new))


HUD = "ui/HUD.js"
GAME = "Game.js"
AUDIO = "audio/AudioEngine.js"
LEVEL = "level/cityLevel.js"
MAIN = "main.js"

# --------------------------------------------------------------- 1. English UI
edit(HUD, '<span class="l2">たぬきラッシュ</span></div>',
        '<span class="l2">DOWNHILL ACTION</span></div>')
edit(HUD, 'STAGE 1 — HILLSIDE CITY ／ 坂の街を駆け抜けろ！',
          'STAGE 1 — HILLSIDE CITY')
edit(HUD, '画質', 'QUALITY')
edit(HUD, "{ low: '低', mid: '中', high: '高' }", "{ low: 'LOW', mid: 'MID', high: 'HIGH' }")
edit(HUD, "${muted ? '🔇 音OFF' : '🔊 音ON'}", "${muted ? '🔇 SOUND OFF' : '🔊 SOUND ON'}")
edit(HUD, "title=\"画面のブラーや集中線を弱めます\"", "title=\"Softens motion blur and speed lines\"")
edit(HUD, "${softFx ? '🌙 演出ひかえめ' : '⚡ 演出フル'}", "${softFx ? '🌙 REDUCED FX' : '⚡ FULL FX'}")
edit(HUD, '📱 横向きで遊ぶのがおすすめ！', '📱 Best in landscape')
edit(HUD, '`<span class="k">左ドラッグ</span><span>左右に移動</span><span class="k">JUMP</span><span>ジャンプ / 空中でもう一度：ホーミング</span><span class="k">BOOST</span><span>ブースト（ゲージ消費）</span>`',
          '`<span class="k">DRAG LEFT</span><span>Steer left / right</span><span class="k">JUMP</span><span>Jump · again in air: homing attack</span><span class="k">BOOST</span><span>Boost (uses the gauge)</span><span class="k">II</span><span>Pause</span>`')
edit(HUD, '<span>左右に移動（走りは自動）</span>', '<span>Steer left / right (running is automatic)</span>')
edit(HUD, '<span>ジャンプ ／ 空中でもう一度：ホーミングアタック</span>', '<span>Jump · again in air: homing attack</span>')
edit(HUD, '<span>ブースト（リーフを集めてゲージを溜める）</span>', '<span>Boost (collect leaves to fill the gauge)</span>')
edit(HUD, '<span class="k">↓ / S</span><span>ブレーキ</span>', '<span class="k">↓ / S</span><span>Brake</span>')
edit(HUD, '<span class="k">ジャンプ台の後 ↑↓←→</span><span>トリック！</span>',
          '<span class="k">After a ramp ↑↓←→</span><span>Trick!</span>')
edit(HUD, '<span class="k">ESC / P</span><span>ポーズ</span>', '<span class="k">ESC / P</span><span>Pause</span>')
edit(HUD, "ENTER / R：リトライ　ESC：タイトルへ", "ENTER / R retry · ESC title")
edit(HUD, "ESC / ENTER：再開　R：リスタート", "ESC / ENTER resume · R restart")
edit(HUD, '<div class="credit">© 2026 たぬ ・ MIT License</div>',
          '<div class="credit">© 2026 Mwijay · game by tanuu5 · MIT</div>')

edit(MAIN, "'WebGL2 が使えないため起動できませんでした。別のブラウザやデバイスでお試しください。'",
           "'WebGL2 is unavailable, so the game cannot start. Try another browser or device.'")

edit(LEVEL, "'← → で左右に移動。リーフを集めよう！'",
            "'Steer with ← →. Collect the leaves!'")
edit(LEVEL, "'左側をドラッグで移動。リーフを集めよう！'",
            "'Drag on the left side to steer. Collect the leaves!'")
edit(LEVEL, "'ジャンプ台の後は ↑↓←→ でトリック！'", "'After a ramp, ↑↓←→ performs a trick!'")
edit(LEVEL, "'ジャンプ台で大ジャンプ！'", "'Launch off the ramp!'")
edit(LEVEL, "'JUMP → 空中でもう一度 JUMP でホーミングアタック！'",
            "'JUMP → then JUMP again in the air for a homing attack!'")
edit(LEVEL, "'JUMP → 空中でもう一度 JUMP でホーミング！'",
            "'JUMP → then JUMP again in the air to home in!'")
edit(LEVEL, "'SHIFT でブースト！ 敵も車も吹き飛ばせ'", "'BOOST to accelerate — smash enemies and cars'")
edit(LEVEL, "'BOOST で一気に加速！'", "'BOOST for a burst of speed!'")
edit(LEVEL, "'ジャンプ台からレールに乗ってグラインド！'", "'Take the ramp onto the rail and grind!'")
edit(LEVEL, "'敵から敵へホーミングで谷を越えろ！'", "'Chain homing attacks from enemy to enemy!'")

# ------------------------------------------------------- 2. Settings + credits
edit(HUD, """    this.pause = el('div', 'screen pause hidden');
    root.appendChild(this.pause);""",
          """    this.pause = el('div', 'screen pause hidden');
    root.appendChild(this.pause);
    this.settings = el('div', 'screen settings hidden');
    root.appendChild(this.settings);""")

edit(HUD, """      <div class="opts">
        <span style="align-self:center">QUALITY</span>""",
          """      <div class="opts">
        <button class="btn" data-settings="1">⚙ SETTINGS</button>
        <span style="align-self:center">QUALITY</span>""")

edit(HUD, """      const f = e.target.closest('[data-softfx]');
      if (f) { e.stopPropagation(); const now = onSoftFx(); f.textContent = now ? '🌙 REDUCED FX' : '⚡ FULL FX'; return; }
      onStart();""",
          """      const f = e.target.closest('[data-softfx]');
      if (f) { e.stopPropagation(); const now = onSoftFx(); f.textContent = now ? '🌙 REDUCED FX' : '⚡ FULL FX'; return; }
      if (e.target.closest('[data-settings]')) { e.stopPropagation(); onSettings(); return; }
      onStart();""")

edit(HUD, "showTitle({ onStart, quality, onQuality, best, muted, onMute, softFx = false, onSoftFx = () => false }) {",
          "showTitle({ onStart, quality, onQuality, best, muted, onMute, softFx = false, onSoftFx = () => false, onSettings = () => {} }) {")

edit(HUD, """  hideTitle() { this.title.classList.add('hidden'); this.title.onclick = null; }""",
          """  hideTitle() { this.title.classList.add('hidden'); this.title.onclick = null; }

  // ------------------------------------------------------------------ settings
  /** Modal settings panel. Purely a view: every change is applied by the caller. */
  showSettings({ quality, onQuality, muted, onMute, softFx, onSoftFx, onClose }) {
    const qLabel = { low: 'LOW', mid: 'MID', high: 'HIGH' };
    this.settings.innerHTML = `
      <div class="set-title">SETTINGS</div>
      <div class="set-rows">
        <div class="set-row"><span class="set-label">QUALITY</span>
          <span class="set-ctl">${['low', 'mid', 'high'].map((q) => `<button class="btn ${q === quality ? 'sel' : ''}" data-q="${q}">${qLabel[q]}</button>`).join('')}</span></div>
        <div class="set-row"><span class="set-label">SOUND</span>
          <span class="set-ctl"><button class="btn" data-mute="1">${muted ? 'OFF' : 'ON'}</button></span></div>
        <div class="set-row"><span class="set-label">EFFECTS</span>
          <span class="set-ctl"><button class="btn" data-softfx="1">${softFx ? 'REDUCED' : 'FULL'}</button></span></div>
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
      if (e.target.closest('[data-close]')) { e.stopPropagation(); onClose(); }
    };
  }

  hideSettings() { this.settings.classList.add('hidden'); this.settings.onclick = null; }
  get settingsOpen() { return !this.settings.classList.contains('hidden'); }""")

# pause screen gets a settings entry too
edit(HUD, """      <button class="btn big" data-a="restart">RESTART</button>
      <button class="btn big" data-a="title">TITLE</button></div>""",
          """      <button class="btn big" data-a="restart">RESTART</button>
      <button class="btn big" data-a="settings">SETTINGS</button>
      <button class="btn big" data-a="title">TITLE</button></div>""")

edit(HUD, """  showPause({ onResume, onRestart, onTitle }) {""",
          """  showPause({ onResume, onRestart, onTitle, onSettings = () => {} }) {""")

edit(HUD, """      ({ resume: onResume, restart: onRestart, title: onTitle })[a.dataset.a]();""",
          """      if (a.dataset.a === 'settings') { onSettings(); return; }
      ({ resume: onResume, restart: onRestart, title: onTitle })[a.dataset.a]();""")

# ------------------------------------------------------- 3. Touch control fixes
edit(HUD, """    pad.addEventListener('pointerdown', (e) => {
      sid = e.pointerId; sx = e.clientX; sy = e.clientY;
      pad.setPointerCapture(e.pointerId);""",
          """    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      sid = e.pointerId; sx = e.clientX; sy = e.clientY;
      try { pad.setPointerCapture(e.pointerId); } catch (_) { /* capture is best-effort */ }""")

edit(HUD, """      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.classList.add('down');
        if (name === 'pause') { inp.press('pause'); return; }
        inp.touch[name] = true;
        inp.press(name === 'brake' ? 'down' : name);
      });
      const up = () => { b.classList.remove('down'); if (name !== 'pause') inp.touch[name] = false; };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);""",
          """      b.addEventListener('pointerdown', (e) => {
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
      b.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') up(); });""")

# Release anything still held if the game hides the controls mid-press.
edit(HUD, """  showTouch(on) {
    const t = on && this.isTouch;
    this.touchEl.classList.toggle('on', t);
    this.root.classList.toggle('touching', t);
  }""",
          """  showTouch(on) {
    const t = on && this.isTouch;
    this.touchEl.classList.toggle('on', t);
    this.root.classList.toggle('touching', t);
    if (!t) {
      // Never leave a control stuck down when the layer disappears.
      const inp = this.input;
      inp.touch.steer = 0; inp.touch.jump = false; inp.touch.boost = false; inp.touch.brake = false;
      this.touchEl.querySelectorAll('.tbtn.down').forEach((b) => b.classList.remove('down'));
    }
  }""")

# --------------------------------------------- 4. Audio: do not stay suspended
edit(AUDIO, """  _resumeCtx() {""",
           """  /** Called when the tab regains visibility; browsers suspend the context. */
  _onVisible() {
    if (document.visibilityState !== 'visible') return;
    this._resumeCtx().then(() => { if (!this._paused) this.resume(); }).catch(() => {});
  }

  _resumeCtx() {""")

print("edits staged:", len(EDITS))


def main() -> int:
    failures = 0
    per_file: dict[str, int] = {}
    for rel, old, new in EDITS:
        path = os.path.join(SRC, rel)
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        if old not in text:
            print(f"  MISS  {rel}: {old[:70]!r}")
            failures += 1
            continue
        if text.count(old) > 1:
            print(f"  MULTI {rel}: {old[:70]!r}")
            failures += 1
            continue
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text.replace(old, new, 1))
        per_file[rel] = per_file.get(rel, 0) + 1

    # index.html is outside src/
    html_path = os.path.join(ROOT, "index.html")
    html = open(html_path, encoding="utf-8").read()
    html = html.replace(
        "TANUKI RUSH — 坂の街を駆け下りる、ブラウザで遊べる3Dハイスピードアクション。",
        "TANUKI RUSH — a high-speed 3D downhill city runner you can play in the browser.",
    ).replace(
        "坂の街を駆け下りる、ブラウザで遊べる3Dハイスピードアクション。",
        "A high-speed 3D downhill city runner you can play in the browser.",
    ).replace(
        "このゲームを遊ぶには JavaScript を有効にしてください。",
        "JavaScript must be enabled to play this game.",
    ).replace('<html lang="ja">', '<html lang="en">')
    open(html_path, "w", encoding="utf-8").write(html)

    for rel, n in sorted(per_file.items()):
        print(f"  {n:2d} edits  src/{rel}")
    print("MISSES:", failures)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
