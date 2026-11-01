// sequencer.js — sample-accurate lookahead scheduler.
//
// A JS timer wakes up every ~25 ms and schedules every 16th-note step that falls
// inside the lookahead window on the AudioContext clock. Step times are always
// derived from an integer step counter (t0 + step * stepDur), so there is no
// floating-point drift even after hours of looping.
//
// If the page stalls (background tab throttling, long GC, breakpoint...) and we
// fall more than `maxLag` seconds behind, the missed steps are skipped instead of
// being fired as a burst, keeping the song position locked to the audio clock.

export class Sequencer {
  /**
   * @param {BaseAudioContext} ctx
   * @param {number} stepDur seconds per step
   * @param {(step: number, time: number) => (boolean|void)} onStep return false to stop
   */
  constructor(ctx, stepDur, onStep, { lookahead = 0.12, interval = 25, maxLag = 0.3 } = {}) {
    this.ctx = ctx;
    this.stepDur = stepDur;
    this.onStep = onStep;
    this.lookahead = lookahead;
    this.interval = interval;
    this.maxLag = maxLag;
    this.timer = null;
    this.step = 0;
    this.t0 = 0;
    this.skipped = 0; // total steps dropped by resyncs (debug info)
    this.running = false;
  }

  start(t0) {
    this.stop();
    this.t0 = t0;
    this.step = 0;
    this.running = true;
    this.timer = setInterval(() => this.tick(), this.interval);
    this.tick();
  }

  stop() {
    this.running = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** Time (AudioContext seconds) of a given step. */
  timeOf(step) {
    return this.t0 + step * this.stepDur;
  }

  tick() {
    if (!this.running) return;
    const ctx = this.ctx;
    if (ctx.state === 'closed') {
      this.stop();
      return;
    }
    const now = ctx.currentTime;
    let t = this.timeOf(this.step);
    if (t < now - this.maxLag) {
      // Fell behind: jump to the first step that is still (slightly) in the future.
      const skip = Math.ceil((now + 0.02 - t) / this.stepDur);
      this.step += skip;
      this.skipped += skip;
      t = this.timeOf(this.step);
    }
    // Hidden tabs only get ~1 timer tick per second: widen the window so music keeps flowing.
    const hidden = typeof document !== 'undefined' && document.hidden === true;
    const horizon = now + (hidden ? Math.max(this.lookahead, 1.2) : this.lookahead);
    let guard = 0;
    while (t < horizon && guard++ < 512) {
      if (this.onStep(this.step, t) === false) {
        this.stop();
        return;
      }
      this.step += 1;
      t = this.timeOf(this.step);
    }
  }
}
