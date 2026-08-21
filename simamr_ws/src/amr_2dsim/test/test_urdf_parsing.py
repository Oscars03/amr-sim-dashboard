"""Unit tests for the two URDF fields that used to be silently mis-read:
the base_link visual <origin> (dropped entirely, shifting the collision
footprint) and <max_steering_angle> (read as radians here while every
JavaScript consumer read the same tag as degrees).
"""
import math

import pytest

from amr_2dsim.simulator_node import parse_base_link_box, parse_sim_config

HEADER = '<?xml version="1.0"?>\n<robot name="t">\n'
FOOTER = '</robot>\n'


def write_urdf(tmp_path, body):
    p = tmp_path / 'robot.urdf'
    p.write_text(HEADER + body + FOOTER)
    return str(p)


BOX_WITH_ORIGIN = '''
  <link name="base_link">
    <visual>
      <origin xyz="0.205 0.010 0.150" rpy="0 0 0"/>
      <geometry><box size="0.600 0.440 0.20"/></geometry>
    </visual>
  </link>
'''

BOX_NO_ORIGIN = '''
  <link name="base_link">
    <visual>
      <geometry><box size="0.600 0.440 0.20"/></geometry>
    </visual>
  </link>
'''


def test_box_origin_is_returned(tmp_path):
    # Rear-axle base_link: the body sits 0.205 m forward. Dropping that offset
    # is what used to move the whole footprint backwards.
    assert parse_base_link_box(write_urdf(tmp_path, BOX_WITH_ORIGIN)) == \
        pytest.approx((0.600, 0.440, 0.205, 0.010))


def test_missing_origin_defaults_to_zero(tmp_path):
    assert parse_base_link_box(write_urdf(tmp_path, BOX_NO_ORIGIN)) == \
        pytest.approx((0.600, 0.440, 0.0, 0.0))


def test_no_box_visual_returns_none(tmp_path):
    body = '''
  <link name="base_link">
    <visual><geometry><cylinder radius="0.2" length="0.1"/></geometry></visual>
  </link>
'''
    assert parse_base_link_box(write_urdf(tmp_path, body)) is None


def test_no_visual_at_all_returns_none(tmp_path):
    assert parse_base_link_box(write_urdf(tmp_path, '<link name="base_link"/>')) is None


def cfg_with(tmp_path, inner):
    return parse_sim_config(write_urdf(tmp_path, f'<amr_sim_config>{inner}</amr_sim_config>'))


def test_max_steering_angle_is_degrees(tmp_path):
    # 20 deg is Rhino's servo_max_steer_deg. Read as radians it would have been
    # 1146 deg — the clamp then never bites and the sim turns on a dime.
    cfg = cfg_with(tmp_path, '<max_steering_angle>20.0</max_steering_angle>')
    assert cfg['max_steering_angle'] == pytest.approx(math.radians(20.0))


def test_max_steering_angle_default_is_30_degrees(tmp_path):
    assert cfg_with(tmp_path, '')['max_steering_angle'] == pytest.approx(math.radians(30.0))


def test_radian_looking_value_still_parses_as_degrees_and_warns(tmp_path, caplog):
    # Files written against the old radian convention are not silently
    # reinterpreted into something sane — they are converted as degrees (the
    # documented unit) and flagged loudly.
    cfg = cfg_with(tmp_path, '<max_steering_angle>0.3491</max_steering_angle>')
    assert cfg['max_steering_angle'] == pytest.approx(math.radians(0.3491))
    assert 'DEGREES' in caplog.text


def test_garbage_falls_back_to_default(tmp_path):
    cfg = cfg_with(tmp_path, '<max_steering_angle>banana</max_steering_angle>')
    assert cfg['max_steering_angle'] == pytest.approx(math.radians(30.0))
