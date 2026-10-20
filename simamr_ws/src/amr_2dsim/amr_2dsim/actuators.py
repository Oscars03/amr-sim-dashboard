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


def steering_backlash(wheel, servo, width):
    """One tick of the play (backlash) between the steering servo and the wheels.

    Returns the new wheel angle. The wheels stay where they are while the servo
    moves inside the play; once the servo has taken up the slack it drags them
    along, `width / 2` behind it. Same units as the caller (radians in the
    simulator). `width <= 0` means a rigid linkage: the wheels are the servo.

    Measured on Rhino after the 2026-09-28 refit (master-ackerman-thesis
    paper_data/steer_zero_postrefit_2026-10-20.md): driving straight at command 0,
    the wheels rest at +1.18 deg after the steering came from the left and at
    -2.04 deg after it came from the right, with the servo axis at +-0.1 deg in
    both cases -- a 3.22 deg band whose centre is -0.43 deg. The simulator models
    the band with this function and the centre as a constant offset
    (<steering_zero_offset>), added after it.
    """
    if width <= 0.0:
        return servo
    half = 0.5 * width
    if servo - wheel > half:
        return servo - half
    if servo - wheel < -half:
        return servo + half
    return wheel


DRIVE_RESPONSE_KEYS = ('drive_resp_g_fast', 'drive_resp_tau_fast', 'drive_resp_g_slow',
                       'drive_resp_tau_slow', 'drive_resp_accel', 'drive_resp_decel')


def drive_response(state, command, dt, g_fast, tau_fast, g_slow, tau_slow, accel, decel):
    """One tick of a drive whose wheels do not reach the commanded speed at once.

    `state` is (r_s, z, v); returns the new state, whose v is the speed the chassis
    actually moves at. Same units as the caller (m/s, s).

      r_s  the command through a smoother: towards `command` at <= accel while speeding
           up, <= decel while slowing down or reversing, never past it
      z    r_s low-passed with tau_slow, reset to 0 while r_s == 0 (an integral that
           winds up slowly, and that the firmware clears at a zero command)
      v    g_fast r_s + g_slow z, low-passed with tau_fast; 0 target while r_s == 0

    Fitted on Rhino's own bags (master-ackerman-thesis
    paper_data/drive_speed_response_2026-10-20.md, model lin2r): g_fast 0.557, g_slow 0.374,
    tau_slow 7.77 s, tau_fast 0.01 s, accel 3.81, decel 0.8 m/s^2 -- a 0.4 m/s step reaches
    ~0.22 m/s in 0.1 s and ~0.35 m/s after 15 s, and stops within ~0.5 s. Exact
    discretisation of the lags, so any dt is stable.
    """
    r_s, z, v = state
    speeding_up = abs(command) > abs(r_s) and command * r_s >= 0.0
    lim = (accel if speeding_up else decel) * dt
    r_s += max(-lim, min(lim, command - r_s))
    if r_s == 0.0:
        z, target = 0.0, 0.0
    else:
        z += (r_s - z) * (1.0 - math.exp(-dt / tau_slow))
        target = g_fast * r_s + g_slow * z
    v += (target - v) * (1.0 - math.exp(-dt / tau_fast))
    return (r_s, z, v)


class DelayLine:
    """A command that takes effect `latency` seconds after it was given (transport delay).

    update(t, value, latency) records `value` at time t and returns the value given at
    t - latency: the newest record no later than that, or `initial` before the first one
    old enough. Records within `slack` (2 ms) of that time count as old enough, so a
    latency equal to the simulator's tick is one tick despite wall-clock jitter.
    latency <= 0 returns `value` itself.

    Measured on Rhino (master-ackerman-thesis paper_nav2_params/data/
    sim_real_legA_postrefit_2026-10-20.md section 13.1, scripts/legA_steer_latency.py): the
    servo axis follows the commanded angle 0.050-0.055 s later than the servo model
    predicts -- serial out, MCU, servo, and the readback on the way back, so an upper
    bound on the actuation delay.
    """

    def __init__(self, initial=0.0, slack=0.002):
        self.initial = initial
        self.slack = slack
        self._q = []

    def update(self, t, value, latency):
        self._q.append((t, value))
        if latency <= 0.0:
            self._q = self._q[-1:]
            return value
        due = t - latency + self.slack
        while len(self._q) >= 2 and self._q[1][0] <= due:
            self._q.pop(0)
        return self._q[0][1] if self._q[0][0] <= due else self.initial
