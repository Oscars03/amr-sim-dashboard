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


def test_steering_limit_is_the_largest_floor_delta_bike(cfg):
    c, _ = cfg
    # Floor (dynamic) delta_bike at the 20 deg command, 2026-09-12:
    # 16.49 deg left (R 1.301 m) / 22.80 deg right (R 0.916 m)
    # (paper_data/ekf_input_audit_2026-09-12.md §4.1). One symmetric limit,
    # the largest value — owner decision 2026-09-28 (W40 plan E3).
    assert float(c['max_steering_angle']) == pytest.approx(22.80)


def test_turning_radius_is_the_floor_right_turn(cfg):
    c, _ = cfg
    L = float(c['wheel_base'])
    r_min = L / math.tan(math.radians(float(c['max_steering_angle'])))
    assert r_min == pytest.approx(0.916, abs=1e-3)          # right turn, on the floor
    # The sim can follow anything Nav2 plans (minimum_turning_radius 1.20) ...
    assert r_min <= 1.20
    # ... and, by the E3 decision, turns LEFT tighter than the robot can
    # (1.301 m). Left-turn sim results are optimistic — a documented
    # limitation, not a bug. If this ever fails, the decision changed.
    assert r_min < 1.301


def test_servo_dynamics_are_the_measured_ones(cfg):
    c, _ = cfg
    assert float(c['max_steering_rate']) == pytest.approx(82.0)     # deg/s, 2026-09-08
    assert float(c['max_steering_accel']) == pytest.approx(262.2)   # deg/s^2, 2026-09-08


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
