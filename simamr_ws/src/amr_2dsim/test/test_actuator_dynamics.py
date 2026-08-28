"""Verify the actuator-dynamics limits in AmrSimulator.timer_callback:

    max_linear_accel   (m/s^2)   -- slews vx/vy toward the command
    max_angular_accel  (rad/s^2) -- slews w toward the command (diff-drive/omni)
    max_steering_rate  (rad/s)   -- slews the Ackermann steering servo

Everything defaults to 0 (== "no limit, instant response"), so an unconfigured
robot behaves exactly as before -- the first two tests pin that down.
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
    # Walls far away -- these tests are about the velocity/steering ramp,
    # not collision (see test_collision.py).
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


def drive(node, monkeypatch, vx, w_cmd, dt, steps, vy=0.0, t0=1000.0):
    """Step timer_callback `steps` times with an exact, deterministic dt."""
    node.cmd_vel['vx'] = vx
    node.cmd_vel['vy'] = vy
    node.cmd_vel['w'] = w_cmd
    node.last_cmd_time = t0
    node.last_time = t0

    clock = {'t': t0}
    monkeypatch.setattr('amr_2dsim.simulator_node.time.time', lambda: clock['t'])

    vxs, ws, deltas = [], [], []
    for _ in range(steps):
        clock['t'] += dt
        node.last_cmd_time = clock['t']  # keep the watchdog happy
        node.timer_callback()
        vxs.append(node.achieved_vx)
        ws.append(node.achieved_w)
        deltas.append(node.current_steering_angle)
    return vxs, ws, deltas


# ── Defaults: no limit configured -> instant response (regression guards) ──

def test_linear_velocity_is_instant_by_default(node, monkeypatch):
    assert node.max_linear_accel == 0.0
    vxs, _, _ = drive(node, monkeypatch, vx=1.0, w_cmd=0.0, dt=0.05, steps=1)
    assert vxs[0] == pytest.approx(1.0)


def test_steering_is_instant_by_default(node, monkeypatch):
    node.kinematic_model = 'ackermann'
    node.wheel_base = 0.68
    node.max_steering_angle = math.radians(30.0)
    assert node.max_steering_rate == 0.0
    _, _, deltas = drive(node, monkeypatch, vx=0.1, w_cmd=2.0, dt=0.05, steps=1)
    assert deltas[0] == pytest.approx(node.max_steering_angle)  # clamped, instant


# ── max_linear_accel ──

def test_linear_accel_ramps_velocity_up(node, monkeypatch):
    node.max_linear_accel = 0.5  # m/s^2 -> +0.025 m/s per 50 ms tick
    dt = 0.05
    vxs, _, _ = drive(node, monkeypatch, vx=1.0, w_cmd=0.0, dt=dt, steps=10)

    for i, v in enumerate(vxs, start=1):
        assert v == pytest.approx(min(1.0, i * node.max_linear_accel * dt))


def test_linear_accel_limits_deceleration_too(node, monkeypatch):
    node.max_linear_accel = 0.5
    dt = 0.05
    # Reach cruise, then command a stop.
    drive(node, monkeypatch, vx=1.0, w_cmd=0.0, dt=dt, steps=100)
    assert node.achieved_vx == pytest.approx(1.0)

    vxs, _, _ = drive(node, monkeypatch, vx=0.0, w_cmd=0.0, dt=dt, steps=5, t0=2000.0)
    for i, v in enumerate(vxs, start=1):
        assert v == pytest.approx(max(0.0, 1.0 - i * node.max_linear_accel * dt))


def test_odom_reports_the_ramped_velocity_not_the_command(node, monkeypatch):
    node.max_linear_accel = 0.5
    vxs, _, _ = drive(node, monkeypatch, vx=1.0, w_cmd=0.0, dt=0.05, steps=1)
    # /odom publishes achieved_vx; one tick in it is nowhere near the 1.0 command.
    assert vxs[0] == pytest.approx(0.025)
    assert node.achieved_vx == pytest.approx(0.025)


# ── max_angular_accel (diff-drive) ──

def test_angular_accel_ramps_yaw_rate(node, monkeypatch):
    node.max_angular_accel = 2.0  # rad/s^2 -> +0.1 rad/s per tick
    dt = 0.05
    _, ws, _ = drive(node, monkeypatch, vx=0.0, w_cmd=1.0, dt=dt, steps=6)
    for i, w in enumerate(ws, start=1):
        assert w == pytest.approx(min(1.0, i * node.max_angular_accel * dt))


# ── max_steering_rate (Ackermann servo) ──

def configure_ackermann(node):
    node.kinematic_model = 'ackermann'
    node.wheel_base = 0.68
    node.max_steering_angle = math.radians(30.0)
    node.current_steering_angle = 0.0
    node.no_creep_mode = True  # isolate from the creep-on-turn feature
    return node


def test_steering_rate_ramps_the_wheel_angle(node, monkeypatch):
    configure_ackermann(node)
    node.max_steering_rate = math.radians(60.0)  # 60 deg/s -> 3 deg per tick
    dt = 0.05
    step = node.max_steering_rate * dt

    # Demand full lock; the servo should approach it one `step` at a time.
    _, _, deltas = drive(node, monkeypatch, vx=1.0, w_cmd=5.0, dt=dt, steps=4)
    for i, d in enumerate(deltas, start=1):
        assert d == pytest.approx(min(node.max_steering_angle, i * step))


def test_achieved_yaw_rate_follows_the_rate_limited_angle(node, monkeypatch):
    configure_ackermann(node)
    node.max_steering_rate = math.radians(60.0)
    dt, vx = 0.05, 1.0

    _, ws, deltas = drive(node, monkeypatch, vx=vx, w_cmd=5.0, dt=dt, steps=3)

    # w is derived from the ACTUAL (still-ramping) wheel angle, not the demand.
    for w, d in zip(ws, deltas):
        assert w == pytest.approx(vx * math.tan(d) / node.wheel_base)
    assert abs(ws[0]) < abs(vx * math.tan(node.max_steering_angle) / node.wheel_base)


def test_steering_rate_lets_the_angle_settle_at_the_target(node, monkeypatch):
    configure_ackermann(node)
    node.max_steering_rate = math.radians(90.0)
    # A modest steering demand that is well inside the mechanical limit.
    vx, w_cmd = 1.0, 0.3
    target = math.atan(w_cmd * node.wheel_base / vx)

    _, _, deltas = drive(node, monkeypatch, vx=vx, w_cmd=w_cmd, dt=0.05, steps=40)
    assert deltas[-1] == pytest.approx(target, abs=1e-6)
