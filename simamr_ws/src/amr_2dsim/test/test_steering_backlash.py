"""The steering play (backlash) model reproduces what was measured on Rhino.

No ROS needed -- amr_2dsim.actuators has no rclpy import:

    cd simamr_ws/src/amr_2dsim && python3 -m pytest test/test_steering_backlash.py

Reference numbers (master-ackerman-thesis paper_data/steer_zero_postrefit_2026-10-20.md,
measured 2026-10-20 after the 2026-09-28 steering refit, two sets): driving straight at
command 0 after a standstill full lock, the wheels rest at
    +1.18 deg  after the steering came from the left
    -2.04 deg  after it came from the right
=> play 3.22 deg, centre -0.43 deg (the servo axis read +-0.1 deg in both cases).
"""
import pytest

from amr_2dsim.actuators import steering_backlash

PLAY = 3.22     # deg
CENTRE = -0.43  # deg (<steering_zero_offset>)


def sweep(servo_path, width=PLAY, wheel=0.0):
    """Feed a servo trajectory through the play; return the wheel angle after each step."""
    out = []
    for s in servo_path:
        wheel = steering_backlash(wheel, s, width)
        out.append(wheel)
    return out


def ramp(a, b, n=200):
    return [a + (b - a) * i / n for i in range(1, n + 1)]


def test_no_play_means_the_wheels_are_the_servo():
    for s in (-18.0, -0.3, 0.0, 0.7, 18.0):
        assert steering_backlash(5.0, s, 0.0) == s
        assert steering_backlash(5.0, s, -1.0) == s


def test_wheels_hold_while_the_servo_moves_inside_the_play():
    wheels = sweep(ramp(0.0, 1.5), wheel=0.0)   # 1.5 < PLAY / 2
    assert all(w == 0.0 for w in wheels)


def test_wheels_trail_the_servo_by_half_the_play_once_dragged():
    wheels = sweep(ramp(0.0, 10.0))
    assert wheels[-1] == pytest.approx(10.0 - PLAY / 2)


@pytest.mark.parametrize('lock, measured', [(+18.0, +1.18), (-18.0, -2.04)])
def test_rest_angle_at_command_zero_after_a_full_lock_matches_rhino(lock, measured):
    servo = ramp(0.0, lock) + ramp(lock, 0.0)
    wheel = sweep(servo)[-1] + CENTRE
    assert wheel == pytest.approx(measured, abs=0.01)


def test_a_reversal_moves_the_wheels_only_after_the_whole_play():
    servo = ramp(0.0, 5.0) + ramp(5.0, 5.0 - PLAY + 0.01)
    wheels = sweep(servo)
    assert wheels[-1] == pytest.approx(5.0 - PLAY / 2)      # not moved back yet
    wheels = sweep([5.0 - PLAY - 1.0], wheel=wheels[-1])
    assert wheels[-1] == pytest.approx(5.0 - PLAY - 1.0 + PLAY / 2)
