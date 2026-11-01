// songs.js — the original score of TANUKI RUSH, written as data.
//
// All music here is an original composition for this game.
// Notation is documented at the top of compile.js. Quick reminder:
//   16 steps per bar (16th notes). Melody token = Note:steps ("/" glide, "!" accent,
//   "-" rest, "+" tie). Rhythm pattern chars: note chars, "-" hold, "." silence.
//   Drum lanes: k kick, s snare, h closed hat, H open hat, r ride, c crash, z shaker,
//   t toms (h/m/l, uppercase = accent). Velocity chars: x = 1, o = 0.7, g = 0.35 (ghost).
//
// Leitmotif: the "3-3-2" rhythm (dotted quarter, dotted quarter, quarter) is the
// hook of the stage chorus and returns in the intro, the guitar accents, the title
// theme and the fail sting.

/** Per-bar spec helper: bars a..b (inclusive) use `name`, the rest follow `base`. */
const range = (a, b, name, base = {}) => {
  const o = { ...base };
  for (let i = a; i <= b; i++) o[i] = name;
  return o;
};
const bars = (...lines) => lines.join(' | ');

// ---------------------------------------------------------------------------
// Pattern library
// ---------------------------------------------------------------------------

export const PATTERNS = {
  drums: {
    intro: { k: 'x.....x.x.....x.', s: '....x.......x...', h: 'x.o.x.o.x.o.x.o.' },
    verse: {
      k: 'x......xx.......x......xx.x.....',
      s: '....x.......x.......x.......x..g',
      h: 'x.o.x.o.x.o.x.o.',
      layers: {
        hat16: { h: '.g.g.g.g.g.g.g.g' },
        perc: { k: '....o.......o...', z: 'gogogogogogogogo' },
      },
    },
    pre: {
      k: 'x...x...x...x...',
      s: '....x.......x...',
      h: 'x...x...x...x...',
      H: '..o...o...o...o.',
      layers: {
        hat16: { h: '.g.g.g.g.g.g.g.g' },
        perc: { z: 'gogogogogogogogo', s: '..g.....g..g....' },
      },
    },
    build8: { k: 'x...x...x...x...', s: 'o.o.o.o.o.o.x.x.', h: 'x.x.x.x.x.x.x.x.' },
    roll: { k: 'x...x...x...x...', s: 'ggggoooooooxxxxx' },
    chorus: {
      k: 'x.....x.x.....x.',
      s: '....x.......x...',
      h: 'x...x...x...x...',
      H: '..o...o...o...o.',
      layers: {
        hat16: { h: '.g.g.g.g.g.g.g.g' },
        perc: { k: '....o.......o...', z: 'gogogogogogogogo', s: '..........g....g', r: 'o...o...o...o...' },
      },
    },
    bridge: {
      k: 'x.........x.....',
      s: '........o.......',
      h: 'o.g.g.g.o.g.g.g.',
      layers: {
        hat16: { h: '.g.g.g.g.g.g.g.g' },
        perc: { z: 'gogogogogogogogo', k: '......g.......g.' },
      },
    },
    title: { k: 'x......x..x.....', s: '....x.......x..g', h: 'xgogxgogxgogxg.g', H: '..............o.' },
    title2: { k: 'x......x..x...x.', s: '....x..g....x..g', h: 'xgogxgogxgogxg.g', H: '..............o.' },
    jing1: { k: 'x.x.x.x.....x.x.', s: 'x.x.x.x.....x.x.' },
    jroll: { k: 'x.......x.......', s: 'ggggoooooooxxxxx' },
    jend: { k: 'x...............', t: 'L...............' },
    failDrums: { t: 'l...............' },
  },

  // Fills overlay the last part of a bar (from step `from`); lanes in `mute` are silenced there.
  fills: {
    snare4: { from: 12, mute: 'shH', s: '............ooxx' },
    toms: { from: 8, mute: 'shHr', s: '........xo......', t: '..........hhmmll' },
    tomsBig: { from: 4, mute: 'shHrk', k: '....x...x...x...', s: '....x.o.........', t: '........HhMmLlLl' },
    perc: { from: 12, t: '............hmml' },
  },

  // Bass: R root, O octave, 5 fifth, 3 third, a approach note to the next chord, r/o soft.
  bass: {
    drive8: 'R-R-R-R-R-R-R-a-',
    verse: 'R.R.R.R.R.R.R.a.',
    octave: 'R-O-R-O-R-O-R-a-',
    half: 'R-----------R-5-',
    half2: 'R-------R-------',
    pump16: 'RrRrRrRrRrRrRrRr',
    funk: 'R-.R.OR-.R.5R.O.R-.R.OR-.RO.R.a.',
    hit: 'R---------------',
    short6: 'R-----..........',
    quarter: 'R---R---R---R---',
    jing1: 'R-R-R-R-----R-R-',
  },

  // Guitar: X accented open power chord, o open, x palm-muted chug.
  guitar: {
    chug: 'X.x.x.X.x.x.X.x.X.x.x.X.x.x.Xxxx',
    drive8: 'X-o-o-o-X-o-o-o-',
    open: 'X-----X-----X---',
    hit: 'X---------------',
    hit2: 'X-------X-------',
    build8: 'X-X-X-X-X-X-X-X-',
    jing1: 'X-X-X-X-----X-X-',
  },

  comp: { title: 'X-.x-.X-..x-x--.' },
  stab: { jing1: 'X-X-X-X-----X-X-', half2: 'X-------X-------', whole: 'X---------------' },

  // Chord-tone arpeggios: digit = index into the chord tones stacked upwards.
  sparkle: { s8: '0.1.2.3.4.3.2.1.', twinkle: '..4...2...5...3.', run: '01234567--------' },
  arp: { a16: '0123432101234321', c16: '0240240240240240' },
};

