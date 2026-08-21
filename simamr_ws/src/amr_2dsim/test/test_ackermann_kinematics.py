"""Verify the Ackermann (single-track bicycle model) kinematics in
AmrSimulator.timer_callback: steering-angle computation, clamping, and the
resulting turning radius of the integrated trajectory.

Formula under test (simulator_node.py):
    delta = atan(w_cmd * wheel_base / vx), clamped to +/- max_steering_angle
    w_achieved = vx * tan(delta) / wheel_base
    R = wheel_base / tan(delta)
"""
import math

import numpy as np
import pytest
import rclpy

from amr_2dsim.simulator_node import AmrSimulator


@pytest.fixture
def node():
    rclpy.init()
    n = AmrSimulator()
    # Push the default room walls far away so nothing in these tests can
    # ever collide -- these tests are only about the kinematics, not the
    # collision response (see test_collision.py for that).
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


def drive(node, monkeypatch, vx, w_cmd, dt, steps, t0=1000.0):
    """Step timer_callback `steps` times with an exact, deterministic dt by
    faking the wall clock -- avoids flakiness from real elapsed time."""
    node.cmd_vel['vx'] = vx
    node.cmd_vel['vy'] = 0.0
    node.cmd_vel['w'] = w_cmd
    node.last_cmd_time = t0
    node.last_time = t0

    clock = {'t': t0}
    monkeypatch.setattr('amr_2dsim.simulator_node.time.time', lambda: clock['t'])

    xs, ys, thetas = [], [], []
    for _ in range(steps):
        clock['t'] += dt
        node.timer_callback()
        xs.append(node.pose['x'])
        ys.append(node.pose['y'])
        thetas.append(node.pose['theta'])
    return xs, ys, thetas


def fit_circle(xs, ys):
    """Algebraic (Kasa) circle fit; returns (center_x, center_y, radius)."""
    x = np.asarray(xs)
    y = np.asarray(ys)
    A = np.stack([2 * x, 2 * y, np.ones_like(x)], axis=1)
    b = x ** 2 + y ** 2
    cx, cy, c = np.linalg.lstsq(A, b, rcond=None)[0]
    r = math.sqrt(c + cx ** 2 + cy ** 2)
    return cx, cy, r


def test_steering_angle_matches_bicycle_formula(node, monkeypatch):
    configure_ackermann(node)
    vx, w_cmd = 1.0, 0.3
    drive(node, monkeypatch, vx, w_cmd, dt=0.05, steps=1)

    expected_delta = math.atan(w_cmd * node.wheel_base / vx)
    assert node.current_steering_angle == pytest.approx(expected_delta, abs=1e-9)


def test_steering_clamps_and_limits_achieved_yaw_rate(node, monkeypatch):
    configure_ackermann(node)
    # Small vx + large w_cmd demands a steering angle well past the limit.
    vx, w_cmd, dt = 0.1, 2.0, 0.05
    _, _, thetas = drive(node, monkeypatch, vx, w_cmd, dt=dt, steps=1)

    assert node.current_steering_angle == pytest.approx(node.max_steering_angle)

    achieved_w = thetas[0] / dt  # theta started at 0.0
    expected_achieved_w = vx * math.tan(node.max_steering_angle) / node.wheel_base
    assert achieved_w == pytest.approx(expected_achieved_w, rel=1e-6)
    assert abs(achieved_w) < abs(w_cmd)


def test_zero_yaw_command_drives_straight(node, monkeypatch):
    configure_ackermann(node)
    vx, dt, steps = 1.0, 0.05, 50
    xs, ys, thetas = drive(node, monkeypatch, vx, 0.0, dt=dt, steps=steps)

    assert thetas[-1] == pytest.approx(0.0, abs=1e-9)
    assert ys[-1] == pytest.approx(0.0, abs=1e-9)
    assert xs[-1] == pytest.approx(vx * dt * steps, rel=1e-6)


def test_cannot_turn_in_place(node, monkeypatch):
    configure_ackermann(node)
    xs, ys, thetas = drive(node, monkeypatch, vx=0.0, w_cmd=1.0, dt=0.05, steps=5)

    assert node.current_steering_angle == 0.0
    assert thetas[-1] == 0.0
    assert xs[-1] == 0.0
    assert ys[-1] == 0.0


def test_turning_radius_matches_bicycle_model(node, monkeypatch):
    configure_ackermann(node)
    vx, w_cmd, dt, steps = 1.0, 0.3, 0.05, 100  # 5s, ~86 deg of arc

    delta_expected = math.atan(w_cmd * node.wheel_base / vx)
    assert delta_expected < node.max_steering_angle  # sanity: unclamped case
    expected_radius = node.wheel_base / math.tan(delta_expected)

    xs, ys, _ = drive(node, monkeypatch, vx, w_cmd, dt=dt, steps=steps)
    _, _, fitted_radius = fit_circle(xs, ys)

    assert fitted_radius == pytest.approx(expected_radius, rel=0.01)
    # Positive w (left turn) starting from theta=0 should curl the path
    # toward +y.
    assert ys[-1] > 0
