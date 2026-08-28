/**
 * Tests for the idle-stop watchdog logic (pure JS, no DOM/React needed).
 * Mirrors the movement detector + watchdog tick in DashboardView.jsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const IDLE_STOP_MS = 60 * 60 * 1000;
const IDLE_CHECK_MS = 60 * 1000;
const IDLE_MOVE_EPS_M = 0.02;
const IDLE_MOVE_EPS_DEG = 1.0;

// --- Logic under test (mirrors DashboardView.jsx) ---
function didMove(prev, cur) {
  return (
    !prev ||
    Math.hypot(cur.x - prev.x, cur.y - prev.y) > IDLE_MOVE_EPS_M ||
    Math.abs(cur.th - prev.th) > IDLE_MOVE_EPS_DEG
  );
}

function startWatchdog({ getLastMove, getStatus, onStopped }) {
  let fired = false;
  const iv = setInterval(async () => {
    if (fired || !getLastMove()) return;
    if (Date.now() - getLastMove() < IDLE_STOP_MS) return;
    const st = await getStatus();
    if (st?.status !== 'running') return;
    fired = true;
    onStopped();
  }, IDLE_CHECK_MS);
  return { dispose: () => clearInterval(iv), rearm: () => { fired = false; } };
}
// ----------------------------------------------------

describe('didMove — pose comparison', () => {
  it('is true on the first sample (no previous)', () => {
    expect(didMove(null, { x: 0, y: 0, th: 0 })).toBe(true);
  });

  it('is false when the robot barely drifts within epsilon', () => {
    const prev = { x: 1, y: 1, th: 10 };
    expect(didMove(prev, { x: 1.01, y: 1.0, th: 10.5 })).toBe(false);
  });

  it('is true past the translation epsilon', () => {
    const prev = { x: 0, y: 0, th: 0 };
    expect(didMove(prev, { x: IDLE_MOVE_EPS_M + 0.001, y: 0, th: 0 })).toBe(true);
  });

  it('is true past the rotation epsilon', () => {
    const prev = { x: 0, y: 0, th: 0 };
    expect(didMove(prev, { x: 0, y: 0, th: IDLE_MOVE_EPS_DEG + 0.1 })).toBe(true);
  });
});

describe('idle watchdog tick', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does nothing while the robot has moved within the last hour', async () => {
    const onStopped = vi.fn();
    const getStatus = vi.fn().mockResolvedValue({ status: 'running' });
    let lastMove = Date.now();
    const { dispose } = startWatchdog({ getLastMove: () => lastMove, getStatus, onStopped });

    // 59 minutes of ticks, robot keeps nudging the clock every minute
    for (let m = 0; m < 59; m++) {
      lastMove = Date.now();
      await vi.advanceTimersByTimeAsync(IDLE_CHECK_MS);
    }
    expect(onStopped).not.toHaveBeenCalled();
    dispose();
  });

  it('stops the sim exactly once once the robot is idle past IDLE_STOP_MS', async () => {
    const onStopped = vi.fn();
    const getStatus = vi.fn().mockResolvedValue({ status: 'running' });
    const lastMove = Date.now();
    const { dispose } = startWatchdog({ getLastMove: () => lastMove, getStatus, onStopped });

    // well past the threshold, many extra ticks -- still only one /stop
    await vi.advanceTimersByTimeAsync(IDLE_STOP_MS + 10 * IDLE_CHECK_MS);

    expect(onStopped).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('re-arms after markActive so a second idle stretch stops again', async () => {
    const onStopped = vi.fn();
    const getStatus = vi.fn().mockResolvedValue({ status: 'running' });
    let lastMove = Date.now();
    const { dispose, rearm } = startWatchdog({ getLastMove: () => lastMove, getStatus, onStopped });

    await vi.advanceTimersByTimeAsync(IDLE_STOP_MS + IDLE_CHECK_MS);
    expect(onStopped).toHaveBeenCalledTimes(1);

    // user launches again -> clock reset + watchdog re-armed
    lastMove = Date.now();
    rearm();
    await vi.advanceTimersByTimeAsync(IDLE_STOP_MS + IDLE_CHECK_MS);
    expect(onStopped).toHaveBeenCalledTimes(2);
    dispose();
  });

  it('is a no-op when the sim is not running', async () => {
    const onStopped = vi.fn();
    const getStatus = vi.fn().mockResolvedValue({ status: 'idle' });
    const lastMove = Date.now();
    const { dispose } = startWatchdog({ getLastMove: () => lastMove, getStatus, onStopped });

    await vi.advanceTimersByTimeAsync(IDLE_STOP_MS + 5 * IDLE_CHECK_MS);

    expect(onStopped).not.toHaveBeenCalled();
    dispose();
  });

  it('never fires before the clock has been seeded', async () => {
    const onStopped = vi.fn();
    const getStatus = vi.fn().mockResolvedValue({ status: 'running' });
    const { dispose } = startWatchdog({ getLastMove: () => 0, getStatus, onStopped });

    await vi.advanceTimersByTimeAsync(IDLE_STOP_MS + IDLE_CHECK_MS);

    expect(getStatus).not.toHaveBeenCalled();
    expect(onStopped).not.toHaveBeenCalled();
    dispose();
  });
});
