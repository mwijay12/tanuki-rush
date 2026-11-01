// dsp.js — low-level helpers shared by the audio modules.
//
// Everything in here is either pure math (safe to import and run in Node) or
// takes an AudioContext as an argument. No browser globals are touched at
// module load time.

export const TAU = Math.PI * 2;
export const clamp = (x, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
/** Linear 0..1 with a smooth S-curve between edges a and b. */
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Finite-number guard: returns fallback for NaN / Infinity / non-numbers. */
export const num = (x, fallback = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);

/** Small seeded PRNG (mulberry32) so generated drums/IRs sound the same every load. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Offline filters (used when pre-rendering buffers with plain math)
// ---------------------------------------------------------------------------

/** RBJ-cookbook biquad as a stateful per-sample function. type: 'lp' | 'hp' | 'bp'. */
export function biquad(type, freq, q, sr) {
  const w = (TAU * Math.min(freq, sr * 0.45)) / sr;
  const cs = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  let b0;
  let b1;
  let b2;
  if (type === 'lp') {
    b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0;
  } else if (type === 'hp') {
    b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0;
  } else {
    b0 = alpha; b1 = 0; b2 = -alpha; // band-pass, 0 dB peak gain
  }
  const B0 = b0 / a0, B1 = b1 / a0, B2 = b2 / a0, A1 = (-2 * cs) / a0, A2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = B0 * x + B1 * x1 + B2 * x2 - A1 * y1 - A2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

/** Scale all channels so the absolute peak equals `peak`. */
function normalize(chs, peak = 0.9) {
  let m = 0;
  for (const c of chs) for (let i = 0; i < c.length; i++) m = Math.max(m, Math.abs(c[i]));
  if (m > 0) {
    const k = peak / m;
    for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= k;
  }
  return chs;
}

/** Short linear fade at the end of a buffer so it never ends on a click. */
function fadeTail(chs, sr, sec = 0.006) {
  const n = Math.max(1, Math.floor(sr * sec));
  for (const c of chs) {
    for (let i = 0; i < n && i < c.length; i++) c[c.length - 1 - i] *= i / n;
  }
  return chs;
}

// Inharmonic square partials ("808-style" metal) used for hats and cymbals.
const METAL = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0];

function metalBank(freqs, scale, rand) {
  const ph = freqs.map(() => rand());
  const inc = freqs.map((f) => f * scale);
  return (sr) => {
    let s = 0;
    for (let k = 0; k < ph.length; k++) {
      ph[k] += inc[k] / sr;
      ph[k] -= Math.floor(ph[k]);
      s += ph[k] < 0.5 ? 1 : -1;
    }
    return s / ph.length;
  };
}

// ---------------------------------------------------------------------------
// Drum kit rendering (pure math -> arrays of Float32Array channels)
// ---------------------------------------------------------------------------

function renderKick(sr) {
  const n = Math.floor(sr * 0.5);
  const out = new Float32Array(n);
  const r = rng(11);
  const hp = biquad('hp', 1400, 0.7, sr);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = 46 + 135 * Math.exp(-t / 0.026) + 26 * Math.exp(-t / 0.1);
    ph += (TAU * f) / sr;
    const amp = (1 - Math.exp(-t / 0.0012)) * Math.exp(-t / 0.2);
    const click = hp(r() * 2 - 1) * Math.exp(-t / 0.004) * 0.9; // beater click: keeps the kick audible on small speakers
    out[i] = Math.tanh(1.9 * (Math.sin(ph) * amp + click));
  }
  return fadeTail(normalize([out], 0.95), sr);
}

function renderSnare(sr) {
  const n = Math.floor(sr * 0.4);
  const out = new Float32Array(n);
  const r = rng(22);
  const hp = biquad('hp', 900, 0.7, sr);
  const lp = biquad('lp', 9000, 0.7, sr);
  const bp = biquad('bp', 4300, 0.9, sr);
  let p1 = 0, p2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    p1 += (TAU * 182 * (1 + 0.35 * Math.exp(-t / 0.012))) / sr;
    p2 += (TAU * 334 * (1 + 0.2 * Math.exp(-t / 0.01))) / sr;
    const atk = 1 - Math.exp(-t / 0.0008);
    const tone = (Math.sin(p1) * Math.exp(-t / 0.07) + 0.5 * Math.sin(p2) * Math.exp(-t / 0.045)) * atk;
    const nz = r() * 2 - 1;
    const nEnv = atk * (0.8 * Math.exp(-t / 0.12) + 0.2 * Math.exp(-t / 0.025));
    out[i] = Math.tanh(1.5 * (0.6 * tone + nEnv * (0.8 * lp(hp(nz)) + 0.4 * bp(nz))));
  }
  return fadeTail(normalize([out], 0.9), sr);
}

