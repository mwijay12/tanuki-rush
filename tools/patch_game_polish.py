#!/usr/bin/env python3
"""Second polish pass for the bundled game.

  * First-run onboarding (three quick cards, shown once)
  * Credits screen: "Made in Tanzania by Mwijay Davie" + original author
  * Settings: steer sensitivity for touch, plus a credits entry
  * Title branding for this edition

Run from the repo root:  python3 tools/patch_game_polish.py
"""
from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tanuki-rush", "src")

EDITS: list[tuple[str, str, str]] = []


def edit(rel: str, old: str, new: str) -> None:
    EDITS.append((rel, old, new))


HUD = "ui/HUD.js"
GAME = "Game.js"

# ------------------------------------------------- 1. touch sensitivity state
edit(HUD, """    this._last = {};
    this._buildTouch();""",
          """    this._last = {};
    // Touch steering divisor: smaller = more sensitive. Persisted on its own so
    // the game's save schema does not need to change.
    this.steerDiv = Number(localStorage.getItem('tanuki_steerDiv')) || 50;
    this._buildTouch();""")

edit(HUD, "inp.touch.steer = Math.abs(dx) < 6 ? 0 : dx / 50;",
          "inp.touch.steer = Math.abs(dx) < 6 ? 0 : dx / this.steerDiv;")

# ------------------------------------------------------ 2. title branding + CTAs
edit(HUD, '<span class="l2">DOWNHILL ACTION</span></div>',
          '<span class="l2">MOBILE EDITION · MADE IN TZ</span></div>')

edit(HUD, """        <button class="btn" data-settings="1">⚙ SETTINGS</button>""",
          """        <button class="btn" data-settings="1">⚙ SETTINGS</button>
        <button class="btn" data-credits="1">★ CREDITS</button>""")

edit(HUD, """      if (e.target.closest('[data-settings]')) { e.stopPropagation(); onSettings(); return; }
      onStart();""",
          """      if (e.target.closest('[data-settings]')) { e.stopPropagation(); onSettings(); return; }
      if (e.target.closest('[data-credits]')) { e.stopPropagation(); this.showCredits(); return; }
      onStart();""")

# ------------------------------------------------------------ 3. richer settings
edit(HUD, """  showSettings({ quality, onQuality, muted, onMute, softFx, onSoftFx, onClose }) {
    const qLabel = { low: 'LOW', mid: 'MID', high: 'HIGH' };""",
          """  showSettings({ quality, onQuality, muted, onMute, softFx, onSoftFx, onClose }) {
    const qLabel = { low: 'LOW', mid: 'MID', high: 'HIGH' };
    const sensLabel = (d) => (d <= 32 ? 'HIGH' : d >= 70 ? 'LOW' : 'MID');
    const sensStep = (dir) => {
      const steps = [26, 50, 78];
      const i = steps.indexOf(this.steerDiv);
      const next = steps[Math.max(0, Math.min(steps.length - 1, (i === -1 ? 1 : i) + dir))];
      this.steerDiv = next;
      localStorage.setItem('tanuki_steerDiv', String(next));
      return sensLabel(next);
    };""")

edit(HUD, """        <div class="set-row"><span class="set-label">EFFECTS</span>
          <span class="set-ctl"><button class="btn" data-softfx="1">${softFx ? 'REDUCED' : 'FULL'}</button></span></div>
      </div>""",
          """        <div class="set-row"><span class="set-label">EFFECTS</span>
          <span class="set-ctl"><button class="btn" data-softfx="1">${softFx ? 'REDUCED' : 'FULL'}</button></span></div>
        <div class="set-row"><span class="set-label">STEER SENSITIVITY<span class="set-hint">touch only</span></span>
          <span class="set-ctl"><button class="btn" data-sens="-1">−</button><button class="btn" data-sensval="1">${sensLabel(this.steerDiv)}</button><button class="btn" data-sens="1">+</button></span></div>
      </div>""")

edit(HUD, """      if (f) { e.stopPropagation(); f.textContent = onSoftFx() ? 'REDUCED' : 'FULL'; return; }
      if (e.target.closest('[data-close]')) { e.stopPropagation(); onClose(); }""",
          """      if (f) { e.stopPropagation(); f.textContent = onSoftFx() ? 'REDUCED' : 'FULL'; return; }
      const s = e.target.closest('[data-sens]');
      if (s) {
        e.stopPropagation();
        const label = sensStep(Number(s.dataset.sens));
        this.settings.querySelector('[data-sensval]').textContent = label;
        return;
      }
      if (e.target.closest('[data-credits]')) { e.stopPropagation(); this.showCredits(true); return; }
      if (e.target.closest('[data-close]')) { e.stopPropagation(); onClose(); }""")

# ------------------------------------------------------ 4. credits + onboarding
edit(HUD, """  hideSettings() { this.settings.classList.add('hidden'); this.settings.onclick = null; }
  get settingsOpen() { return !this.settings.classList.contains('hidden'); }""",
          """  hideSettings() { this.settings.classList.add('hidden'); this.settings.onclick = null; }
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
  }""")

edit(HUD, """    this.settings = el('div', 'screen settings hidden');
    root.appendChild(this.settings);""",
          """    this.settings = el('div', 'screen settings hidden');
    root.appendChild(this.settings);
    this.credits = el('div', 'screen settings credits hidden');
    root.appendChild(this.credits);
    this.intro = el('div', 'screen settings intro hidden');
    root.appendChild(this.intro);""")

# --------------------------------------------- 5. show the intro on first launch
edit(GAME, "    this.audio.playMusic('title');",
           """    this.audio.playMusic('title');
    if (!localStorage.getItem('tanuki_intro')) {
      this.state = 'title';
      this.hud.showIntro(() => localStorage.setItem('tanuki_intro', '1'));
    }""")


def main() -> int:
    failures = 0
    done: dict[str, int] = {}
    for rel, old, new in EDITS:
        path = os.path.join(SRC, rel)
        text = open(path, encoding="utf-8").read()
        if text.count(old) != 1:
            print(f"  {'MISS' if old not in text else 'MULTI'}  {rel}: {old[:60]!r}")
            failures += 1
            continue
        open(path, "w", encoding="utf-8").write(text.replace(old, new, 1))
        done[rel] = done.get(rel, 0) + 1
    for rel, n in sorted(done.items()):
        print(f"  {n} edits  src/{rel}")
    print("MISSES:", failures)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
