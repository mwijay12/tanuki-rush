// sfx.js — every one-shot sound effect, synthesized from scratch.
//
// Each entry receives a Voice (see voice.js): v.t = start time, v.p = pitch
// multiplier. Builders only create and schedule nodes; the engine handles
// volume, panning, voice limits and cleanup. All sounds are original designs.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** Max simultaneous voices per effect (default 3). Oldest voice is stolen. */
export const SFX_LIMITS = {
  leaf: 6, whoosh: 4, lockon: 2, uiMove: 2, uiSelect: 2, countdown: 2, go: 1,
  truckHorn: 1, crash: 2, rankReveal: 1, leafScatter: 2, boostStart: 2, jump: 2,
  land: 2, hurt: 2, death: 1, poof: 2, checkpoint: 2,
};

/**
 * Loudness trims (linear gain) so every effect sits at a consistent level in the mix.
 * Calibrated with an offline render (K-weighted loudness of the loudest 300 ms).
 */
export const SFX_GAIN = {
  jump: 2.1, homing: 1.25, lockon: 2.2, airdash: 2.2, land: 0.9, leaf: 1.7, leafScatter: 1.7,
  hurt: 1, enemyPop: 1, boostStart: 1, dashPanel: 1.6, spring: 1.1, ramp: 1, trick: 1.6,
  trickFinish: 1.5, dashRing: 1.6, railLand: 1.5, checkpoint: 1.4, countdown: 1.5, go: 1.1,
  death: 0.8, truckHorn: 1.3, crash: 1.1, carHit: 1.4, poof: 1.35, uiMove: 3, uiSelect: 2.2,
  rankReveal: 0.85, whoosh: 1.75,
};

