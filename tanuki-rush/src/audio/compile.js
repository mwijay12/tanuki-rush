// compile.js — turns the human-readable song data (songs.js) into flat per-bar,
// per-16th-step event tables that the music player can schedule cheaply.
//
// Notation summary (see songs.js for examples)
//   chords : bars separated by "|"; "D" fills a bar, "Bb:8 C:8" splits it (16 steps per bar)
//   melody : "A5:3 /B5:2 -:4 +:4 C#6:6!" -> note:steps, "/" glide in, "-" rest,
//            "+" tie (extend previous note), "!" accent. Every bar must sum to 16 steps.
//   rhythm patterns (bass / guitar / comp / arps): one char per 16th step,
//            "-" holds the previous note, "." is silence.
// Pure JS, no browser APIs: this module is also used by the headless data test.

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const acc = (s) => (s === '#' ? 1 : s === 'b' ? -1 : 0);
const mod12 = (x) => ((x % 12) + 12) % 12;

/** MIDI note number of the pitch class `pc` inside [lo, lo + 11]. */
export const placePc = (pc, lo) => lo + mod12(pc - lo);

export function parseNote(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note "${name}"`);
  return 12 * (Number(m[3]) + 1) + PC[m[1]] + acc(m[2]);
}

/** Chord qualities as semitone intervals above the root (ascending). */
export const QUALITIES = {
  '': [0, 4, 7], m: [0, 3, 7], 5: [0, 7], 7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10],
  m6: [0, 3, 7, 9], 6: [0, 4, 7, 9], 9: [0, 4, 7, 10, 14], sus4: [0, 5, 7], sus2: [0, 2, 7],
  '7sus4': [0, 5, 7, 10], add9: [0, 4, 7, 14], dim: [0, 3, 6], aug: [0, 4, 8],
};
const CHORD_RE = /^([A-G])([#b]?)(maj7|m7|m6|7sus4|sus4|sus2|add9|dim|aug|m|7|6|9|5)?(?:\/([A-G])([#b]?))?$/;

export function parseChord(sym) {
  const m = CHORD_RE.exec(sym);
  if (!m) throw new Error(`bad chord "${sym}"`);
  const root = mod12(PC[m[1]] + acc(m[2]));
  const bass = m[4] ? mod12(PC[m[4]] + acc(m[5])) : root;
  return { sym, root, bass, tones: QUALITIES[m[3] || ''] };
}

function transposeChord(ch, tr) {
  if (!tr) return ch;
  return { sym: `${ch.sym}${tr > 0 ? '+' : ''}${tr}`, root: mod12(ch.root + tr), bass: mod12(ch.bass + tr), tones: ch.tones };
}

/** "D | Bb:8 C:8 | ..." -> array (one entry per bar) of [{ at, chord }]. */
export function parseChordLine(str) {
  return str.split('|').map((barStr, bi) => {
    const toks = barStr.trim().split(/\s+/).filter(Boolean);
    if (!toks.length) throw new Error(`empty chord bar ${bi + 1}`);
    const out = [];
    let pos = 0;
    for (const tok of toks) {
      const [sym, len] = tok.split(':');
      const d = len === undefined ? 16 - pos : Number(len);
      if (!(d > 0) || !Number.isInteger(d)) throw new Error(`bad chord length in "${tok}" (bar ${bi + 1})`);
      out.push({ at: pos, chord: parseChord(sym) });
      pos += d;
    }
    if (pos !== 16) throw new Error(`chord bar ${bi + 1} has ${pos} steps (expected 16)`);
    return out;
  });
}

const MEL_RE = /^(\/?)([A-G][#b]?-?\d|-|\+):(\d+)(!?)$/;

/** Melody string -> { events: [{ at, m, d, g, v }], bars }. `at` is the step inside the section. */
export function parseMelody(str) {
  const barStrs = str.split('|').map((s) => s.trim());
  const events = [];
  let pos = 0;
  let last = null;
  barStrs.forEach((barStr, bi) => {
    let sum = 0;
    for (const tok of barStr.split(/\s+/).filter(Boolean)) {
      const m = MEL_RE.exec(tok);
      if (!m) throw new Error(`bad melody token "${tok}" (bar ${bi + 1})`);
      const d = Number(m[3]);
      if (!(d > 0)) throw new Error(`zero-length token "${tok}" (bar ${bi + 1})`);
      if (m[2] === '-') {
        last = null;
      } else if (m[2] === '+') {
        if (!last) throw new Error(`tie "+" without a note (bar ${bi + 1})`);
        last.d += d;
      } else {
        last = { at: pos, m: parseNote(m[2]), d, g: m[1] === '/', v: m[4] ? 1 : 0.82 };
        events.push(last);
      }
      pos += d;
      sum += d;
    }
    if (sum !== 16) throw new Error(`melody bar ${bi + 1} has ${sum} steps (expected 16)`);
  });
  return { events, bars: barStrs.length };
}

// ---------------------------------------------------------------------------
// Voicings (MIDI note lists for each instrument)
// ---------------------------------------------------------------------------

/**
 * Bass note for pitch class `pc`, voice-led: the octave inside G1..E3 that is closest to
 * the previous root, with a gentle pull towards E2 so the line never drifts too high/low.
 */
const placeBass = (pc, prev) => {
  if (prev === undefined) return placePc(pc, 34);
  const cost = (m) => Math.abs(m - prev) + 0.5 * Math.abs(m - 40);
  let best = placePc(pc, 31);
  for (let m = best + 12; m <= 52; m += 12) if (cost(m) < cost(best)) best = m;
  return best;
};
const powerChord = (ch) => {
  const r = placePc(ch.root, 40); // E2..D#3
  return [r, r + 7, r + 12];
};
const closeVoicing = (ch, lo) => ch.tones.map((iv) => placePc(ch.root + iv, lo)).sort((a, b) => a - b);
const padVoicing = (ch) => closeVoicing(ch, 55);
const epVoicing = (ch) => {
  const v = closeVoicing(ch, 57);
  if (v.length < 4) v.push(v[0] + 12);
  return v;
};
const stabVoicing = (ch) => [placePc(ch.root, 48), ...closeVoicing(ch, 62)];
/** idx-th tone of an arpeggio built upwards from the root placed at/above `base`. */
const arpTone = (ch, idx, base) => {
  const t = ch.tones;
  return placePc(ch.root, base) + t[idx % t.length] + 12 * Math.floor(idx / t.length);
};

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

const DRUM_LANES = { k: 'kick', s: 'snare', h: 'hatC', H: 'hatO', r: 'ride', c: 'crash', z: 'shaker' };
const TOMS = { h: 'tomH', m: 'tomM', l: 'tomL', H: 'tomH', M: 'tomM', L: 'tomL' };
const DRUM_VEL = { x: 1, o: 0.7, g: 0.35 };
const PATTERN_CHARS = {
  bass: 'ROro53ax-.', guitar: 'Xxo-.', comp: 'Xx-.', stab: 'Xx-.', sparkle: '01234567-.', arp: '01234567-.',
};

function resolveSpec(spec, b) {
  if (spec == null || spec === false) return null;
  if (typeof spec === 'string') return spec === 'none' ? null : spec;
  const v = Object.prototype.hasOwnProperty.call(spec, b) ? spec[b] : spec['*'];
  return v == null || v === 'none' ? null : v;
}

function getPattern(lib, kind, name) {
  const p = lib[kind] && lib[kind][name];
  if (p == null) throw new Error(`unknown ${kind} pattern "${name}"`);
  return p;
}

function checkRhythm(kind, name, pat) {
  if (typeof pat !== 'string' || !pat.length || pat.length % 16) throw new Error(`${kind} pattern "${name}" length must be a multiple of 16`);
  for (const c of pat) if (!PATTERN_CHARS[kind].includes(c)) throw new Error(`${kind} pattern "${name}" has invalid char "${c}"`);
}

/** Notes that start in section bar `b` of a rhythm pattern; durations stop at the bar end. */
function rhythmNotes(pat, b) {
  const out = [];
  const at = (s) => pat[(b * 16 + s) % pat.length];
  for (let s = 0; s < 16; s++) {
    const c = at(s);
    if (c === '-' || c === '.') continue;
    let d = 1;
    while (s + d < 16 && at(s + d) === '-') d++;
    out.push({ s, c, d });
  }
  return out;
}

function chordAt(bar, s) {
  let cur = bar.chords[0].chord;
  for (const c of bar.chords) if (c.at <= s) cur = c.chord;
  return cur;
}

/** Apply a drum style (+ optional fill overlay) to a bar. */
function addDrums(push, style, fill, b, layer) {
  const laneChar = (lane, s) => {
    const str = style[lane];
    return str ? str[(b * 16 + s) % str.length] : '.';
  };
  for (let s = 0; s < 16; s++) {
    const muted = fill && s >= fill.from ? fill.mute || '' : '';
    for (const lane of ['k', 's', 'h', 'H', 'r', 'c', 'z', 't']) {
      let c = muted.includes(lane) ? '.' : laneChar(lane, s);
      if (fill && s >= fill.from && fill[lane] && fill[lane][s] !== '.') c = fill[lane][s];
      if (c === '.' || c === '-') continue;
      if (lane === 't') {
        if (!TOMS[c]) throw new Error(`bad tom char "${c}"`);
        push(s, { i: 'drum', n: TOMS[c], v: c === c.toUpperCase() ? 1 : 0.8, L: layer });
      } else {
        if (!DRUM_VEL[c]) throw new Error(`bad drum char "${c}" in lane ${lane}`);
        push(s, { i: 'drum', n: DRUM_LANES[lane], v: DRUM_VEL[c], L: layer });
      }
    }
  }
}

function checkDrumStyle(name, st) {
  for (const [lane, str] of Object.entries(st)) {
    if (lane === 'layers' || lane === 'from' || lane === 'mute') continue;
    if (!(lane in DRUM_LANES) && lane !== 't') throw new Error(`drum "${name}": unknown lane "${lane}"`);
    if (typeof str !== 'string' || !str.length || str.length % 16) throw new Error(`drum "${name}" lane ${lane}: length must be a multiple of 16`);
  }
}

/**
 * Compile a song definition into bars of 16 step-slots each holding event lists.
 * Throws on malformed data (validateSong() collects those errors instead).
 */
export function compileSong(def, lib) {
  const stepDur = 60 / def.bpm / 4;
  const bars = [];
  const sectionStart = {};

  // Pass 1: bars + chords
  for (const sec of def.sections) {
    if (!(sec.bars > 0)) throw new Error(`section ${sec.name}: bad bar count`);
    const tr = sec.transpose || 0;
    const chordBars = parseChordLine(sec.chords);
    if (chordBars.length !== sec.bars) throw new Error(`section ${sec.name}: ${chordBars.length} chord bars, expected ${sec.bars}`);
    sectionStart[sec.name] = bars.length;
    for (let b = 0; b < sec.bars; b++) {
      bars.push({
        section: sec.name, index: b,
        chords: chordBars[b].map((c) => ({ at: c.at, chord: transposeChord(c.chord, tr) })),
        steps: Array.from({ length: 16 }, () => []),
      });
    }
  }
  const loop = def.loop !== false;
  const loopBar = loop ? sectionStart[def.loopTo || def.sections[0].name] : -1;
  if (loop && loopBar === undefined) throw new Error(`loopTo section "${def.loopTo}" not found`);

  const nextChord = (gb, s) => {
    const bar = bars[gb];
    for (const c of bar.chords) if (c.at > s) return c.chord;
    const nb = gb + 1 < bars.length ? bars[gb + 1] : loop ? bars[loopBar] : bar;
    return nb.chords[0].chord;
  };

  // Pass 2: events
  let bassPrev; // last bass root (MIDI), so root movement is voice-led across bars and sections
  let bassChord = null;
  for (const sec of def.sections) {
    const g0 = sectionStart[sec.name];
    const tr = sec.transpose || 0;
    const push = (sectionStep, ev) => {
      const b = Math.floor(sectionStep / 16);
      if (b < sec.bars) bars[g0 + b].steps[sectionStep % 16].push(ev);
    };

    // Melodic lines
    const addMelody = (str, inst) => {
      const mel = parseMelody(str);
      if (mel.bars !== sec.bars) throw new Error(`section ${sec.name}: ${inst} has ${mel.bars} bars, expected ${sec.bars}`);
      for (const e of mel.events) push(e.at, { i: inst, m: e.m + tr, d: e.d, g: e.g, v: e.v });
      return mel;
    };
    if (sec.lead) {
      const mel = addMelody(sec.lead, 'lead');
      if (sec.harmony) {
        // Chord-aware harmony line: the highest chord tone 3..9 semitones below each lead
        // note (so borrowed chords like bVI / bVII are always harmonised correctly).
        for (const e of mel.events) {
          const m = e.m + tr;
          const b = Math.floor(e.at / 16);
          const ch = chordAt(bars[g0 + b], e.at % 16);
          const pcs = ch.tones.map((iv) => mod12(ch.root + iv));
          let h = m - 3;
          while (h > m - 9 && !pcs.includes(mod12(h))) h--;
          push(e.at, { i: 'lead2', m: h, d: e.d, g: e.g, v: e.v * 0.8 });
        }
      }
    }
    if (sec.bells) addMelody(sec.bells, 'bellLead');

    // Pads: one event per chord span (identical consecutive chords are merged)
    if (sec.pad) {
      const spans = [];
      for (let b = 0; b < sec.bars; b++) {
        for (const c of bars[g0 + b].chords) {
          const at = b * 16 + c.at;
          const prev = spans[spans.length - 1];
          if (prev && prev.chord.sym === c.chord.sym) continue;
          if (prev) prev.d = at - prev.at;
          spans.push({ at, chord: c.chord, d: 0 });
        }
      }
      spans[spans.length - 1].d = sec.bars * 16 - spans[spans.length - 1].at;
      const maxLen = sec.padMax || Infinity; // optional cap (steps), e.g. to shorten a sting's tail
      for (const sp of spans) push(sp.at, { i: 'pad', n: padVoicing(sp.chord), d: Math.min(sp.d, maxLen), v: 0.8 });
    }

    for (let b = 0; b < sec.bars; b++) {
      const gb = g0 + b;
      const bar = bars[gb];
      const at = (s, ev) => bar.steps[s].push(ev);

      // Bass
      const bassName = resolveSpec(sec.bass, b);
      if (bassName) {
        const pat = getPattern(lib, 'bass', bassName);
        checkRhythm('bass', bassName, pat);
        for (const n of rhythmNotes(pat, b)) {
          const cur = chordAt(bar, n.s);
          if (cur !== bassChord) {
            bassPrev = placeBass(cur.bass, bassPrev);
            bassChord = cur;
          }
          const root = bassPrev;
          const chordRoot = placeBass(cur.root, root); // differs from `root` only for slash chords
          let m = root;
          if (n.c === 'O' || n.c === 'o') m = root + 12;
          else if (n.c === '5') m = chordRoot + 7;
          else if (n.c === '3') m = chordRoot + cur.tones[1];
          else if (n.c === 'a') {
            // Chromatic approach into the next chord's root (placed where it will actually be played).
            const nr = placeBass(nextChord(gb, n.s).bass, root);
            m = nr === root ? root + 12 : nr > root ? nr - 1 : nr + 1;
          }
          const soft = n.c === 'r' || n.c === 'o';
          at(n.s, { i: 'bass', m, d: n.c === 'x' ? 1 : n.d, v: n.c === 'x' ? 0.5 : soft ? 0.65 : 0.9, x: n.c === 'x' });
        }
      }

      // Guitar (power chords through the distortion channel)
      const gName = resolveSpec(sec.guitar, b);
      if (gName) {
        const pat = getPattern(lib, 'guitar', gName);
        checkRhythm('guitar', gName, pat);
        for (const n of rhythmNotes(pat, b)) {
          const notes = powerChord(chordAt(bar, n.s));
          if (n.c === 'x') at(n.s, { i: 'gtr', n: notes, d: Math.min(n.d, 2), v: 0.75, mute: true });
          else at(n.s, { i: 'gtr', n: notes, d: n.d, v: n.c === 'X' ? 1 : 0.8, mute: false });
        }
      }

      // Chord comping (e-piano) and brass stabs
      for (const [kind, inst, voicing] of [['comp', 'ep', epVoicing], ['stab', 'stab', stabVoicing]]) {
        const name = resolveSpec(sec[kind], b);
        if (!name) continue;
        const pat = getPattern(lib, kind, name);
        checkRhythm(kind, name, pat);
        for (const n of rhythmNotes(pat, b)) {
          at(n.s, { i: inst, n: voicing(chordAt(bar, n.s)), d: n.d, v: n.c === 'X' ? 1 : 0.75 });
        }
      }

      // Chord-following arpeggios: bell sparkle (always) and synth arp (intensity layer)
      for (const [kind, inst, base, layer] of [['sparkle', 'bell', 74, undefined], ['arp', 'arp', 62, 'arp']]) {
        const name = resolveSpec(sec[kind], b);
        if (!name) continue;
        const pat = getPattern(lib, kind, name);
        checkRhythm(kind, name, pat);
        for (const n of rhythmNotes(pat, b)) {
          at(n.s, { i: inst, m: arpTone(chordAt(bar, n.s), Number(n.c), base), d: n.d, v: 0.8, L: layer });
        }
      }

      // Drums
      const dName = resolveSpec(sec.drums, b);
      if (dName) {
        const style = getPattern(lib, 'drums', dName);
        checkDrumStyle(dName, style);
        const fName = sec.fills && sec.fills[b];
        const fill = fName ? getPattern(lib, 'fills', fName) : null;
        if (fill) checkDrumStyle(fName, fill);
        addDrums(at, style, fill, b, undefined);
        if (style.layers) {
          for (const [layer, lanes] of Object.entries(style.layers)) {
            checkDrumStyle(`${dName}.${layer}`, lanes);
            addDrums(at, lanes, null, b, layer);
          }
        }
        // Extra tom fills on odd bars at high intensity (only where no written fill exists)
        if (sec.percFill && !fill && b % 2 === 1) {
          const pf = getPattern(lib, 'fills', sec.percFill);
          const lanes = {};
          for (const lane of Object.keys(pf)) {
            if (lane === 'from' || lane === 'mute') continue;
            lanes[lane] = pf[lane].split('').map((c, i) => (i >= pf.from ? c : '.')).join('');
          }
          addDrums(at, lanes, null, b, 'perc');
        }
      }
      if (sec.crash && sec.crash.includes(b)) at(0, { i: 'drum', n: 'crash', v: 0.9 });
      if (sec.swell && b === sec.bars - 1) {
        const steps = Math.min(16, Math.ceil(1.2 / stepDur));
        at(16 - steps, { i: 'swell', steps });
      }
    }
  }

  return {
    name: def.name, bpm: def.bpm, stepDur, bars, loop, loopBar,
    totalBars: bars.length, layers: def.layers || null, mix: def.mix || {},
    tail: def.tail || 0,
  };
}

/** Collect every data problem as a list of strings (empty list = song is well-formed). */
export function validateSong(def, lib) {
  const errors = [];
  let song = null;
  try {
    song = compileSong(def, lib);
  } catch (e) {
    errors.push(`${def.name}: ${e.message}`);
    return errors;
  }
  const okMidi = (m) => Number.isInteger(m) && m >= 24 && m <= 108;
  song.bars.forEach((bar, gb) => {
    if (bar.steps.length !== 16) errors.push(`${def.name} bar ${gb}: ${bar.steps.length} steps`);
    bar.steps.forEach((evs, s) => {
      for (const ev of evs) {
        const where = `${def.name} ${bar.section}#${bar.index + 1} step ${s} ${ev.i}`;
        if ('m' in ev && !okMidi(ev.m)) errors.push(`${where}: bad midi ${ev.m}`);
        if ('n' in ev && Array.isArray(ev.n) && !ev.n.every(okMidi)) errors.push(`${where}: bad notes ${ev.n}`);
        if ('d' in ev && !(ev.d > 0)) errors.push(`${where}: bad duration ${ev.d}`);
        if ('v' in ev && !(ev.v > 0 && ev.v <= 1)) errors.push(`${where}: bad velocity ${ev.v}`);
      }
    });
  });
  return errors;
}