function renderHat(sr, dur, decay, seed) {
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  const r = rng(seed);
  const metal = metalBank(METAL, 1.9, r);
  const bp = biquad('bp', 9500, 0.9, sr);
  const hp1 = biquad('hp', 7200, 0.7, sr);
  const hp2 = biquad('hp', 6500, 0.7, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = (1 - Math.exp(-t / 0.0005)) * Math.exp(-t / decay);
    out[i] = env * (0.75 * hp1(bp(metal(sr))) + 0.45 * hp2(r() * 2 - 1));
  }
  return fadeTail(normalize([out], 0.8), sr);
}

function renderCymbal(sr, dur, seed, bright = 1) {
  const n = Math.floor(sr * dur);
  const chs = [new Float32Array(n), new Float32Array(n)];
  for (let c = 0; c < 2; c++) {
    const r = rng(seed + c * 7);
    const metal = metalBank(METAL, 1.41 + c * 0.05, r);
    const metal2 = metalBank(METAL, 2.73 + c * 0.07, r);
    const bp = biquad('bp', 6800, 0.6, sr);
    const hp = biquad('hp', 4200 * bright, 0.7, sr);
    const lp = biquad('lp', 11500, 0.7, sr);
    const d = chs[c];
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = (1 - Math.exp(-t / 0.0015)) * (0.55 * Math.exp(-t / 0.3) + 0.45 * Math.exp(-t / (0.35 * dur)));
      d[i] = lp(env * (0.55 * bp(metal(sr) + metal2(sr)) + 0.6 * hp(r() * 2 - 1)));
    }
  }
  return fadeTail(normalize(chs, 0.85), sr, 0.05);
}

function renderRide(sr) {
  const n = Math.floor(sr * 1.4);
  const out = new Float32Array(n);
  const r = rng(44);
  const metal = metalBank(METAL, 3.2, r);
  const bp = biquad('bp', 7800, 1.2, sr);
  const hp = biquad('hp', 7000, 0.7, sr);
  const partials = [2870, 3640, 4950, 6230];
  const ph = partials.map(() => 0);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let bell = 0;
    for (let k = 0; k < partials.length; k++) {
      ph[k] += (TAU * partials[k]) / sr;
      bell += Math.sin(ph[k]) * Math.exp(-t / (0.55 - k * 0.09));
    }
    const atk = 1 - Math.exp(-t / 0.0006);
    out[i] = atk * (0.25 * bell + 0.5 * bp(metal(sr)) * Math.exp(-t / 0.5) + 0.35 * hp(r() * 2 - 1) * Math.exp(-t / 0.06));
  }
  return fadeTail(normalize([out], 0.8), sr, 0.03);
}

function renderTom(sr, f0, seed) {
  const n = Math.floor(sr * 0.6);
  const out = new Float32Array(n);
  const r = rng(seed);
  const lp = biquad('lp', 1600, 0.7, sr);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (TAU * f0 * (1 + 0.55 * Math.exp(-t / 0.03))) / sr;
    const env = (1 - Math.exp(-t / 0.001)) * Math.exp(-t / 0.2);
    out[i] = Math.tanh(1.4 * (Math.sin(ph) * env + lp(r() * 2 - 1) * Math.exp(-t / 0.015) * 0.35));
  }
  return fadeTail(normalize([out], 0.9), sr);
}

/** Reverse-cymbal swell. It rises from silence and peaks right at its end. */
function renderSwell(sr, dur = 1.25) {
  const src = renderCymbal(sr, dur, 91, 0.8);
  const n = src[0].length;
  const chs = src.map((c) => {
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i / n;
      d[i] = c[n - 1 - i] * x * x; // reverse + extra fade-in so the start is silent
    }
    return d;
  });
  return fadeTail(normalize(chs, 0.8), sr, 0.004);
}

function renderShaker(sr) {
  const n = Math.floor(sr * 0.12);
  const out = new Float32Array(n);
  const r = rng(55);
  const bp = biquad('bp', 7200, 1.3, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.006) * Math.exp(-t / 0.03);
    out[i] = env * bp(r() * 2 - 1);
  }
  return fadeTail(normalize([out], 0.7), sr);
}

