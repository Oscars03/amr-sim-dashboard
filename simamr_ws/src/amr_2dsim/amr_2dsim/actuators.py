"""Actuator models with no ROS dependency, so they can be unit-tested anywhere
(test/test_steering_servo_model.py runs with plain pytest, no rclpy).
"""
import math


def slew_steering(angle, rate, target, dt, max_accel, max_rate=0.0):
    """One tick of a steering servo limited in angular ACCELERATION and RATE.

    Returns the new (angle, rate). Units are whatever the caller uses
    consistently (the simulator passes radians).

    Trapezoidal profile: each tick the servo takes the fastest rate that still
    lets it stop on the target at `max_accel` -- sqrt(2 * a * |error|) in
    continuous time, its sampled equivalent here -- capped at `max_rate` (<= 0
    means no cap), and moves its current rate toward that by at most a * dt.
    A step of size s therefore peaks at min(max_rate, sqrt(a * s)) and, when
    the cap is not reached, averages half of that.

    At the simulator's 50 ms tick a * dt is 13 deg/s, so the final tick of a
    move can still land at up to ~20 deg/s: a resolution limit of the tick,
    bounded by test_at_the_sim_tick_it_settles_within_a_tick_of_ideal.

    With Rhino's measured a = 262.2 deg/s^2 and peak 82.0 deg/s
    (master-ackerman-thesis CLAUDE_rhino.md §3 / §16) this gives what was
    measured on the robot: a 5 deg step peaks at 36 deg/s and averages 18, and
    only steps >= 82^2 / 262.2 = 25.6 deg ever reach the peak.
    """
    if max_accel <= 0.0:
        raise ValueError('max_accel must be > 0 for the accel-limited model')
    r_max = max_rate if max_rate > 0.0 else math.inf
    err = target - angle
    if abs(err) < 1e-12 and abs(rate) <= max_accel * dt:
        return target, 0.0
    # Fastest rate from which the servo can still stop on the target, braking at
    # max_accel in whole ticks. The continuous sqrt(2*a*|err|) is one tick too
    # optimistic: the servo ends up above its braking curve, reaches the target
    # still moving, and the snap below then stops it instantly (a 30 deg step
    # arrived 19 ms early with an unbounded deceleration). This is the sampled
    # version of the same curve.
    ad = max_accel * dt
    v_stop = ad * (math.sqrt(0.25 + 2.0 * abs(err) / (ad * dt)) - 0.5)
    want = math.copysign(min(r_max, v_stop), err)
    rate += max(-max_accel * dt, min(max_accel * dt, want - rate))
    step = rate * dt
    # Land on the target instead of overshooting it by a fraction of a tick.
    if (err > 0 and step >= err) or (err < 0 and step <= err):
        return target, 0.0
    return angle + step, rate
