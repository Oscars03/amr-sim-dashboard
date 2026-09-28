"""Pre-steer at a cusp (forward -> reverse) must steer the way the robot does.

rhino_interface base_controller.cpp (rhino-robot-ws main 43728f6) decides the
steering angle in cmd_vel_callback from the SIGNED commanded velocity --
kinematic_steer_deg(target_v_, target_w_) -- and keeps sending that angle
while the 200 ms pre-steer hold forces DYNV to 0. The sim used to derive the
angle from the *held* vx (0), which falls into the full-lock-by-sign(w)
branch: reversing with w > 0 needs a negative (right) angle, yet for the whole
hold the servo was driven toward +max_steering_angle (left), then back.

Rhino's own numbers (urdf/rhino.urdf): L 0.385 m, 18.0 deg (command cap), servo 82.0 deg/s
and 262.2 deg/s^2, creep 0.0 (section 19 lock), presteer_ms 200.
"""
import math

import numpy as np
import pytest
import rclpy

from amr_2dsim.simulator_node import AmrSimulator

DT = 0.05


@pytest.fixture
def node():
    rclpy.init()
    n = AmrSimulator()
    # Walls far away -- this is about steering, not collision.
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


def configure_rhino(node):
    node.kinematic_model = 'ackermann'
    node.wheel_base = 0.385
    node.max_steering_angle = math.radians(18.0)
    node.max_steering_rate = math.radians(82.0)
    node.max_steering_accel = math.radians(262.2)
    node.creep_on_turn_mps = 0.0
    node.no_creep_mode = False
    node.presteer_ms = 200
    node.current_steering_angle = 0.0
    node.current_steering_rate = 0.0
    return node


class Clock:
    def __init__(self, monkeypatch, t0=1000.0):
        self.t = t0
        monkeypatch.setattr('amr_2dsim.simulator_node.time.time', lambda: self.t)


def run(node, clock, vx, w, steps):
    """Command (vx, w) and step the physics `steps` ticks. Returns per-tick
    (in_presteer, target, actual angle, achieved vx)."""
    node.cmd_vel['vx'] = vx
    node.cmd_vel['vy'] = 0.0
    node.cmd_vel['w'] = w
    out = []
    for _ in range(steps):
        clock.t += DT
        node.last_cmd_time = clock.t  # keep the watchdog happy
        node.timer_callback()
        out.append((clock.t < node.presteer_until, node.target_steering_angle,
                    node.current_steering_angle, node.achieved_vx))
    return out


def test_reverse_cusp_presteer_targets_the_commanded_side(node, monkeypatch):
    configure_rhino(node)
    clock = Clock(monkeypatch)
    node.last_time = clock.t
    v, w = 0.3, 0.2
    fwd = math.atan(w * node.wheel_base / v)      # +14.40 deg, left
    rev = math.atan(w * node.wheel_base / -v)     # -14.40 deg, right
    assert 0.0 < fwd < node.max_steering_angle   # unclamped: a clean test

    # Settle forward on the left arc.
    run(node, clock, v, w, steps=40)
    assert node.current_steering_angle == pytest.approx(fwd, abs=1e-9)

    # Cusp: same w, reverse. The first ticks are the 200 ms pre-steer hold.
    ticks = run(node, clock, -v, w, steps=40)
    # 200 ms / 50 ms = 4 ticks (the flip tick included); float rounding of the
    # fake clock may land the boundary tick on either side, hence >= 3.
    held = [t for t in ticks if t[0]]
    assert len(held) >= 3 and held == ticks[:len(held)]
    for _, target, _, vx in held:
        assert vx == 0.0                           # DYNV held at 0
        assert target == pytest.approx(rev)       # robot: angle from signed v
        assert target < 0.0                        # NOT +max (wrong-side lock)

    # The servo only ever moves toward the new side: it never goes further
    # left than where it started the cusp.
    angles = [a for _, _, a, _ in ticks]
    assert max(angles) <= fwd + 1e-12
    assert all(b <= a + 1e-12 for a, b in zip([fwd] + angles, angles))
    assert angles[-1] == pytest.approx(rev, abs=1e-9)
    # After the hold the chassis reverses.
    assert ticks[-1][3] == pytest.approx(-v)


def test_pure_rotation_at_zero_v_is_still_full_lock(node, monkeypatch):
    """base_controller kinematic_steer_deg: |v| <= 0.01 -> full lock by sign(w)."""
    configure_rhino(node)
    clock = Clock(monkeypatch)
    node.last_time = clock.t
    ticks = run(node, clock, 0.0, -0.4, steps=2)
    assert ticks[-1][1] == pytest.approx(-node.max_steering_angle)
    ticks = run(node, clock, 0.005, 0.4, steps=1)   # inside the 0.01 deadband
    assert ticks[-1][1] == pytest.approx(node.max_steering_angle)
    ticks = run(node, clock, 0.0, 0.0, steps=1)
    assert ticks[-1][1] == 0.0


def test_creep_does_not_change_the_steering_target(node, monkeypatch):
    """On the robot creep only rewrites DYNV; the angle was fixed in the
    callback. With creep on, a v = 0 turn is full lock, not atan(L*w/creep)."""
    configure_rhino(node)
    node.creep_on_turn_mps = 0.3
    clock = Clock(monkeypatch)
    node.last_time = clock.t
    w = 0.2  # atan(0.385*0.2/0.3) = 14.40 deg < 18.0: creep would lower it
    ticks = run(node, clock, 0.0, w, steps=2)
    assert ticks[-1][3] == pytest.approx(0.3)                 # creep drives
    assert ticks[-1][1] == pytest.approx(node.max_steering_angle)
