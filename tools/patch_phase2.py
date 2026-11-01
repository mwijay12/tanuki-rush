#!/usr/bin/env python3
"""Phase 2 wiring: haptics on gameplay events, wake-lock during runs, streak
reminder scheduling, and a haptics toggle in Settings.
Run from repo root:  python3 tools/patch_phase2.py
"""
from __future__ import annotations
import os, sys

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tanuki-rush", "src")
EDITS: list[tuple[str, str, str]] = []
def edit(rel, old, new): EDITS.append((rel, old, new))

G = "Game.js"
H = "ui/HUD.js"

# ---- import
edit(G, "import { tickStreak, activeStreak, dailyGoal, tierInfo, todayStr } from './progression.js';",
        "import { tickStreak, activeStreak, dailyGoal, tierInfo, todayStr } from './progression.js';\n"
        "import { haptic, keepAwake, scheduleStreakReminder } from './platform.js';")

# ---- haptics on events (reuse the existing event bus)
edit(G, "    ev.on('jump', () => A().play('jump'));",
        "    ev.on('jump', () => { A().play('jump'); haptic('light'); });")
edit(G, "    ev.on('homing', () => A().play('homing'));",
        "    ev.on('homing', () => { A().play('homing'); haptic('medium'); });")
edit(G, "    ev.on('enemyDown', () => { A().play('enemyPop'); this.enemiesDown++; });",
        "    ev.on('enemyDown', () => { A().play('enemyPop'); this.enemiesDown++; haptic('medium'); });")
edit(G, "    ev.on('truckHit', () => { A().play('crash'); this.rig.shake(1.2, 0.5); this.input.rumble(1, 1, 400); });",
        "    ev.on('truckHit', () => { A().play('crash'); this.rig.shake(1.2, 0.5); this.input.rumble(1, 1, 400); haptic('heavy'); });")

# ---- wake lock + streak reminder on run start
edit(G, "    this.streak = tickStreak(this.save); this._writeSave();\n    this.dailyGoal = dailyGoal();",
        "    this.streak = tickStreak(this.save); this._writeSave();\n"
        "    this.dailyGoal = dailyGoal();\n"
        "    keepAwake(true);\n"
        "    scheduleStreakReminder(this.streak);")

# ---- release wake lock when a run ends (results)
edit(G, "    this._writeSave();\n    this.hud.showHUD(false);\n    this.hud.showResults({ time: t, leaves: this.player.leaves, enemies: this.enemiesDown, score, timeBonus, leafBonus, total, rank, newRecord,",
        "    this._writeSave();\n    keepAwake(false);\n    this.hud.showHUD(false);\n    this.hud.showResults({ time: t, leaves: this.player.leaves, enemies: this.enemiesDown, score, timeBonus, leafBonus, total, rank, newRecord,")

# ---- Settings: expose a haptics toggle. Game passes bindings; HUD renders it.
edit(G, "  _openSettings() {\n    this.hud.showSettings({ ...this._settingsBindings(), onClose: () => this.hud.hideSettings() });\n  }",
        "  _openSettings() {\n"
        "    this.hud.showSettings({\n"
        "      ...this._settingsBindings(),\n"
        "      haptics: hapticsEnabled(),\n"
        "      onHaptics: () => { const on = !hapticsEnabled(); setHaptics(on); if (on) haptic('select'); return on; },\n"
        "      onClose: () => this.hud.hideSettings(),\n"
        "    });\n  }")
edit(G, "import { haptic, keepAwake, scheduleStreakReminder } from './platform.js';",
        "import { haptic, keepAwake, scheduleStreakReminder, hapticsEnabled, setHaptics } from './platform.js';")

# ---- HUD settings: accept + render haptics row
edit(H, "  showSettings({ quality, onQuality, muted, onMute, softFx, onSoftFx, onClose }) {",
        "  showSettings({ quality, onQuality, muted, onMute, softFx, onSoftFx, onClose, haptics = null, onHaptics = () => false }) {")
edit(H,
"""        <div class="set-row"><span class="set-label">STEER SENSITIVITY<span class="set-hint">touch only</span></span>
          <span class="set-ctl"><button class="btn" data-sens="-1">−</button><button class="btn" data-sensval="1">${sensLabel(this.steerDiv)}</button><button class="btn" data-sens="1">+</button></span></div>
      </div>""",
"""        <div class="set-row"><span class="set-label">STEER SENSITIVITY<span class="set-hint">touch only</span></span>
          <span class="set-ctl"><button class="btn" data-sens="-1">−</button><button class="btn" data-sensval="1">${sensLabel(this.steerDiv)}</button><button class="btn" data-sens="1">+</button></span></div>
        ${haptics === null ? '' : `<div class="set-row"><span class="set-label">HAPTICS<span class="set-hint">vibration</span></span>
          <span class="set-ctl"><button class="btn" data-haptics="1">${haptics ? 'ON' : 'OFF'}</button></span></div>`}
      </div>""")
edit(H,
"""      const s = e.target.closest('[data-sens]');""",
"""      const h = e.target.closest('[data-haptics]');
      if (h) { e.stopPropagation(); h.textContent = onHaptics() ? 'ON' : 'OFF'; return; }
      const s = e.target.closest('[data-sens]');""")

def main():
    fails = 0
    for rel, old, new in EDITS:
        p = os.path.join(SRC, rel)
        s = open(p, encoding="utf-8").read()
        if s.count(old) != 1:
            print(f"  {'MISS' if old not in s else 'MULTI'}  {rel}: {old[:58]!r}"); fails += 1; continue
        open(p, "w", encoding="utf-8").write(s.replace(old, new, 1)); print(f"  ok   {rel}")
    print("MISSES:", fails); return 1 if fails else 0

if __name__ == "__main__":
    sys.exit(main())
