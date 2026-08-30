/**
 * Tests for the render-loop pacing (src/utils/frameGate.js).
 *
 * makeFrameGate is pure, so instead of mocking rAF we feed it a synthetic
 * frame clock -- including a jittery / sub-60 one, which is where the old
 * inline `last = now` gate fell apart (a "20" cap rendered ~14, "60" ~48).
 */
import { describe, it, expect } from 'vitest';
import { makeFrameGate } from '../utils/frameGate';

// Run a gate against a frame clock for `seconds`, return the measured FPS.
function measure(fps, clock, seconds = 4) {
  const shouldDraw = makeFrameGate(fps);
  let now;
  let draws = 0;
  const end = seconds * 1000;
  while ((now = clock()) < end) {
    if (shouldDraw(now)) draws++;
  }
  return draws / seconds;
}

// Deterministic pseudo-random so the jitter is reproducible across runs.
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clockFactory({ base, jitter = 0, dropProb = 0, seed = 1 }) {
  const rnd = mulberry32(seed);
  let t = 0;
  return () => {
    let dt = base + (rnd() * 2 - 1) * jitter;
    if (rnd() < dropProb) dt += base; // a missed vsync
    t += dt;
    return t;
  };
}

const HZ60 = 1000 / 60;
const HZ144 = 1000 / 144;

describe('makeFrameGate — unlimited', () => {
  it('fps <= 0 draws on every tick', () => {
    expect(measure(0, clockFactory({ base: HZ60 }))).toBeCloseTo(60, 0);
    expect(measure(0, clockFactory({ base: HZ144 }))).toBeGreaterThan(140);
  });

  it('first tick always draws', () => {
    const g20 = makeFrameGate(20);
    expect(g20(1234.5)).toBe(true);
  });
});

describe('makeFrameGate — clean 60 Hz clock', () => {
  it('20 cap holds ~20', () => {
    expect(measure(20, clockFactory({ base: HZ60 }))).toBeCloseTo(20, 0);
  });
  it('60 cap holds ~60', () => {
    expect(measure(60, clockFactory({ base: HZ60 }))).toBeGreaterThanOrEqual(58);
  });
});

describe('makeFrameGate — jittery / loaded clock (the regression)', () => {
  // base 17.5 ms + 2 ms jitter + 6% dropped vsync ≈ a busy Electron renderer.
  const busy = () => clockFactory({ base: 17.5, jitter: 2, dropProb: 0.06, seed: 7 });

  it('20 cap stays near 20, not the old ~14', () => {
    const fps = measure(20, busy());
    expect(fps).toBeGreaterThan(18.5);
    expect(fps).toBeLessThan(21.5);
  });

  it('60 cap tracks the clock, not the old ~48', () => {
    // clock can only deliver ~55/s; the gate must not throw more away.
    const fps = measure(60, busy());
    expect(fps).toBeGreaterThan(50);
  });
});

describe('makeFrameGate — high-refresh clock still caps', () => {
  it('60 cap on a 144 Hz clock renders ~60, not ~144', () => {
    const fps = measure(60, clockFactory({ base: HZ144, jitter: 0.5, seed: 3 }));
    expect(fps).toBeGreaterThan(56);
    expect(fps).toBeLessThan(66);
  });
  it('20 cap on a 144 Hz clock renders ~20', () => {
    // Worst phase alignment lets the 2 ms slack run the cap a hair fast; ~20.8
    // on a 144 Hz grid is fine for a low-power cap. What matters: not 144, not 14.
    const fps = measure(20, clockFactory({ base: HZ144, seed: 3 }));
    expect(fps).toBeGreaterThan(19);
    expect(fps).toBeLessThan(22);
  });
});
