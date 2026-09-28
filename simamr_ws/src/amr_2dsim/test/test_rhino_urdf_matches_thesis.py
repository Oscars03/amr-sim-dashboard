"""rhino.urdf's <amr_sim_config> carries the thesis' current numbers.

Plain XML, no ROS:  python3 -m pytest test/test_rhino_urdf_matches_thesis.py

These are the values a DOE rehearsal in the simulator depends on. Each one is
tied to master-ackerman-thesis CLAUDE_rhino.md; when a number there changes,
this test is the reminder to change the URDF too.
"""
import math
import os
import xml.etree.ElementTree as ET

import pytest

URDF = os.path.join(os.path.dirname(__file__), '..', 'urdf', 'rhino.urdf')


@pytest.fixture(scope='module')
def cfg():
    root = ET.parse(URDF).getroot()
    c = root.find('amr_sim_config')
    return {e.tag: (e.text or '').strip() for e in c}, root


def test_steering_limit_is_the_command_cap(cfg):
    c, _ = cfg
    # base_controller max_steer_deg 18.0 (rhino-robot-ws#31), both sides, since
    # the 2026-09-28 steering refit. A command cap, not a measured delta_bike:
    # delta_bike after the refit is not measured
    # (paper_data/servo_steering_2026-09-28.md).
    assert float(c['max_steering_angle']) == pytest.approx(18.0)


def test_turning_radius_at_the_cap_fits_the_planner(cfg):
    c, _ = cfg
    L = float(c['wheel_base'])
    r = L / math.tan(math.radians(float(c['max_steering_angle'])))
    assert r == pytest.approx(1.185, abs=1e-3)              # R at the 18 deg cap
    # The sim can follow anything Nav2 plans (minimum_turning_radius 1.20).
    assert r <= 1.20


def test_steering_dynamics_are_the_robots(cfg):
    c, _ = cfg
    # base_controller max_steer_rate_deg_s 45 (rhino-robot-ws#31), not the free
    # servo's 82 -- the robot never steers faster than 45 while the node runs.
    assert float(c['max_steering_rate']) == pytest.approx(45.0)     # deg/s, 2026-09-28
    assert float(c['max_steering_accel']) == pytest.approx(262.2)   # deg/s^2, 2026-09-08


@pytest.mark.parametrize('step, measured_t90', [(18.0, 0.48), (36.0, 0.83)])
def test_steering_reproduces_the_cap18_rate45_steps(cfg, step, measured_t90):
    # paper_data/servo_steering_2026-09-28.md §3, servo_l2l_cap18_rate45_2321.csv:
    # 0 -> +18 settles to 90 % in 0.48 s, each +/-18 lock-to-lock in 0.83-0.84 s.
    # The robot reads the servo every 0.059 s, so agreement within one period.
    from amr_2dsim.actuators import slew_steering
    c, _ = cfg
    a = float(c['max_steering_accel'])
    r = float(c['max_steering_rate'])
    angle, rate, t, dt = 0.0, 0.0, 0.0, 0.001
    while angle < 0.9 * step:
        angle, rate = slew_steering(angle, rate, step, dt, a, r)
        t += dt
    assert t == pytest.approx(measured_t90, abs=0.059)


def test_creep_is_the_section_19_lock(cfg):
    c, _ = cfg
    assert float(c['creep_on_turn_mps']) == 0.0
    # no_creep_mode also selects the steering sign convention in reverse; Nav2
    # needs the signed-vx branch, so it must stay false.
    assert c['no_creep_mode'].lower() == 'false'


def test_circumscribed_radius_from_the_body_box(cfg):
    c, root = cfg
    box = None
    for link in root.findall('link'):
        if link.get('name') == 'base_link':
            vis = link.find('visual')
            box = vis.find('geometry/box').get('size').split()
            ox = float(vis.find('origin').get('xyz').split()[0])
    lx, ly = float(box[0]), float(box[1])
    front, side = ox + lx / 2, ly / 2
    assert math.hypot(front, side) == pytest.approx(float(c['robot_radius']), abs=1e-3)  # 0.551


def test_laser_mount_matches_lidar_bringup(cfg):
    _, root = cfg
    j = [j for j in root.findall('joint') if j.get('name') == 'laser_joint'][0]
    xyz = [float(v) for v in j.find('origin').get('xyz').split()]
    yaw = float(j.find('origin').get('rpy').split()[2])
    assert xyz == pytest.approx([0.31, 0.0, 0.510])
    assert abs(yaw) == pytest.approx(math.pi, abs=1e-4)
