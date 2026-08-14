"""Verify the optional /steering_cmd channel added for joystick teleop:
a normalized steering fraction in [-1, 1] that sets the Ackermann steering
angle directly, independent of vx -- unlike /cmd_vel's angular.z (yaw-rate
intent), which is meaningless at vx=0 and can't represent "wheel turned
while parked". Falls back to the original /cmd_vel-derived behavior once
the explicit command goes stale.
"""
import math

import numpy as np
import pytest
import rclpy
from std_msgs.msg import Float64

from amr_2dsim.simulator_node import AmrSimulator


@pytest.fixture
def node():
    rclpy.init()
    n = AmrSimulator()
    n.wall_x3 = np.array([1e6])
    n.wall_y3 = np.array([1e6])
    n.wall_x4 = np.array([1e6 + 1.0])
    n.wall_y4 = np.array([1e6])
    n._wall_dx = n.wall_x4 - n.wall_x3
    n._wall_dy = n.wall_y4 - n.wall_y3
    n._wall_len_sq = n._wall_dx ** 2 + n._wall_dy ** 2
    yield n
    n.destroy_node()
    rclpy.shutdown()


def configure_ackermann(node, wheel_base=0.680, max_steering_deg=30.0):
    node.kinematic_model = 'ackermann'
    node.wheel_base = wheel_base
    node.max_steering_angle = math.radians(max_steering_deg)
    node.current_steering_angle = 0.0
    return node


def send_steering_cmd(node, fraction, monkeypatch, t):
    monkeypatch.setattr('amr_2dsim.simulator_node.time.time', lambda: t)
    msg = Float64()
    msg.data = fraction
    node.steering_cmd_callback(msg)


def tick(node, monkeypatch, vx, w_cmd, t):
    node.cmd_vel['vx'] = vx
    node.cmd_vel['vy'] = 0.0
    node.cmd_vel['w'] = w_cmd
    node.last_time = t - 0.05
    node.last_cmd_time = t
    monkeypatch.setattr('amr_2dsim.simulator_node.time.time', lambda: t)
    node.timer_callback()


def test_steering_angle_tracks_stick_while_parked(node, monkeypatch):
    configure_ackermann(node)
    send_steering_cmd(node, 0.5, monkeypatch, t=1000.0)

    tick(node, monkeypatch, vx=0.0, w_cmd=0.0, t=1000.05)

    expected_delta = 0.5 * node.max_steering_angle
    assert node.current_steering_angle == pytest.approx(expected_delta)
    # Parked -- steering angle changes, but the chassis doesn't rotate.
    assert node.pose['theta'] == 0.0


def test_steering_angle_clamped_to_limit(node, monkeypatch):
    configure_ackermann(node)
    send_steering_cmd(node, 2.5, monkeypatch, t=1000.0)  # out-of-range fraction

    tick(node, monkeypatch, vx=0.0, w_cmd=0.0, t=1000.05)

    assert node.current_steering_angle == pytest.approx(node.max_steering_angle)


def test_yaw_rate_matches_pre_set_angle_once_moving(node, monkeypatch):
    configure_ackermann(node)
    send_steering_cmd(node, 0.5, monkeypatch, t=1000.0)

    vx = 1.0
    tick(node, monkeypatch, vx=vx, w_cmd=0.0, t=1000.05)

    delta = 0.5 * node.max_steering_angle
    expected_w = vx * math.tan(delta) / node.wheel_base
    achieved_w = node.pose['theta'] / 0.05  # theta started at 0
    assert achieved_w == pytest.approx(expected_w, rel=1e-6)


def test_falls_back_to_cmd_vel_after_steering_cmd_goes_stale(node, monkeypatch):
    configure_ackermann(node)
    send_steering_cmd(node, 0.9, monkeypatch, t=1000.0)

    # Well past the 0.5s staleness timeout, with no further /steering_cmd.
    vx, w_cmd = 1.0, 0.3
    tick(node, monkeypatch, vx=vx, w_cmd=w_cmd, t=1002.0)

    expected_delta = math.atan(w_cmd * node.wheel_base / vx)
    assert node.current_steering_angle == pytest.approx(expected_delta, abs=1e-9)
