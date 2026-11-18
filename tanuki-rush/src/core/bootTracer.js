// Boot tracing for the loading screen.
//
// Why this exists: a Pixel 8 Pro (Android 17, Mali-G715) showed the loading
// screen at t=30 s and a flat navy screen at t=45 s, with the process alive and
// no error anywhere. The loading screen could not say which stage it was in, so
// the report could not distinguish "still working", "hung in one call" and "the
// page stopped being drawn" - the three possibilities that need opposite fixes.
//
// Everything here is deliberately allocation-light and exception-free. It runs
// inside a WebView that may already be unhealthy, so a tracer that throws would
// turn a diagnosable hang into a crash.

const STALL_AFTER_MS = 6000;
const SAMPLE_MS = 1000;

const state = {
  stage: 'boot',
  since: Date.now(),
  started: Date.now(),
  samples: 0,
  notes: [],
  listeners: [],
};

let timer = null;

export function getBootStage() {
  const elapsed = Date.now() - state.since;
  return {
    stage: state.stage,
    ms: elapsed,
    totalMs: Date.now() - state.started,
    stalled: elapsed > STALL_AFTER_MS,
    samples: state.samples,
    note: state.notes[state.notes.length - 1] || '',
  };
}

export function bootStage(name) {
  state.stage = String(name);
  state.since = Date.now();
  publish();
}

/// Attach a one-off fact (an error message, a lost GL context) without moving
/// the stage on, because the interesting question is where it stalled.
export function bootNote(text) {
  state.notes.push(String(text));
  if (state.notes.length > 8) state.notes.shift();
  publish();
}

export function onBootSample(fn) {
  state.listeners.push(fn);
  startSampling();
  return () => {
    const i = state.listeners.indexOf(fn);
    if (i >= 0) state.listeners.splice(i, 1);
  };
}

function publish() {
  const s = getBootStage();
  for (const fn of state.listeners) {
    try {
      fn(s);
    } catch {
      // A broken listener must not take the boot sequence down with it.
    }
  }
}

function startSampling() {
  if (timer !== null || typeof setInterval !== 'function') return;
  timer = setInterval(() => {
    state.samples += 1;
    publish();
  }, SAMPLE_MS);
  if (timer && typeof timer.unref === 'function') timer.unref();
}

// Flutter polls this instead of guessing from the outside, and a browser can
// read it from the console: `__tanukiBoot()`.
if (typeof window !== 'undefined') {
  window.__tanukiBoot = getBootStage;
  window.__tanukiBootNote = bootNote;
}

// Start sampling immediately: the stages that matter most happen before any
// listener exists, and the sample count is what proves the page was alive.
startSampling();
