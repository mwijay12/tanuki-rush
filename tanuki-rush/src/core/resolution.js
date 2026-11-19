// How big the drawing buffer should be.
//
// Kept free of three.js and of any DOM use on purpose: these are the numbers a
// bug report is made of, so they have to be testable without a browser, a GPU
// or a dependency install.

/// Total drawing-buffer pixels the game will ask a GPU for, whatever the screen.
///
/// A Pixel 8 Pro reports a 2992x1344 display. Capping the pixel ratio alone at
/// 1.5 therefore asks for a 4488x2016 buffer - 9.0 megapixels - and PostFX
/// backs that with a HalfFloat MSAA render target of the same size, roughly 72 MB
/// per sample. The browser tests here run at a 915x412 viewport, which is a
/// 1372x618 buffer and a 7 MB target, so the suite exercised about a tenth of
/// the real allocation and stayed green while a phone could not afford it.
///
/// The budget is expressed in pixels rather than in a ratio because the failure
/// depends on the product of the two. 4 megapixels keeps a 2992x1344 phone at
/// essentially its native resolution (the ratio comes out near 1.0) while
/// halving the render-target cost, and it leaves small screens untouched
/// because their ratio never reaches the cap in the first place.
export const MAX_BUFFER_PIXELS = 4_000_000;

/// Chooses the pixel ratio and buffer size for a viewport.
///
/// Pure so it can be tested without a DOM, a GPU or a browser: every number in
/// the bug report is a number this function returns.
///
/// - [w] and [h] are CSS pixels of the container.
/// - [dpr] is `window.devicePixelRatio`.
/// - [cap] is the quality setting's own ratio ceiling.
/// - [budget] is the pixel ceiling, defaulting to [MAX_BUFFER_PIXELS].
export function chooseResolution(w, h, dpr, cap, budget = MAX_BUFFER_PIXELS) {
  const width = Math.max(1, Math.floor(w || 0));
  const height = Math.max(1, Math.floor(h || 0));
  const wanted = Math.max(0.1, Math.min(dpr || 1, cap));
  const cssPixels = width * height;
  // Never scale a buffer up beyond what the screen can show: on a phone whose
  // devicePixelRatio already accounts for its panel, a ratio above 1 buys
  // nothing and costs the whole budget.
  const ceiling = Math.min(wanted, 1.5);
  const byBudget = Math.sqrt(Math.max(1, budget) / cssPixels);
  // Quantised to 1/16 so a resize does not produce a new buffer size every
  // frame on a display whose ratio is irrational.
  const ratio = Math.max(0.5, Math.min(ceiling, Math.floor(byBudget * 16) / 16));
  return {
    pixelRatio: ratio,
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
    pixels: Math.max(1, Math.round(width * ratio)) * Math.max(1, Math.round(height * ratio)),
  };
}
