import { clamp } from './Events.js';

// Simple autopilot used for automated play-testing (?bot) — collects leaves,
// dodges parked cars, attacks drones and chains homing attacks.
export class Bot {
  constructor(game) {
    this.game = game;
    this.jumpHold = 0;
    this.cool = 0;
  }

  update(dt) {
    const g = this.game, p = g.player, inp = g.input, objs = g.objects;
    const ps = p.mainS;
    this.cool = Math.max(0, this.cool - dt);
    let targetX = 0;
    // follow the nearest leaf ahead
    let best = null;
    for (const l of objs.leaves) {
      if (!l.alive || l.s < ps + 4) continue;
      if (l.s > ps + 45) break;
      if ((l.h ?? 1) > 3) continue;
      best = l; break;
    }
    if (best && best.x !== undefined) targetX = best.x;
    // dodge parked cars ahead
    for (const c of objs.cars) {
      if (c.state !== 'parked' || c.s < ps - 2 || c.s > ps + 55) continue;
      if (Math.abs(targetX - c.x) < c.halfW + 1.6) targetX = c.x > 0 ? c.x - c.halfW - 2.2 : c.x + c.halfW + 2.2;
    }
    let jump = false;
    // attack drones in the way
    for (const e of objs.enemies) {
      if (!e.alive || e.s < ps || e.s > ps + 16) continue;
      if (p.state === 'ground' && Math.abs(p.mainX - e.x) < 2.6 && e.s - ps < 12 && e.s - ps > 5) jump = true;
      if (Math.abs(targetX - e.x) < 2.5 && p.state === 'ground' && !jump) targetX = e.x;
    }
    // homing: press in the air whenever a target is locked
    if (p.state === 'air' && p.homingTarget && p.canAirAction && this.cool <= 0 && p.airTime > 0.12) { jump = true; this.cool = 0.25; }
    if (jump && this.cool <= 0 && p.state === 'ground') this.cool = 0.4;
    if (jump) inp.press('jump');
    inp.touch.steer = clamp((targetX - p.mainX) * 0.35, -1, 1);
    inp.touch.jump = p.state === 'air' && p.airTime < 0.2;
    // boost on the ground when the gauge is healthy
    inp.touch.boost = p.state === 'ground' && p.boostGauge > 0.45 && !p.onBoard;
  }
}