// ---------------------------------------------------------------------------
// STAGE — "Downhill Sunshine" (D major, 168 BPM; final chorus lifts to E major)
// Intro(4) - A verse(16) - B pre-chorus(8) - Chorus(16) - Bridge(8) - Chorus in E(16) -> A
// ---------------------------------------------------------------------------

const INTRO = {
  name: 'Intro',
  bars: 4,
  // bVI - bVII - I - V : the "victory" rise that also ends every chorus.
  chords: 'Bb | C | D | A',
  lead: bars(
    'D5:3! D5:3 F5:2 D5:8',
    'E5:3! E5:3 G5:2 E5:8',
    'F#5:3! F#5:3 A5:2 F#5:8',
    'E5:2 F#5:2 G5:2 A5:2 B5:2 C#6:2 D6:2 E6:2',
  ),
  guitar: { '*': 'hit', 3: 'drive8' },
  bass: 'drive8',
  drums: 'intro',
  fills: { 3: 'toms' },
  crash: [0, 1, 2],
  pad: true,
  arp: 'a16',
};

const VERSE = {
  name: 'A',
  bars: 16,
  // I - bVII - IV - I mixolydian drive, then the relative-minor half.
  chords: 'D | C | G | D | D | C | G | A | Bm | G | D | A | Bm | G | Em7 | Asus4:8 A:8',
  lead: bars(
    // call ... answer (the gaps leave room for the drum fills)
    '-:2 A4:2 D5:2 E5:2 F#5:3 E5:3 D5:2',
    'E5:3 G5:3 E5:2 C5:8',
    '-:2 G4:2 B4:2 D5:2 E5:3 D5:3 B4:2',
    'A4:8 -:8',
    '-:2 A4:2 D5:2 E5:2 F#5:3 E5:3 D5:2',
    'E5:3 G5:3 C6:2 G5:8',
    'B5:3 A5:3 G5:2 E5:4 D5:4',
    'C#5:4 E5:4 A5:6 -:2',
    // second half: longer, more lyrical phrases
    'F#5:6 E5:2 D5:4 B4:4',
    'D5:6 B4:2 A4:4 G4:4',
    'A4:3 B4:3 D5:2 F#5:8',
    'E5:6 C#5:2 A4:8',
    'F#5:6 E5:2 D5:4 B4:4',
    'D5:6 E5:2 G5:4 B5:4',
    'A5:6 G5:2 F#5:4 E5:4',
    'D5:8 C#5:8',
  ),
  guitar: 'chug',
  bass: 'verse',
  drums: 'verse',
  fills: { 3: 'snare4', 7: 'toms', 11: 'snare4', 15: 'toms' },
  crash: [0, 8],
  sparkle: range(8, 15, 's8'),
  arp: 'a16',
  percFill: 'perc',
};

