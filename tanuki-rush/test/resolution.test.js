import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseResolution, MAX_BUFFER_PIXELS } from '../src/core/resolution.js';

// The bug this pins: a Pixel 8 Pro reports a 2992x1344 display, and capping the
// pixel ratio alone at 1.5 asked for a 4488x2016 buffer - 9.0 megapixels, with
// a HalfFloat MSAA PostFX target of the same size behind it. Every browser test
// in this repository ran at a 915x412 viewport instead, which is a tenth of the
// allocation, so the suite was green on a size no phone uses.

test('the phone-sized viewport is held inside the pixel budget', () => {
  const r = chooseResolution(2992, 1344, 2.625, 1.5);
  assert.ok(r.pixels <= MAX_BUFFER_PIXELS, `${r.pixels} px exceeds the budget`);
  // Before the budget this was 4488x2016 = 9 047 808 px.
  assert.ok(r.width * r.height < 9_047_808);
  assert.ok(r.pixelRatio <= 1.5);
  assert.ok(r.pixelRatio >= 0.5);
  // It should still be close to the panel's own resolution: the budget is a
  // ceiling, not a downgrade.
  assert.ok(r.width >= 2400, `width ${r.width} is softer than it needs to be`);
});

test('the old uncapped arithmetic is reproducible, so the comparison is real', () => {
  // What Renderer.resize() used to compute: min(dpr, cap) with no pixel budget.
  const legacyRatio = Math.min(2.625, 1.5);
  assert.equal(Math.round(2992 * legacyRatio), 4488);
  assert.equal(Math.round(1344 * legacyRatio), 2016);
  assert.equal(4488 * 2016, 9_047_808);
  assert.ok(9_047_808 > MAX_BUFFER_PIXELS * 2, 'the old buffer was over twice the budget');
});

test('the CI-sized viewport is untouched, so existing tests still mean what they meant', () => {
  const r = chooseResolution(915, 412, 2.75, 1.5);
  assert.equal(r.pixelRatio, 1.5);
  assert.equal(r.width, 1373);
  assert.equal(r.height, 618);
  assert.ok(r.pixels <= MAX_BUFFER_PIXELS);
});

test('quality settings still separate on a big screen', () => {
  const low = chooseResolution(2992, 1344, 2.625, 0.75);
  const high = chooseResolution(2992, 1344, 2.625, 1.5);
  assert.ok(low.pixelRatio < high.pixelRatio, 'low quality must render fewer pixels');
  assert.ok(low.pixels < high.pixels);
  assert.ok(low.pixels <= MAX_BUFFER_PIXELS);
});

test('a small screen is never upscaled to spend budget it does not need', () => {
  const r = chooseResolution(640, 360, 1, 1.5);
  assert.equal(r.pixelRatio, 1);
  assert.equal(r.width, 640);
  assert.equal(r.height, 360);
});

test('an extreme aspect ratio still lands inside the budget', () => {
  for (const [w, h] of [[7680, 480], [480, 7680], [5120, 1440], [1024, 1024]]) {
    const r = chooseResolution(w, h, 3, 1.5);
    assert.ok(r.pixels <= MAX_BUFFER_PIXELS, `${w}x${h} produced ${r.pixels} px`);
    assert.ok(r.width >= 1 && r.height >= 1, 'a dimension collapsed to zero');
  }
});

test('a degenerate viewport cannot produce a zero-sized buffer', () => {
  for (const [w, h, dpr] of [[0, 0, 1], [undefined, undefined, undefined], [1, 1, 0], [300, 200, NaN]]) {
    const r = chooseResolution(w, h, dpr, 1.5);
    assert.ok(Number.isFinite(r.pixelRatio) && r.pixelRatio >= 0.5);
    assert.ok(r.width >= 1 && r.height >= 1 && r.pixels >= 1);
  }
});

test('the ratio is stable, so a resize loop cannot churn buffer allocations', () => {
  const a = chooseResolution(2992, 1344, 2.625, 1.5);
  const b = chooseResolution(a.width / a.pixelRatio, a.height / a.pixelRatio, 2.625, 1.5);
  assert.equal(b.pixelRatio, a.pixelRatio);
});
