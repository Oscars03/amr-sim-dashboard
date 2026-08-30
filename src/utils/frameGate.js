// Paces a requestAnimationFrame render loop to a target FPS.
//
// Split out from DashboardView so the timing can be exercised against a
// synthetic, jittery frame clock -- the previous inline version was never
// tested and quantised badly (a "20" cap rendered ~14, a "60" cap ~48).
//
// makeFrameGate(fps) returns shouldDraw(now): call it with the rAF timestamp
// every tick; it returns true on the ticks that should actually draw.
//
//  fps <= 0            -> unlimited, every tick draws.
//  READY (~2 ms slack) -> a 60 Hz panel reports 16.66 ms against a 16.667 ms
//    target and frame timing jitters ~1 ms, so a tighter compare drops one real
//    frame in every handful and the cap reads ~15% low. 2 ms is still well under
//    any real frame interval, so a 120/144 Hz panel never slips the 60 cap.
//  carry -> after a frame lands, `last` advances along the ideal cadence
//    carrying the overshoot, NOT to `now`. Snapping to `now` quantises a cap
//    that does not divide the refresh rate (20 on 60 Hz), or any cap the draw
//    cannot keep up with, down to the next whole frame -- that is what made
//    "20" land on 60 ms intervals and read 16.
export function makeFrameGate(fps) {
  const step = fps > 0 ? 1000 / fps : 0;
  const READY = 2;
  let last = -Infinity;
  return function shouldDraw(now) {
    if (!step || last === -Infinity) {
      last = now;
      return true;
    }
    const elapsed = now - last;
    if (elapsed < step - READY) return false;
    last = elapsed >= step ? now - (elapsed % step) : now;
    return true;
  };
}
