/**
 * Tests for the dirty-flag frame loop used by the world/robot editors.
 *
 * Same approach as renderLoop.test.js: the loop's control flow is mirrored
 * here as a standalone function so it can be exercised without a DOM. The
 * editors previously repainted on every animation frame whether or not
 * anything had changed; these cases pin the "draw only when dirty" contract,
 * including the two ordering details that are easy to get wrong -- scheduling
 * the next frame before any early return, and not consuming the flag when the
 * canvas is not mounted yet.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Logic under test (mirrors CreateWorldView / CreateRobotView) ---
function createEditorLoop({ onDraw, getCanvas, dirtyRef }) {
  let animationFrameId;
  const render = () => {
    animationFrameId = requestAnimationFrame(render);
    if (!dirtyRef.current) return;

    const canvas = getCanvas();
    if (!canvas) return; // stay dirty, try again next frame

    dirtyRef.current = false;
    onDraw();
  };
  render();
  return () => cancelAnimationFrame(animationFrameId);
}
// -------------------------------------------------------------------

describe('editor render loop — draws only when dirty', () => {
  let pending;
  let nextId;

  /** Run `n` animation frames. */
  const pump = (n = 1) => {
    for (let i = 0; i < n; i++) {
      const due = [...pending.values()];
      pending.clear();
      due.forEach((cb) => cb());
    }
  };

  beforeEach(() => {
    pending = new Map();
    nextId = 1;
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      const id = nextId++;
      pending.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id) => {
      pending.delete(id);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('draws once for a dirty flag, then sits idle', () => {
    const onDraw = vi.fn();
    const dirtyRef = { current: true };
    createEditorLoop({ onDraw, getCanvas: () => ({}), dirtyRef });

    // The constructor call itself performs the first draw.
    expect(onDraw).toHaveBeenCalledTimes(1);

    pump(120); // two seconds' worth of frames with nothing changing
    expect(onDraw).toHaveBeenCalledTimes(1);
    expect(dirtyRef.current).toBe(false);
  });

  it('redraws exactly once each time the flag is raised', () => {
    const onDraw = vi.fn();
    const dirtyRef = { current: true };
    createEditorLoop({ onDraw, getCanvas: () => ({}), dirtyRef });
    pump(10);
    expect(onDraw).toHaveBeenCalledTimes(1);

    dirtyRef.current = true; // e.g. a wall was drawn, or the view panned
    pump(1);
    expect(onDraw).toHaveBeenCalledTimes(2);

    pump(30);
    expect(onDraw).toHaveBeenCalledTimes(2);
  });

  it('keeps the loop alive and stays dirty while the canvas is unmounted', () => {
    const onDraw = vi.fn();
    const dirtyRef = { current: true };
    let canvas = null;
    createEditorLoop({ onDraw, getCanvas: () => canvas, dirtyRef });

    pump(5);
    expect(onDraw).not.toHaveBeenCalled();
    expect(dirtyRef.current).toBe(true); // flag not consumed

    canvas = {}; // canvas mounts
    pump(1);
    expect(onDraw).toHaveBeenCalledTimes(1);
  });

  it('cleanup stops the loop', () => {
    const onDraw = vi.fn();
    const dirtyRef = { current: true };
    const cleanup = createEditorLoop({ onDraw, getCanvas: () => ({}), dirtyRef });
    expect(onDraw).toHaveBeenCalledTimes(1);

    cleanup();
    dirtyRef.current = true;
    pump(60);
    expect(onDraw).toHaveBeenCalledTimes(1);
  });

  it('is cheaper than the unconditional loop it replaced', () => {
    const before = vi.fn();
    const after = vi.fn();

    // Old shape: repaint every frame regardless.
    let frame;
    const oldLoop = () => { frame = requestAnimationFrame(oldLoop); before(); };
    oldLoop();
    pump(60);
    cancelAnimationFrame(frame);

    const dirtyRef = { current: true };
    createEditorLoop({ onDraw: after, getCanvas: () => ({}), dirtyRef });
    pump(60);

    expect(before.mock.calls.length).toBeGreaterThan(60);
    expect(after).toHaveBeenCalledTimes(1);
  });
});
