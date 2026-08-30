/**
 * easePose (src/utils/robot.js): smooths the 20 Hz /odom pose up to the draw
 * rate so the robot marker doesn't step across a map that stays smooth.
 */
import { describe, it, expect } from 'vitest';
import { easePose } from '../utils/robot';

describe('easePose', () => {
  const P = (x, y, th = 0) => ({ x, y, th });

  it('snaps on the first frame (no previous pose)', () => {
    expect(easePose(null, P(3, 4, 1), 16)).toEqual(P(3, 4, 1));
  });

  it('snaps when dt is not finite (first frame after a relaunch)', () => {
    expect(easePose(P(0, 0), P(9, 9), NaN)).toEqual(P(9, 9, 0));
  });

  it('snaps on a teleport (jump past snapDist)', () => {
    // > 1 m default: /reset_pose between runs should cut, not slide.
    expect(easePose(P(0, 0), P(5, 0), 16)).toEqual(P(5, 0, 0));
  });

  it('eases partway toward a nearby target, never overshooting', () => {
    const next = easePose(P(0, 0), P(0.5, 0), 16);
    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThan(0.5);
  });

  it('converges to the target within ~0.3 s at 60 fps', () => {
    let p = P(0, 0);
    for (let i = 0; i < 6; i++) p = easePose(p, P(0.4, 0.3), 16.7);
    expect(p.x).toBeGreaterThan(0.2); // ~half way by 100 ms
    for (let i = 0; i < 14; i++) p = easePose(p, P(0.4, 0.3), 16.7);
    expect(p.x).toBeCloseTo(0.4, 2); // settled by ~330 ms
    expect(p.y).toBeCloseTo(0.3, 2);
  });

  it('is frame-rate independent: one 32 ms step ≈ two 16 ms steps', () => {
    const big = easePose(P(0, 0), P(0.5, 0), 32);
    let small = easePose(P(0, 0), P(0.5, 0), 16);
    small = easePose(small, P(0.5, 0), 16);
    expect(big.x).toBeCloseTo(small.x, 3);
  });

  it('eases heading the short way across the ±π wrap', () => {
    // 3.0 rad toward -3.0 rad: shortest path is +0.28 rad through π, not -6 rad.
    const next = easePose(P(0, 0, 3.0), P(0, 0, -3.0), 16.7, 60, 1);
    const wrapped = Math.atan2(Math.sin(next.th), Math.cos(next.th));
    expect(wrapped).toBeGreaterThan(3.0); // moved past π, i.e. wrapped positive
  });
});