const PRE = {
  name: 'B',
  bars: 8,
  // IV - V - iii - vi, then a stepwise climb ii - iii - IV - V into the chorus.
  chords: 'G | A | F#m | Bm | G | A | Em:8 F#m:8 | G:8 A:8',
  lead: bars(
    'B4:6 A4:2 B4:4 D5:4',
    'C#5:6 B4:2 C#5:4 E5:4',
    'F#5:8 E5:4 C#5:4',
    'D5:10 -:2 B4:2 C#5:2',
    'D5:6 C#5:2 D5:4 G5:4',
    'E5:6 D5:2 E5:4 A5:4',
    'G5:8 A5:8',
    'B5:8 /C#6:8!',
  ),
  guitar: { '*': 'drive8', 7: 'build8' },
  bass: { '*': 'drive8', 7: 'pump16' },
  drums: { '*': 'pre', 6: 'build8', 7: 'roll' },
  fills: { 3: 'snare4' },
  crash: [0, 4],
  sparkle: 's8',
  swell: true,
  arp: 'a16',
  percFill: 'perc',
};

const CHORUS = {
  name: 'C1',
  bars: 16,
  chords: 'D | A/C# | Bm | G | D/F# | G | Em7 | A | D | A/C# | Bm | G | Em7 | F#m7 | Bb:8 C:8 | D',
  lead: bars(
    // hook (3-3-2) and its sequence a fourth lower
    'A5:3! A5:3 B5:2 A5:4 F#5:4',
    'E5:3 E5:3 F#5:2 E5:4 C#5:4',
    // answer: climb to the root, fall home
    'D5:2 E5:2 F#5:4 /B5:4 A5:2 F#5:2',
    'G5:4 F#5:2 E5:2 D5:8',
    // hook again, this time answered upwards
    'A5:3! A5:3 B5:2 A5:4 F#5:4',
    'B5:3 B5:3 D6:2 B5:4 G5:4',
    'A5:2 G5:2 F#5:2 E5:2 F#5:4 G5:4',
    'A5:8 -:4 F#5:2 G5:2',
    // repeat of the first phrase
    'A5:3! A5:3 B5:2 A5:4 F#5:4',
    'E5:3 E5:3 F#5:2 E5:4 C#5:4',
    'D5:2 E5:2 F#5:4 /B5:4 A5:2 F#5:2',
    'G5:4 F#5:2 E5:2 D5:8',
    // climax: scale run, arpeggio to the top, then parallel thirds over bVI - bVII - I
    'E5:2 F#5:2 G5:2 A5:2 B5:4 A5:2 G5:2',
    'F#5:2 A5:2 C#6:4 /E6:8',
    'D6:8! E6:8!',
    '/F#6:14! -:2',
  ),
  guitar: { '*': 'open', 14: 'hit2', 15: 'hit' },
  bass: { '*': 'octave', 14: 'half2' },
  drums: 'chorus',
  fills: { 7: 'snare4', 15: 'toms' },
  crash: [0, 8, 14],
  pad: true,
  sparkle: 's8',
  arp: 'c16',
  percFill: 'perc',
};

const BRIDGE = {
  name: 'Bridge',
  bars: 8,
  // Half-time breakdown; C - D at the end is bVI - bVII of E, launching the key change.
  chords: 'Bm | G | D | A | Bm | G | C | D',
  bells: bars(
    'F#5:4 B5:4 A5:4 F#5:4',
    'G5:4 B5:4 D6:8',
    'A5:4 F#5:4 D5:4 F#5:4',
    'E5:8 C#5:8',
    'F#6:4 B6:4 A6:4 F#6:4',
    'G6:4 B6:4 D7:8',
    'G6:4 C7:4 E7:8',
    'F#7:4 D7:4 A6:4 F#6:4',
  ),
  lead: bars('-:16', '-:16', '-:16', '-:16', 'D5:8 F#5:8', 'G5:8 B5:8', 'C6:8 /E6:8', 'D6:8 F#6:4 E6:4'),
  guitar: { '*': null, 6: 'build8', 7: 'build8' },
  bass: { '*': 'half', 6: 'pump16', 7: 'pump16' },
  drums: { '*': 'bridge', 6: 'build8', 7: 'roll' },
  crash: [0, 6],
  pad: true,
  swell: true,
  arp: 'a16',
};

const CHORUS_LIFT = {
  ...CHORUS,
  name: 'C2',
  transpose: 2, // key change D -> E for the last chorus
  harmony: true, // add a chord-aware harmony line under the lead
  fills: { 7: 'snare4', 15: 'tomsBig' },
};

// ---------------------------------------------------------------------------
// TITLE — "Tanuki Groove" (D major, 116 BPM, 16-bar loop)
// ---------------------------------------------------------------------------

