/**
 * FPS CPU overhead benchmark — asserts new setInterval is cheaper than old rAF-throttle
 * Uses process.cpuUsage() over real 1s windows. Not a unit test — runs serially.
 * 
 * ponytail: real-time benchmark, not fake timers. Takes ~4s total.
 */
import { describe, it, expect } from 'vitest';

const DURATION_MS = 1000;

function fakeDraw() {
  let s = 0;
  for (let i = 0; i < 300; i++) s = Math.sin(i * 0.1) * s + 1;
  return s;
}

function runSetInterval(fps, lowPower = false) {
  return new Promise((resolve) => {
    let draws = 0, callbacks = 0;
    let needsRedraw = true;
    const start = process.cpuUsage();
    const timer = setInterval(() => {
      callbacks++;
      if (lowPower && !needsRedraw) return;
      needsRedraw = false;
      fakeDraw();
      draws++;
      if (callbacks % Math.max(1, Math.round(fps * 0.25)) === 0) needsRedraw = true;
    }, 1000 / fps);
    setTimeout(() => {
      clearInterval(timer);
      resolve({ cpu: process.cpuUsage(start), draws, callbacks });
    }, DURATION_MS);
  });
}

function runRafThrottle(fps) {
  return new Promise((resolve) => {
    let draws = 0, callbacks = 0, lastTime = Date.now();
    const interval = 1000 / fps;
    const start = process.cpuUsage();
    const raf = setInterval(() => {
      callbacks++;
      const now = Date.now();
      if (now - lastTime >= interval) {
        lastTime = now;
        fakeDraw();
        draws++;
      }
    }, 1000 / 60); // simulate rAF at 60fps
    setTimeout(() => {
      clearInterval(raf);
      resolve({ cpu: process.cpuUsage(start), draws, callbacks });
    }, DURATION_MS);
  });
}

describe('FPS CPU benchmark', () => {
  it('setInterval-20fps uses less CPU than rAF-throttle-20fps', async () => {
    const old = await runRafThrottle(20);
    const new_ = await runSetInterval(20, true);

    const oldCpu = old.cpu.user + old.cpu.system;
    const newCpu = new_.cpu.user + new_.cpu.system;

    console.log(`rAF-throttle-20fps  CPU: ${(oldCpu/1000).toFixed(1)}ms  callbacks:${old.callbacks}  draws:${old.draws}`);
    console.log(`setInterval-20fps   CPU: ${(newCpu/1000).toFixed(1)}ms  callbacks:${new_.callbacks}  draws:${new_.draws}`);

    // New approach must be measurably cheaper
    expect(newCpu).toBeLessThan(oldCpu);
    // And callbacks should be 3x fewer (20 vs ~60)
    expect(new_.callbacks).toBeLessThan(old.callbacks);
  }, 10000);

  it('setInterval-20fps fires ~20 draws per second (not 60)', async () => {
    // needsRedraw always true to count max draws
    const result = await runSetInterval(20, false);
    // Allow ±2 for timer jitter
    expect(result.callbacks).toBeGreaterThanOrEqual(18);
    expect(result.callbacks).toBeLessThanOrEqual(22);
  }, 5000);

  it('setInterval-60fps fires ~60 draws per second', async () => {
    const result = await runSetInterval(60, false);
    expect(result.callbacks).toBeGreaterThanOrEqual(55);
    expect(result.callbacks).toBeLessThanOrEqual(65);
  }, 5000);
});
