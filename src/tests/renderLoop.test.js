/**
 * Tests for render loop FPS logic (pure JS, no DOM/React needed)
 * Extracts the interval/rAF decision logic and tests it in isolation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Logic under test (mirrors DashboardView.jsx render loop) ---
function createRenderLoop(fpsLimit, onDraw, needsRedrawFn, effectActiveFn) {
  if (fpsLimit === 0) {
    // Unlimited — use rAF (mocked)
    let frame;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      onDraw();
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  } else {
    const timer = setInterval(() => {
      const lowPower = fpsLimit === 20;
      if (lowPower && !needsRedrawFn() && !effectActiveFn()) return;
      onDraw();
    }, 1000 / fpsLimit);
    return () => clearInterval(timer);
  }
}
// ---------------------------------------------------------------

describe('render loop — setInterval capped FPS', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('20fps fires draw ~20 times per second', () => {
    const draw = vi.fn();
    const cleanup = createRenderLoop(20, draw, () => true, () => false);
    vi.advanceTimersByTime(1000);
    cleanup();
    // setInterval at 50ms → 20 ticks in 1000ms
    expect(draw).toHaveBeenCalledTimes(20);
  });

  it('60fps fires draw ~60 times per second', () => {
    const draw = vi.fn();
    const cleanup = createRenderLoop(60, draw, () => true, () => false);
    vi.advanceTimersByTime(1000);
    cleanup();
    // allow ±3 for fake-timer boundary ticks
    expect(draw.mock.calls.length).toBeGreaterThanOrEqual(57);
    expect(draw.mock.calls.length).toBeLessThanOrEqual(63);
  });

  it('20fps lowPower skips draw when not dirty and no effect', () => {
    const draw = vi.fn();
    // needsRedraw=false, effectActive=false → should skip every tick
    const cleanup = createRenderLoop(20, draw, () => false, () => false);
    vi.advanceTimersByTime(1000);
    cleanup();
    expect(draw).toHaveBeenCalledTimes(0);
  });

  it('20fps lowPower draws when effectActive=true even if not dirty', () => {
    const draw = vi.fn();
    const cleanup = createRenderLoop(20, draw, () => false, () => true);
    vi.advanceTimersByTime(1000);
    cleanup();
    expect(draw).toHaveBeenCalledTimes(20);
  });

  it('cleanup stops interval — no draw after cleanup', () => {
    const draw = vi.fn();
    const cleanup = createRenderLoop(20, draw, () => true, () => false);
    vi.advanceTimersByTime(500);
    cleanup();
    vi.advanceTimersByTime(500); // should not fire after cleanup
    expect(draw).toHaveBeenCalledTimes(10); // only first 500ms
  });

  it('60fps draws more than 20fps in same window', () => {
    const draw20 = vi.fn();
    const draw60 = vi.fn();
    const c1 = createRenderLoop(20, draw20, () => true, () => false);
    const c2 = createRenderLoop(60, draw60, () => true, () => false);
    vi.advanceTimersByTime(1000);
    c1(); c2();
    expect(draw60.mock.calls.length).toBeGreaterThan(draw20.mock.calls.length);
  });
});
