// Test helpers exposed on window when ?debug or ?bot is present (used for automated play-testing).
export function installDebugTools(game) {
  const EVENTS = ['hurt', 'death', 'checkpoint', 'homingHit', 'railLand', 'ramp', 'spring', 'dashRing',
    'truckIntro', 'truckHit', 'truckDown', 'goal', 'trickFinish', 'carSmash', 'railEnd'];
  /** Run the simulation headlessly for `secs`, logging every `every` seconds plus key events. */
  window.__run = async (secs, every = 2) => {
    const g = game;
    g.debugPaused = true;
    if (g.state === 'title') await g.startRun();
    const log = [], ev = [];
    const offs = EVENTS.map((n) => g.events.on(n, () => ev.push(`${g.runTime.toFixed(1)}:${n}@${g.player.mainS.toFixed(0)}`)));
    let last = -1;
    g.simulate(secs, 1 / 60, (t) => {
      const p = g.player;
      const k = Math.floor(t / every);
      if (k !== last) {
        last = k;
        log.push([t.toFixed(1), g.state, p.state, p.mainS.toFixed(0), p.speed.toFixed(0), 'h' + p.mainH.toFixed(1),
          'x' + p.mainX.toFixed(1), 'L' + p.leaves, g.level.main.zoneName(p.mainS)].join(' '));
      }
    });
    offs.forEach((f) => f());
    return log.join('\n') + '\n---\n' + ev.join('  ');
  };
  /** Restart at distance s with initial speed v, advance through the countdown. */
  window.__start = async (s, v = 0) => {
    const g = game;
    g.debugPaused = true;
    g.params.set('s', String(s));
    await g.startRun();
    g.simulate(3.7);
    g.player.v = v;
  };
  window.__shot = () => new Promise((r) => setTimeout(() => { game.frame(0.0001); r('ok'); }, 250));
}
