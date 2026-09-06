/**
 * Tests for the teleop key -> twist mapping.
 *
 * The publisher and the X/Y/Z readout under the D-pad used to derive the twist
 * separately, and the readout only handled i / , / j / l -- so every diagonal
 * and every holonomic key showed 0.00 while the robot was plainly moving. Both
 * now call twistFromKeys, and these cases pin what it returns so the two can
 * never drift apart again.
 */
import { describe, it, expect } from 'vitest';
import { twistFromKeys } from '../utils/teleop.js';

const SPEED = 0.5;
const TURN = 1.0;
const t = (...pressed) =>
  twistFromKeys(Object.fromEntries(pressed.map((k) => [k, true])), SPEED, TURN);

describe('twistFromKeys — non-holonomic', () => {
  it('no keys means a zero twist and moving=false', () => {
    expect(t()).toEqual({ lx: 0, ly: 0, az: 0, moving: false });
  });

  it.each([
    ['i', { lx: SPEED, ly: 0, az: 0 }],
    [',', { lx: -SPEED, ly: 0, az: 0 }],
    ['j', { lx: 0, ly: 0, az: TURN }],
    ['l', { lx: 0, ly: 0, az: -TURN }],
  ])('straight key %s', (key, expected) => {
    expect(t(key)).toEqual({ ...expected, moving: true });
  });

  // The regression: these four were the ones the readout reported as 0.00.
  it.each([
    ['u', { lx: SPEED, ly: 0, az: TURN }],
    ['o', { lx: SPEED, ly: 0, az: -TURN }],
    ['m', { lx: -SPEED, ly: 0, az: -TURN }],
    ['.', { lx: -SPEED, ly: 0, az: TURN }],
  ])('diagonal key %s drives and turns at once', (key, expected) => {
    const result = t(key);
    expect(result).toEqual({ ...expected, moving: true });
    expect(result.lx).not.toBe(0);
    expect(result.az).not.toBe(0);
  });
});

describe('twistFromKeys — holonomic', () => {
  it.each([
    ['U', { lx: SPEED, ly: SPEED }],
    ['I', { lx: SPEED, ly: 0 }],
    ['O', { lx: SPEED, ly: -SPEED }],
    ['J', { lx: 0, ly: SPEED }],
    ['L', { lx: 0, ly: -SPEED }],
    ['M', { lx: -SPEED, ly: SPEED }],
    ['<', { lx: -SPEED, ly: 0 }],
    ['>', { lx: -SPEED, ly: -SPEED }],
  ])('strafe key %s', (key, expected) => {
    expect(t(key)).toEqual({ ...expected, az: 0, moving: true });
  });

  it('never yaws — no holonomic key sets angular z', () => {
    for (const key of ['U', 'I', 'O', 'J', 'L', 'M', '<', '>']) {
      expect(t(key).az).toBe(0);
    }
  });
});

describe('twistFromKeys — scaling', () => {
  it('tracks the speed and turn-rate sliders', () => {
    expect(twistFromKeys({ u: true }, 2.0, 3.0)).toEqual({
      lx: 2.0, ly: 0, az: 3.0, moving: true,
    });
  });

  it('an unrelated key leaves the twist at zero', () => {
    expect(t('k')).toEqual({ lx: 0, ly: 0, az: 0, moving: false });
  });
});
