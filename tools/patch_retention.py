#!/usr/bin/env python3
"""Wire the offline retention features (streak, daily goal, next-tier bar)
into Game.js and HUD.js. Run from repo root:
    python3 tools/patch_retention.py
"""
from __future__ import annotations
import os, sys

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tanuki-rush", "src")
EDITS: list[tuple[str, str, str]] = []
def edit(rel, old, new): EDITS.append((rel, old, new))

G = "Game.js"
H = "ui/HUD.js"

# ---- Game.js: import
edit(G, "import { HUD, formatTime } from './ui/HUD.js';",
        "import { HUD, formatTime } from './ui/HUD.js';\n"
        "import { tickStreak, activeStreak, dailyGoal, tierInfo, todayStr } from './progression.js';")

# ---- Game.js: tick streak + lock today's goal when a run actually starts
edit(G, "    this.audio.play('uiSelect');\n    this.resetRun();",
        "    this.audio.play('uiSelect');\n"
        "    this.streak = tickStreak(this.save); this._writeSave();\n"
        "    this.dailyGoal = dailyGoal();\n"
        "    this.resetRun();")

# ---- Game.js: results -> compute tier, daily goal, streak, persist
edit(G,
"""    this._writeSave();
    this.hud.showHUD(false);
    this.hud.showResults({ time: t, leaves: this.player.leaves, enemies: this.enemiesDown, score, timeBonus, leafBonus, total, rank, newRecord }, {""",
"""    const tier = tierInfo(total);
    const goal = this.dailyGoal || dailyGoal();
    const goalRun = { leaves: this.player.leaves, enemies: this.enemiesDown, time: t, total, rank };
    const goalAlready = this.save.dailyDone === goal.dateStr;
    const goalDone = goal.test(goalRun);
    const goalJustDone = goalDone && !goalAlready;
    if (goalJustDone && !testRun) { this.save.dailyDone = goal.dateStr; }
    this._writeSave();
    this.hud.showHUD(false);
    this.hud.showResults({ time: t, leaves: this.player.leaves, enemies: this.enemiesDown, score, timeBonus, leafBonus, total, rank, newRecord,
      tier, streak: this.streak || activeStreak(this.save), goal: { label: goal.label, done: goalDone, justDone: goalJustDone } }, {""")

# ---- Game.js: title gets streak + daily goal
edit(G,
"      best: this.save.bestTime ? `${formatTime(this.save.bestTime)}  ／  ${this.save.bestScore || 0} pts  ／  RANK ${this.save.bestRank || '-'}` : '',",
"      best: this.save.bestTime ? `${formatTime(this.save.bestTime)}  ／  ${this.save.bestScore || 0} pts  ／  RANK ${this.save.bestRank || '-'}` : '',\n"
"      streak: activeStreak(this.save),\n"
"      daily: { label: dailyGoal().label, done: this.save.dailyDone === todayStr() },")

# ---- HUD.js: showTitle signature
edit(H,
"  showTitle({ onStart, quality, onQuality, best, muted, onMute, softFx = false, onSoftFx = () => false, onSettings = () => {} }) {",
"  showTitle({ onStart, quality, onQuality, best, muted, onMute, softFx = false, onSoftFx = () => false, onSettings = () => {}, streak = 0, daily = null }) {")

# ---- HUD.js: title shows streak + daily goal under the press prompt
edit(H,
"""      <div class="press">${touch ? 'TAP TO START' : 'PRESS ENTER / CLICK'}</div>""",
"""      <div class="press">${touch ? 'TAP TO START' : 'PRESS ENTER / CLICK'}</div>
      <div class="meta-row">
        ${streak > 0 ? `<span class="chip streak">🔥 ${streak}-DAY STREAK</span>` : ''}
        ${daily ? `<span class="chip daily ${daily.done ? 'done' : ''}">${daily.done ? '✓ DAILY DONE' : '◆ DAILY'} · ${daily.label}</span>` : ''}
      </div>""")

# ---- HUD.js: results get next-tier bar + daily banner + streak, before actions
edit(H,
"""      <div class="res-actions">
        <button class="btn big" data-a="retry">RETRY</button>
        <button class="btn big" data-a="title">TITLE</button>
      </div>""",
"""      ${r.tier && r.tier.next ? `<div class="next-tier">
        <div class="nt-head"><span>NEXT RANK ${r.tier.next}</span><span>${r.tier.need.toLocaleString()} pts to go</span></div>
        <div class="nt-bar"><i style="width:${Math.round(r.tier.progress * 100)}%"></i></div>
      </div>` : (r.tier ? '<div class="next-tier maxed">★ MAX RANK — you topped the chart</div>' : '')}
      ${r.goal ? `<div class="daily-banner ${r.goal.done ? 'done' : ''}">${r.goal.justDone ? '🎉 DAILY GOAL COMPLETE' : r.goal.done ? '✓ DAILY GOAL' : '◆ DAILY GOAL'} · ${r.goal.label}</div>` : ''}
      ${r.streak > 0 ? `<div class="streak-line">🔥 ${r.streak}-day streak — come back tomorrow to keep it alive</div>` : ''}
      <div class="res-actions">
        <button class="btn big" data-a="retry">RETRY</button>
        <button class="btn big" data-a="title">TITLE</button>
      </div>""")

def main():
    fails = 0
    for rel, old, new in EDITS:
        p = os.path.join(SRC, rel)
        s = open(p, encoding="utf-8").read()
        if s.count(old) != 1:
            print(f"  {'MISS' if old not in s else 'MULTI'}  {rel}: {old[:60]!r}")
            fails += 1; continue
        open(p, "w", encoding="utf-8").write(s.replace(old, new, 1))
        print(f"  ok   {rel}")
    print("MISSES:", fails)
    return 1 if fails else 0

if __name__ == "__main__":
    sys.exit(main())