const TITLE_A = {
  name: 'T1',
  bars: 8,
  chords: 'Gmaj7 | A/G | F#m7 | Bm7 | Em7 | F#m7 | Gmaj7 | Asus4:8 A:8',
  lead: bars(
    '-:4 B4:2 D5:2 F#5:6 E5:2',
    'E5:6 C#5:2 A4:8',
    '-:4 A4:2 C#5:2 E5:6 D5:2',
    'D5:6 B4:2 F#4:8',
    'G5:3 F#5:3 E5:2 D5:4 B4:4',
    'A5:3 E5:3 F#5:2 C#5:8',
    'B5:6 A5:2 F#5:4 D5:4',
    'E5:12 -:4',
  ),
  bass: 'funk',
  drums: 'title',
  comp: 'title',
  pad: true,
  sparkle: 'twinkle',
  fills: { 7: 'snare4' },
  crash: [0],
};

const TITLE_B = {
  name: 'T2',
  bars: 8,
  chords: 'Gmaj7 | A/G | F#m7 | B7 | Em7 | A7 | Dmaj7:8 Bm7:8 | Em7:8 A7sus4:4 A7:4',
  lead: bars(
    '-:4 B4:2 D5:2 F#5:6 A5:2',
    '/B5:6 A5:2 E5:8',
    '-:4 A4:2 C#5:2 E5:6 F#5:2',
    '/A5:6 F#5:2 D#5:8',
    'G5:3! F#5:3 E5:2 D5:4 B4:4',
    'C#5:3 E5:3 G5:2 A5:8',
    'F#5:6 E5:2 D5:4 C#5:4',
    'B4:8 D5:4 C#5:4',
  ),
  bass: 'funk',
  drums: 'title2',
  comp: 'title',
  guitar: { '*': 'hit', 6: 'hit2', 7: 'hit2' },
  pad: true,
  sparkle: 'twinkle',
  fills: { 7: 'toms' },
  crash: [0],
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const SONGS = {
  stage: {
    name: 'stage',
    bpm: 168,
    loopTo: 'A',
    sections: [INTRO, VERSE, PRE, CHORUS, BRIDGE, CHORUS_LIFT],
    // Intensity layers: [start, full] thresholds of setMusicIntensity(x).
    layers: { hat16: [0.1, 0.45], arp: [0.3, 0.7], perc: [0.55, 0.95] },
    mix: {},
  },
  title: {
    name: 'title',
    bpm: 116,
    sections: [TITLE_A, TITLE_B],
    mix: { lead: 0.45, leadCut: 0.6, gtr: 0.07, pad: 0.15, bell: 0.3, ep: 0.35, drums: 0.65 },
  },
};

export const JINGLES = {
  // Course clear: rising fanfare, bVI - bVII - I, then a ringing final chord (~5 s).
  clear: {
    name: 'clear',
    bpm: 150,
    loop: false,
    tail: 2.5,
    sections: [{
      name: 'Fanfare',
      bars: 3,
      chords: 'D | Bb:8 C:8 | D',
      lead: 'A4:2! D5:2 F#5:2 A5:6! F#5:2 A5:2 | D6:6! C6:2 E6:6! D6:2 | /F#6:16!',
      harmony: true,
      stab: { 0: 'jing1', 1: 'half2', 2: 'whole' },
      guitar: { 0: 'jing1', 1: 'hit2', 2: 'hit' },
      bass: { 0: 'jing1', 1: 'half2', 2: 'hit' },
      drums: { 0: 'jing1', 1: 'jroll', 2: 'jend' },
      crash: [0, 2],
      sparkle: { 2: 'run' },
      pad: true,
    }],
    mix: { lead: 0.5, lead2: 0.35, gtr: 0.1, stab: 0.3 },
  },
  // Fail: the 3-3-2 motif in D minor, i - iv - V - i, then a short fade (~3 s).
  fail: {
    name: 'fail',
    bpm: 132,
    loop: false,
    tail: 2,
    sections: [{
      name: 'Sting',
      bars: 2,
      chords: 'Dm:4 Gm:4 A:4 Dm:4 | Dm',
      lead: 'F5:3 E5:3 D5:2 C#5:4 D5:4 | +:6 -:10',
      bass: { 0: 'quarter', 1: 'short6' },
      drums: { 0: 'failDrums' },
      pad: true,
      padMax: 10,
    }],
    mix: { lead: 0.5, leadCut: 0.45, pad: 0.3, bass: 0.2 },
  },
};