export const SFX = {
  // Springy rising chirp + airy whoosh.
  jump(v) {
    const { t, p } = v;
    const g = v.env(0.3, 0.004, 0.05);
    const o = v.osc('triangle', 330 * p, t, t + 0.35);
    v.sweep(o.frequency, 330 * p, 1000 * p, t, 0.11);
    o.frequency.setTargetAtTime(930 * p, t + 0.11, 0.03); // tiny spring-back overshoot
    o.connect(g);
    const o2 = v.osc('sine', 660 * p, t, t + 0.35);
    v.sweep(o2.frequency, 660 * p, 2000 * p, t, 0.11);
    const g2 = v.gain(0.3);
    o2.connect(g2);
    g2.connect(g);
    v.whoosh(700 * p, 3400 * p, t, 0.12, 0.2, { q: 1.3, a: 0.01, tc: 0.04 });
  },

  // Homing attack: heavy dash whoosh, low punch and a rising zap.
  homing(v) {
    const { t, p } = v;
    const f = v.whoosh(500 * p, 3200 * p, t, 0.09, 0.5, { q: 0.9, a: 0.008, tc: 0.08 });
    f.frequency.setTargetAtTime(900 * p, t + 0.09, 0.08);
    v.boom(150 * p, 48, t, 0.5, 0.06);
    const z = v.osc('sawtooth', 200 * p, t, t + 0.4);
    v.sweep(z.frequency, 200 * p, 900 * p, t, 0.1);
    const lp = v.filter('lowpass', 2400, 1.5);
    z.connect(lp);
    lp.connect(v.env(0.13, 0.004, 0.05));
  },

  // Subtle target-lock blip.
  lockon(v) {
    const { t, p } = v;
    const o = v.osc('sine', 1800 * p, t, t + 0.22);
    v.sweep(o.frequency, 1800 * p, 2500 * p, t, 0.03);
    o.connect(v.env(0.15, 0.002, 0.025));
    const t2 = t + 0.045;
    const o2 = v.osc('square', 3600 * p, t2, t2 + 0.2);
    const lp = v.filter('lowpass', 6000);
    o2.connect(lp);
    lp.connect(v.env(0.035, 0.002, 0.02, t2));
  },

  // Short forward air dash: falling whoosh.
  airdash(v) {
    const { t, p } = v;
    v.whoosh(2600 * p, 650 * p, t, 0.14, 0.4, { q: 1.4, a: 0.006, tc: 0.05 });
    const o = v.osc('sine', 620 * p, t, t + 0.35);
    v.sweep(o.frequency, 620 * p, 280 * p, t, 0.15);
    o.connect(v.env(0.07, 0.005, 0.05));
  },

  // Soft landing thud.
  land(v) {
    const { t, p } = v;
    v.boom(140 * p, 55 * p, t, 0.5, 0.05);
    const n = v.noiseSrc(t, t + 0.25);
    const lp = v.filter('lowpass', 520 * p, 0.8);
    n.connect(lp);
    lp.connect(v.env(0.26, 0.002, 0.025));
  },

  // Golden leaf: one glassy "plink" with a pitch flick and a tiny leafy rustle.
  // Short and soft-edged so it stays pleasant at 10+ per second.
  leaf(v) {
    const { t, p } = v;
    const f = 1568 * p;
    v.bell(f, t, 0.2, 0.07, { ratio: 2, index: 0.7, flick: 0.94 });
    for (const [k, pk, tc] of [[2.76, 0.05, 0.03], [5.4, 0.025, 0.02]]) {
      const o = v.osc('sine', f * k, t, t + tc * 7 + 0.02);
      o.connect(v.env(pk, 0.001, tc));
    }
    const n = v.noiseSrc(t, t + 0.12);
    const bp = v.filter('bandpass', 5200, 1.2);
    n.connect(bp);
    bp.connect(v.env(0.05, 0.002, 0.012));
  },

  // Hurt: leaves scatter everywhere (descending pentatonic sparkle cascade).
  leafScatter(v) {
    const { t, p } = v;
    const scale = [2349, 1976, 1760, 1568, 1319, 1175, 988, 880];
    for (let i = 0; i < 10; i++) {
      const ti = t + i * 0.05 + Math.random() * 0.02;
      const f = scale[Math.min(scale.length - 1, Math.floor(i * 0.7 + Math.random() * 2))] * p;
      const pan = v.panner((Math.random() * 2 - 1) * 0.8);
      pan.connect(v.out);
      v.bell(f, ti, 0.14 * (1 - i * 0.06), 0.06, { ratio: 2, index: 0.9, dest: pan });
    }
    const n = v.noiseSrc(t, t + 0.9);
    const hp = v.filter('highpass', 6500, 0.8);
    n.connect(hp);
    hp.connect(v.envHold(0.05, 0.01, 0.45, 0.06));
  },

  // Damage: buzzy falling square, noise crack, body thump.
  hurt(v) {
    const { t, p } = v;
    const o = v.osc('square', 700 * p, t, t + 0.5);
    v.sweep(o.frequency, 700 * p, 170 * p, t, 0.25);
    const lfo = v.osc('square', 32, t, t + 0.5);
    const lg = v.gain(90 * p);
    lfo.connect(lg);
    lg.connect(o.frequency);
    const lp = v.filter('lowpass', 2600, 1);
    o.connect(lp);
    lp.connect(v.envHold(0.2, 0.004, 0.16, 0.05));
    const n = v.noiseSrc(t, t + 0.2);
    const hp = v.filter('highpass', 1500);
    n.connect(hp);
    hp.connect(v.env(0.3, 0.001, 0.03));
    v.boom(170 * p, 60, t, 0.4, 0.06);
  },

  // Robot drone explodes: pop + crunchy (bit-crushed) noise + metal tings.
  enemyPop(v) {
    const { t, p } = v;
    const o = v.osc('sine', 950 * p, t, t + 0.3);
    v.sweep(o.frequency, 950 * p, 110 * p, t, 0.06);
    o.connect(v.env(0.3, 0.001, 0.035));
    const n = v.noiseSrc(t, t + 0.7);
    const pre = v.gain(2.5);
    const cr = v.shaper('crunch');
    const lp = v.filter('lowpass', 6000, 1.2);
    v.sweep(lp.frequency, 6000 * p, 300, t, 0.3);
    n.connect(pre);
    pre.connect(cr);
    cr.connect(lp);
    lp.connect(v.env(0.36, 0.002, 0.07));
    for (const [f, pk] of [[1250, 0.06], [1873, 0.045]]) {
      const m = v.osc('square', f * p, t, t + 0.35);
      const bp = v.filter('bandpass', f * p * 2, 2);
      m.connect(bp);
      bp.connect(v.env(pk, 0.001, 0.04));
    }
    v.boom(95 * p, 40, t, 0.25, 0.09);
  },

  // Boost: sonic-boom crack, huge filtered whoosh, driven sub boom, turbine rise.
  boostStart(v) {
    const { t, p } = v;
    const c = v.noiseSrc(t, t + 0.2);
    const hp = v.filter('highpass', 1800);
    c.connect(hp);
    hp.connect(v.env(0.36, 0.001, 0.018));
    const n = v.noiseSrc(t, t + 1.8);
    const lp = v.filter('lowpass', 300, 1.1);
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(7000 * p, t + 0.22);
    lp.frequency.setTargetAtTime(1200, t + 0.22, 0.3);
    n.connect(lp);
    lp.connect(v.envHold(0.4, 0.03, 0.2, 0.22));
    const b = v.osc('sine', 95 * p, t, t + 1.4);
    v.sweep(b.frequency, 95 * p, 32, t, 0.5);
    const bg = v.gain(1.6);
    const drv = v.shaper('drive');
    b.connect(bg);
    bg.connect(drv);
    drv.connect(v.env(0.42, 0.003, 0.18));
    const s = v.osc('sawtooth', 170 * p, t, t + 1.2);
    v.sweep(s.frequency, 170 * p, 560 * p, t, 0.45);
    const slp = v.filter('lowpass', 1500, 2);
    s.connect(slp);
    slp.connect(v.envHold(0.1, 0.05, 0.25, 0.12));
    v.send(v.out, 0.2);
  },

  // Dash panel: electric zip (saw stack sweep + crackle).
  dashPanel(v) {
    const { t, p } = v;
    const bp = v.filter('bandpass', 500, 3);
    v.sweep(bp.frequency, 450 * p, 4200 * p, t, 0.14);
    const g = v.env(0.5, 0.003, 0.06);
    const mix = v.gain(1.2);
    mix.connect(bp);
    bp.connect(g);
    for (const [k, type] of [[1, 'sawtooth'], [1.498, 'sawtooth'], [0.5, 'square']]) {
      const o = v.osc(type, 260 * p * k, t, t + 0.5);
      v.sweep(o.frequency, 260 * p * k, 2600 * p * k, t, 0.14);
      o.connect(mix);
    }
    const n = v.noiseSrc(t, t + 0.45);
    const hp = v.filter('highpass', 5000);
    const am = v.gain(0);
    const lfo = v.osc('square', 45, t, t + 0.45);
    const depth = v.gain(0.5);
    lfo.connect(depth);
    depth.connect(am.gain);
    n.connect(hp);
    hp.connect(am);
    am.connect(v.env(0.18, 0.003, 0.06));
  },

  // Spring: "boing" with a decaying pitch wobble.
  spring(v) {
    const { t, p } = v;
    const dur = 0.5;
    const N = 96;
    const c1 = new Float32Array(N);
    const c2 = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const u = (i / (N - 1)) * dur;
      const f = 190 * p * (1 + 1.1 * (1 - Math.exp(-u / 0.12))) *
        (1 + 0.2 * Math.exp(-u / 0.14) * Math.sin(2 * Math.PI * 17 * u));
      c1[i] = f;
      c2[i] = f * 2.01;
    }
    const o = v.osc('triangle', c1[0], t, t + dur + 0.05);
    o.frequency.setValueCurveAtTime(c1, t, dur);
    const o2 = v.osc('sine', c2[0], t, t + dur + 0.05);
    o2.frequency.setValueCurveAtTime(c2, t, dur);
    const g = v.envHold(0.34, 0.004, 0.18, 0.06);
    o.connect(g);
    const g2 = v.gain(0.3);
    o2.connect(g2);
    g2.connect(g);
  },

  // Ramp launch: rising whoosh.
  ramp(v) {
    const { t, p } = v;
    v.whoosh(280 * p, 2600 * p, t, 0.35, 0.4, { q: 0.8, a: 0.05, tc: 0.1 });
    const o = v.osc('sine', 150 * p, t, t + 1);
    v.sweep(o.frequency, 150 * p, 440 * p, t, 0.35);
    o.connect(v.envHold(0.12, 0.05, 0.25, 0.08));
  },

  // Air trick: quick ascending sparkle.
  trick(v) {
    const { t, p } = v;
    [1319, 1661, 1976, 2637].forEach((f, i) => v.bell(f * p, t + i * 0.035, 0.12, 0.06, { ratio: 3.01, index: 0.8 }));
    const n = v.noiseSrc(t, t + 0.6);
    const hp = v.filter('highpass', 8000);
    n.connect(hp);
    hp.connect(v.envHold(0.04, 0.02, 0.12, 0.05));
  },

  // Trick finish: bright add9 chord stab with bells on top.
  trickFinish(v) {
    const { t, p } = v;
    const mix = v.gain(0.14);
    const lp = v.filter('lowpass', 900, 1.4);
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.linearRampToValueAtTime(5200 * p, t + 0.03);
    lp.frequency.setTargetAtTime(1800, t + 0.03, 0.18);
    mix.connect(lp);
    const g = v.envHold(0.5, 0.006, 0.12, 0.14);
    lp.connect(g);
    v.send(g, 0.3);
    for (const f of [587.3, 740, 880, 1318.5]) {
      for (const det of [-9, 9]) {
        const o = v.osc('sawtooth', f * p, t, t + 1.3);
        o.detune.value = det;
        o.connect(mix);
      }
    }
    v.bell(2349 * p, t + 0.02, 0.12, 0.12, { ratio: 2, index: 1 });
    v.bell(2960 * p, t + 0.07, 0.08, 0.1, { ratio: 2, index: 1 });
  },

  // Dash ring: rising "fwip" that passes left -> right.
  dashRing(v) {
    const { t, p } = v;
    const o = v.osc('sine', 700 * p, t, t + 0.5);
    v.sweep(o.frequency, 700 * p, 2900 * p, t, 0.12);
    o.connect(v.env(0.2, 0.003, 0.06));
    const o2 = v.osc('triangle', 1400 * p, t, t + 0.5);
    v.sweep(o2.frequency, 1400 * p, 5800 * p, t, 0.12);
    o2.connect(v.env(0.05, 0.003, 0.05));
    const pan = v.panner(-0.5);
    pan.connect(v.out);
    if (pan.pan) {
      pan.pan.setValueAtTime(-0.5, t);
      pan.pan.linearRampToValueAtTime(0.5, t + 0.25);
    }
    v.whoosh(1500 * p, 5200 * p, t, 0.1, 0.22, { q: 1.2, a: 0.005, tc: 0.05, dest: pan });
    v.bell(2637 * p, t + 0.06, 0.07, 0.08, { ratio: 3.01, index: 0.6 });
  },

  // Rail landing: inharmonic metal clank.
  railLand(v) {
    const { t, p } = v;
    const g = v.gain(1);
    g.connect(v.out);
    v.send(g, 0.15);
    const parts = [[523, 0.13, 0.08], [1397, 0.11, 0.06], [2266, 0.08, 0.045], [3134, 0.05, 0.035], [4410, 0.035, 0.025]];
    for (const [f, pk, tc] of parts) {
      const o = v.osc('sine', f * p, t, t + tc * 7 + 0.02);
      o.connect(v.env(pk, 0.001, tc, t, g));
    }
    const n = v.noiseSrc(t, t + 0.15);
    const bp = v.filter('bandpass', 3200 * p, 0.8);
    n.connect(bp);
    bp.connect(v.env(0.2, 0.001, 0.012));
    v.boom(190 * p, 90, t, 0.2, 0.035);
  },

  // Checkpoint: two bright bell dings a fourth apart.
  checkpoint(v) {
    const { t, p } = v;
    const g = v.gain(1);
    g.connect(v.out);
    v.send(g, 0.35);
    v.bell(1174.7 * p, t, 0.24, 0.2, { ratio: 2, index: 1.1, dest: g });
    v.bell(1568 * p, t + 0.14, 0.26, 0.28, { ratio: 2, index: 1.1, dest: g });
    v.bell(3136 * p, t + 0.14, 0.05, 0.12, { ratio: 3.01, index: 0.5, dest: g });
  },

  // Countdown beep (3, 2, 1).
  countdown(v) {
    const { t, p } = v;
    const o = v.osc('square', 880 * p, t, t + 0.35);
    const lp = v.filter('lowpass', 3200);
    o.connect(lp);
    lp.connect(v.envHold(0.12, 0.004, 0.12, 0.02));
    const s = v.osc('sine', 880 * p, t, t + 0.35);
    s.connect(v.envHold(0.12, 0.004, 0.12, 0.02));
  },

  // GO!: higher, longer, brighter beep.
  go(v) {
    const { t, p } = v;
    for (const [f, type, pk] of [[1760, 'square', 0.1], [1760, 'sine', 0.12], [880, 'sine', 0.1], [2637, 'sine', 0.03]]) {
      const o = v.osc(type, f * p, t, t + 1);
      let node = o;
      if (type === 'square') {
        node = v.filter('lowpass', 4500);
        o.connect(node);
      }
      node.connect(v.envHold(pk, 0.005, 0.45, 0.06));
    }
    v.send(v.out, 0.15);
  },

  // Death / fall: descending wobbling tone falling away.
  death(v) {
    const { t, p } = v;
    const o = v.osc('square', 740 * p, t, t + 1.5);
    v.sweep(o.frequency, 740 * p, 85 * p, t, 1.0);
    const lfo = v.osc('sine', 7, t, t + 1.5);
    const lg = v.gain(0);
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(60, t + 0.8);
    lfo.connect(lg);
    lg.connect(o.detune);
    const lp = v.filter('lowpass', 3200, 2);
    v.sweep(lp.frequency, 3200, 400, t, 1.0);
    o.connect(lp);
    lp.connect(v.envHold(0.2, 0.01, 0.8, 0.1));
    v.whoosh(2200 * p, 260 * p, t, 0.8, 0.14, { q: 0.9, a: 0.05, tc: 0.12 });
    v.send(v.out, 0.2);
  },

  // Giant truck air horn (~1.2 s): deep F#m cluster of driven saws, honky formant.
  truckHorn(v) {
    const { t, p } = v;
    const hold = 1.05;
    const pre = v.gain(0.12);
    const drv = v.shaper('drive');
    const honk = v.filter('peaking', 650, 1.2);
    honk.gain.value = 7;
    const lp = v.filter('lowpass', 600, 1.1);
    lp.frequency.setValueAtTime(600, t);
    lp.frequency.linearRampToValueAtTime(1500, t + 0.07);
    pre.connect(drv);
    drv.connect(honk);
    honk.connect(lp);
    const g = v.envHold(0.5, 0.045, hold, 0.08);
    lp.connect(g);
    v.send(g, 0.3);
    for (const f of [92.5, 110, 138.6]) {
      for (const det of [-8, 8]) {
        const o = v.osc('sawtooth', f * p, t, t + hold + 0.8);
        o.detune.value = det;
        v.sweep(o.frequency, f * p * 0.93, f * p, t, 0.09);
        o.connect(pre);
      }
    }
    const sub = v.osc('sine', 46 * p, t, t + hold + 0.8);
    sub.connect(v.envHold(0.25, 0.05, hold, 0.08));
  },

  // Heavy crash: driven impact boom, noise body, metal clangs, debris crackle, cymbal.
  crash(v) {
    const { t, p } = v;
    const bus = v.gain(1);
    bus.connect(v.out);
    v.send(bus, 0.3);
    const b = v.osc('sine', 85 * p, t, t + 1.3);
    v.sweep(b.frequency, 85 * p, 34, t, 0.25);
    const bg = v.gain(1.4);
    const dr = v.shaper('drive');
    b.connect(bg);
    bg.connect(dr);
    dr.connect(v.env(0.45, 0.002, 0.15, t, bus));
    const n = v.noiseSrc(t, t + 1.7);
    const lp = v.filter('lowpass', 7000, 0.9);
    lp.frequency.setValueAtTime(7000 * p, t);
    lp.frequency.setTargetAtTime(500, t, 0.25);
    n.connect(lp);
    lp.connect(v.env(0.42, 0.002, 0.2, t, bus));
    for (const f of [311, 587, 829, 1244, 1760, 2311]) {
      const ff = f * p * (0.92 + Math.random() * 0.16);
      const o = v.osc('square', ff, t, t + 2);
      const bp = v.filter('bandpass', ff * 2.1, 3);
      o.connect(bp);
      bp.connect(v.env(0.045, 0.001, 0.08 + Math.random() * 0.2, t, bus));
    }
    for (let i = 0; i < 9; i++) {
      const ti = t + 0.03 + Math.random() * 0.6;
      const d = v.noiseSrc(ti, ti + 0.12);
      const bp = v.filter('bandpass', 3500 + Math.random() * 5000, 1.5);
      d.connect(bp);
      bp.connect(v.env(0.14 * (1 - i / 12), 0.001, 0.012, ti, bus));
    }
    const cs = v.buffer('crash', t);
    if (cs) {
      const cg = v.gain(0.3);
      cs.connect(cg);
      cg.connect(bus);
    }
  },

  // Car bash while boosting: thud + metal ring + crunchy noise.
  carHit(v) {
    const { t, p } = v;
    v.boom(125 * p, 50, t, 0.4, 0.06);
    for (const [f, pk, tc] of [[420, 0.08, 0.15], [980, 0.07, 0.1], [1650, 0.05, 0.08], [2480, 0.04, 0.06]]) {
      const o = v.osc('triangle', f * p * (0.95 + Math.random() * 0.1), t, t + tc * 7 + 0.02);
      o.connect(v.env(pk, 0.001, tc));
    }
    const n = v.noiseSrc(t, t + 0.35);
    const bp = v.filter('bandpass', 1800 * p, 0.7);
    const pre = v.gain(2);
    const cr = v.shaper('crunch');
    n.connect(bp);
    bp.connect(pre);
    pre.connect(cr);
    cr.connect(v.env(0.2, 0.001, 0.04));
  },

  // Magical puff: soft noise puff, rising shimmer, twinkles.
  poof(v) {
    const { t, p } = v;
    v.whoosh(700 * p, 2000 * p, t, 0.12, 0.3, { q: 0.7, a: 0.02, tc: 0.08 });
    v.boom(210 * p, 90, t, 0.18, 0.05);
    const o = v.osc('sine', 1200 * p, t, t + 0.7);
    v.sweep(o.frequency, 1200 * p, 2600 * p, t, 0.25);
    o.connect(v.envHold(0.07, 0.02, 0.15, 0.06));
    [2093, 2637, 3136].forEach((f, i) => v.bell(f * p, t + 0.06 + i * 0.05, 0.07, 0.07, { ratio: 3.01, index: 0.6 }));
    v.send(v.out, 0.2);
  },

  // Menu cursor blip.
  uiMove(v) {
    const { t, p } = v;
    const o = v.osc('square', 880 * p, t, t + 0.18);
    const lp = v.filter('lowpass', 2800);
    o.connect(lp);
    lp.connect(v.env(0.1, 0.002, 0.022));
    const s = v.osc('sine', 1760 * p, t, t + 0.18);
    s.connect(v.env(0.04, 0.002, 0.02));
  },

  // Menu confirm: two-tone up + bell.
  uiSelect(v) {
    const { t, p } = v;
    for (const [f, dt] of [[660, 0], [990, 0.06]]) {
      const o = v.osc('square', f * p, t + dt, t + dt + 0.42);
      const lp = v.filter('lowpass', 3200);
      o.connect(lp);
      lp.connect(v.env(0.11, 0.002, 0.05, t + dt));
    }
    v.bell(1980 * p, t + 0.06, 0.06, 0.08, { ratio: 2, index: 0.6 });
  },

  // Results rank letter slam: driven boom, filtered D-major stab, cymbal.
  rankReveal(v) {
    const { t, p } = v;
    const bus = v.gain(1);
    bus.connect(v.out);
    v.send(bus, 0.4);
    const b = v.osc('sine', 72, t, t + 2.2);
    v.sweep(b.frequency, 72, 30, t, 0.6);
    const bg = v.gain(1.5);
    const dr = v.shaper('drive');
    b.connect(bg);
    bg.connect(dr);
    dr.connect(v.env(0.45, 0.003, 0.3, t, bus));
    const mix = v.gain(0.09);
    const lp = v.filter('lowpass', 5500, 1);
    lp.frequency.setValueAtTime(5500, t);
    lp.frequency.setTargetAtTime(1000, t + 0.02, 0.25);
    mix.connect(lp);
    lp.connect(v.env(0.8, 0.004, 0.35, t, bus));
    for (const m of [50, 57, 62, 66, 69]) {
      for (const det of [-10, 10]) {
        const o = v.osc('sawtooth', mtof(m) * p, t, t + 2.7);
        o.detune.value = det;
        o.connect(mix);
      }
    }
    const cs = v.buffer('crash', t);
    if (cs) {
      const cg = v.gain(0.4);
      cs.connect(cg);
      cg.connect(bus);
    }
    const n = v.noiseSrc(t, t + 0.3);
    const hp = v.filter('highpass', 1200);
    n.connect(hp);
    hp.connect(v.env(0.28, 0.001, 0.02, t, bus));
  },

  // Pass-by whoosh with a Doppler-like drop; pans from centre to opts.pan side.
  whoosh(v) {
    const { t, p } = v;
    const side = v.panValue || (Math.random() < 0.5 ? -0.6 : 0.6);
    if (v.panParam) {
      v.panParam.setValueAtTime(side * 0.2, t);
      v.panParam.linearRampToValueAtTime(side, t + 0.35);
    }
    v.whoosh(2600 * p, 520 * p, t, 0.32, 0.36, { q: 1.1, a: 0.1, tc: 0.06 });
  },
};

export const SFX_NAMES = Object.keys(SFX);
