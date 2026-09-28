"""The accel-limited steering servo reproduces what was measured on Rhino.

No ROS needed -- amr_2dsim.actuators has no rclpy import:

    cd simamr_ws/src/amr_2dsim && python3 -m pytest test/test_steering_servo_model.py

Reference numbers (master-ackerman-thesis CLAUDE_rhino.md §3 / §16, measured
2026-09-08 over 64 slews at servo_speed 3000):
    peak rate      82.0 deg/s
    acceleration   262.2 deg/s^2
    => a 5 deg step peaks at ~36 deg/s and averages ~18 deg/s
    => only steps >= 82^2 / 262.2 = 25.6 deg reach the peak
"""
import math

import pytest

from amr_2dsim.actuators import slew_steering

A = 262.2   # deg/s^2
R = 82.0    # deg/s


def run_step(step_deg, dt=0.001, a=A, r=R, t_max=3.0):
    angle, rate, t = 0.0, 0.0, 0.0
    rates, angles = [], []
    while t < t_max:
        angle, rate = slew_steering(angle, rate, step_deg, dt, a, r)
        t += dt
        rates.append(rate)
        angles.append(angle)
        if angle == step_deg and rate == 0.0:
            break
    return t, rates, angles


def test_small_step_never_reaches_peak_rate_5deg():
    t, rates, _ = run_step(5.0)
    peak = max(abs(v) for v in rates)
    assert peak == pytest.approx(math.sqrt(A * 5.0), rel=0.03)   # 36.2 deg/s
    assert peak == pytest.approx(36.0, abs=1.5)                  # the §3 figure
    mean = 5.0 / t
    assert mean == pytest.approx(18.0, abs=1.0)                  # the §3 figure


def test_large_step_reaches_but_never_exceeds_the_peak():
    t, rates, _ = run_step(30.0)
    assert max(abs(v) for v in rates) == pytest.approx(R, rel=1e-6)
    # trapezoid: s/R + R/a
    assert t == pytest.approx(30.0 / R + R / A, rel=0.02)


@pytest.mark.parametrize('step, reaches', [(24.0, False), (27.0, True)])
def test_the_26_degree_threshold(step, reaches):
    _, rates, _ = run_step(step)
    assert (max(abs(v) for v in rates) >= R - 1e-6) is reaches


def test_no_overshoot_and_monotone_approach():
    _, _, angles = run_step(12.0)
    assert max(angles) <= 12.0 + 1e-12
    assert all(b >= a for a, b in zip(angles, angles[1:]))


def test_symmetric_for_negative_steps():
    t_pos, r_pos, _ = run_step(10.0)
    t_neg, r_neg, _ = run_step(-10.0)
    assert t_pos == pytest.approx(t_neg)
    assert max(r_pos) == pytest.approx(-min(r_neg))


def test_rate_change_per_tick_bounded_by_accel_even_on_reversal():
    dt = 0.05  # the simulator's physics tick
    angle, rate = 0.0, 0.0
    prev = rate
    targets = [20.0] * 6 + [-20.0] * 20
    for tgt in targets:
        angle, rate = slew_steering(angle, rate, tgt, dt, A, R)
        if rate != 0.0 or prev != 0.0:
            assert abs(rate - prev) <= A * dt + 1e-9 or rate == 0.0
        prev = rate


def test_at_the_sim_tick_it_settles_within_a_tick_of_ideal():
    dt = 0.05
    t, _, angles = run_step(30.0, dt=dt)
    assert angles[-1] == 30.0
    assert t == pytest.approx(30.0 / R + R / A, abs=2 * dt)


def test_no_rate_cap_is_accel_only():
    _, rates, _ = run_step(30.0, r=0.0)
    assert max(rates) == pytest.approx(math.sqrt(A * 30.0), rel=0.03)


def test_accel_must_be_positive():
    with pytest.raises(ValueError):
        slew_steering(0.0, 0.0, 1.0, 0.05, 0.0, R)