/**
 * Render every drum sound as arrays of channel data (pure math, Node-safe).
 * @returns {Record<string, Float32Array[]>}
 */
export function renderDrumKit(sr) {
  return {
    kick: renderKick(sr),
    snare: renderSnare(sr),
    hatC: renderHat(sr, 0.09, 0.018, 33),
    hatO: renderHat(sr, 0.5, 0.14, 34),
    crash: renderCymbal(sr, 2.2, 66),
    ride: renderRide(sr),
    tomH: renderTom(sr, 196, 71),
    tomM: renderTom(sr, 147, 72),
    tomL: renderTom(sr, 104, 73),
    swell: renderSwell(sr),
    shaker: renderShaker(sr),
  };
}

/** Copy rendered channel arrays into real AudioBuffers. */
export function toAudioBuffers(ctx, kit) {
  const out = {};
  for (const [name, chs] of Object.entries(kit)) {
    const buf = ctx.createBuffer(chs.length, chs[0].length, ctx.sampleRate);
    chs.forEach((d, c) => buf.getChannelData(c).set(d));
    out[name] = buf;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shared buffers / curves
// ---------------------------------------------------------------------------

/** Stereo white noise, shared by every noise-based sound (loop it with a random offset). */
export function makeNoiseBuffer(ctx, seconds = 2) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const r = rng(1000 + c);
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = r() * 2 - 1;
  }
  return buf;
}

/** Small, soft stereo room/plate impulse response (used by a ConvolverNode send). */
export function makeImpulseResponse(ctx, seconds = 1.7, decayPow = 2.8) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const pre = Math.floor(sr * 0.012);
  const buf = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const r = rng(200 + c);
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      // high frequencies die faster than lows (simple one-pole damping that closes over time)
      const k = 0.1 + 0.8 * Math.exp(-t / 0.3);
      lp += k * (r() * 2 - 1 - lp);
      const env = Math.pow(1 - (i - pre) / (n - pre), decayPow) * Math.min(1, t / 0.004);
      d[i] = lp * env;
    }
  }
  return buf;
}

/** tanh soft-clip transfer curve for a WaveShaperNode (bias adds even harmonics). */
export function makeDriveCurve(k = 3, bias = 0, n = 2048) {
  const c = new Float32Array(n);
  const lo = Math.tanh(k * (-1 + bias));
  const hi = Math.tanh(k * (1 + bias));
  const mid = Math.tanh(k * bias);
  const norm = Math.max(Math.abs(hi - mid), Math.abs(lo - mid)) || 1;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = (Math.tanh(k * (x + bias)) - mid) / norm;
  }
  return c;
}

/** Stepped (bit-crush-like) transfer curve for crunchy explosions. */
export function makeCrunchCurve(steps = 6, n = 1024) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.round(Math.tanh(2.2 * x) * steps) / steps;
  }
  return c;
}

// ---------------------------------------------------------------------------
// Scheduling helpers
// ---------------------------------------------------------------------------

/**
 * Disconnect `nodes` once every source in `sources` has fired `onended`.
 * All sources must have been started (a never-started source never ends).
 */
export function cleanupWhenDone(sources, nodes) {
  let remaining = sources.length;
  if (!remaining) return;
  const done = () => {
    remaining -= 1;
    if (remaining > 0) return;
    for (const s of sources) {
      try { s.disconnect(); } catch (e) { /* already disconnected */ }
    }
    for (const nd of nodes) {
      try { nd.disconnect(); } catch (e) { /* already disconnected */ }
    }
  };
  for (const s of sources) s.onended = done;
}

/**
 * ADSR on a gain AudioParam, starting from 0 (click-free).
 * Returns the time after which the envelope is effectively silent.
 */
export function envADSR(param, t, dur, peak, a = 0.005, d = 0.12, s = 0.6, r = 0.08) {
  const tr = t + Math.max(a, dur);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.setTargetAtTime(peak * s, t + a, Math.max(0.001, d / 3));
  param.setTargetAtTime(0, tr, Math.max(0.001, r / 3));
  return tr + r * 2.6;
}

/** Percussive envelope: fast linear attack then exponential decay (time constant tc). */
export function envPerc(param, t, peak, a = 0.003, tc = 0.1) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.setTargetAtTime(0, t + a, Math.max(0.001, tc));
  return t + a + tc * 7;
}
