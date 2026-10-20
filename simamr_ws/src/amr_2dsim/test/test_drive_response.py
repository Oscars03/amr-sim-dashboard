"""The wheel speed response model reproduces what was fitted on Rhino.

No ROS needed -- amr_2dsim.actuators has no rclpy import:

    cd simamr_ws/src/amr_2dsim && python3 -m pytest test/test_drive_response.py

Reference (master-ackerman-thesis paper_data/drive_speed_response_2026-10-20.md, model lin2r,
fitted on Rhino's leg A and straight-drive bags, rmse <= 0.008 m/s on the bags it was not
fitted on): g_fast 0.557, tau_fast 0.01 s, g_slow 0.374, tau_slow 7.77 s, accel 3.81 m/s^2,
decel 0.8 m/s^2. On the robot a 0.4 m/s command gives ~0.23 m/s within half a second and
~0.35 m/s after 15 s, and the wheels stop within ~0.5 s of a zero command.
"""
import math

import pytest

from amr_2dsim.actuators import drive_response

RHINO = dict(g_fast=0.557, tau_fast=0.01, g_slow=0.374, tau_slow=7.77, accel=3.81, decel=0.8)


def run(commands, dt=0.05, p=RHINO, state=(0.0, 0.0, 0.0)):
    out = []
    for c in commands:
        state = drive_response(state, c, dt, **p)
        out.append(state[2])
    return out, state


def test_rhino_step_starts_fast_then_creeps_up():
    v, _ = run([0.4] * int(15.0 / 0.05))
    assert v[int(0.5 / 0.05) - 1] == pytest.approx(0.557 * 0.4 + 0.374 * 0.4 * (1 - math.exp(-0.5 / 7.77)), abs=0.01)
    assert 0.22 < v[int(0.5 / 0.05) - 1] < 0.25
    assert 0.34 < v[-1] < 0.36                     # still below the 0.931 steady gain at 15 s
    assert all(b >= a - 1e-12 for a, b in zip(v, v[1:]))


def test_steady_state_is_g_fast_plus_g_slow():
    v, _ = run([0.3] * int(200.0 / 0.05))
    assert v[-1] == pytest.approx(0.3 * (0.557 + 0.374), rel=1e-4)


def test_zero_command_stops_within_half_a_second_and_resets_the_slow_part():
    _, st = run([0.4] * 300)
    v, st = run([0.0] * 20, state=st)
    assert v[int(0.5 / 0.05) - 1] < 1e-3
    assert st == (0.0, 0.0, pytest.approx(0.0, abs=1e-9))


def test_reverse_mirrors_forward():
    fwd, _ = run([0.15] * 100)
    rev, _ = run([-0.15] * 100)
    assert rev == pytest.approx([-x for x in fwd])


def test_any_tick_length_is_stable():
    for dt in (0.001, 0.05, 0.2, 1.0):
        v, _ = run([0.4] * int(30.0 / dt), dt=dt)
        assert 0.0 <= v[-1] <= 0.4
