"""Verify wall collision detection for both robot footprint types:
circle (existing behavior, regression guard) and the new oriented
rectangle footprint used by geometry_type=rectangle robots (e.g.
rhino_01.urdf). Also checks the /collision publisher wiring.
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
    yield n
    n.destroy_node()
    rclpy.shutdown()


def set_single_wall(node, p1, p2):
    node.wall_x3 = np.array([p1[0]])
    node.wall_y3 = np.array([p1[1]])
    node.wall_x4 = np.array([p2[0]])
    node.wall_y4 = np.array([p2[1]])
    node._wall_dx = node.wall_x4 - node.wall_x3
    node._wall_dy = node.wall_y4 - node.wall_y3
    node._wall_len_sq = node._wall_dx ** 2 + node._wall_dy ** 2


def configure_rectangle(node, length=0.860, width=0.660, robot_radius=0.542):
    """Mirrors rhino_01.urdf's dimensions (0.860 x 0.660 body, 0.542 circumscribing radius)."""
    node.geometry_type = 'rectangle'
    node.robot_length = length
    node.robot_width = width
    node._half_length = length / 2.0
    node._half_width = width / 2.0
    node.robot_radius = robot_radius
    node._robot_radius_sq = robot_radius ** 2
    return node


# A vertical wall at x=1.0, spanning well past any robot placed in these tests.
WALL_P1 = (1.0, -5.0)
WALL_P2 = (1.0, 5.0)


def test_circle_geometry_matches_existing_behavior(node):
    # Default node: geometry_type='circle', robot_radius=0.35 (no URDF loaded).
    set_single_wall(node, WALL_P1, WALL_P2)
    assert node.geometry_type == 'circle'

    assert node._is_collision(0.7, 0.0, 0.0) is True   # dist 0.3 < radius 0.35
    assert node._is_collision(0.6, 0.0, 0.0) is False  # dist 0.4 > radius 0.35


def test_rectangle_collision_triggers_when_edge_reaches_wall(node):
    configure_rectangle(node)
    set_single_wall(node, WALL_P1, WALL_P2)
    # theta=0: long axis (half_length=0.43) faces the wall.
    # Center at x=0.9 -> front edge at 0.9+0.43=1.33, well past the wall.
    assert node.check_collision_rect(0.9, 0.0, 0.0) is True
    # Center at x=0.5 -> front edge at 0.93, clear of the wall at x=1.0.
    assert node.check_collision_rect(0.5, 0.0, 0.0) is False


def test_rectangle_avoids_circle_false_positive(node):
    """A case the old circumscribing-circle check gets wrong: robot turned
    side-on to the wall, close enough to trip the circle radius, but its
    actual (narrower) footprint in that orientation doesn't reach the wall.
    """
    configure_rectangle(node)
    set_single_wall(node, WALL_P1, WALL_P2)

    x, y, theta = 0.6, 0.0, math.pi / 2  # distance to wall = 0.4
    # Old circle check (robot_radius=0.542): 0.4 < 0.542 -> false "collision".
    assert node.check_collision(x, y) is True
    # Rectangle check (side-on: half_width=0.33 faces the wall): 0.6+0.33=0.93 < 1.0 -> clear.
    assert node.check_collision_rect(x, y, theta) is False
    assert node._is_collision(x, y, theta) is False


def test_rectangle_collision_depends_on_orientation(node):
    """Same center distance to the wall, different heading -> different
    outcome, proving the rectangle check actually uses theta."""
    configure_rectangle(node)
    set_single_wall(node, WALL_P1, WALL_P2)

    x, y = 0.6, 0.0
    assert node.check_collision_rect(x, y, 0.0) is True          # long side faces wall: 0.6+0.43=1.03
    assert node.check_collision_rect(x, y, math.pi / 2) is False  # short side faces wall: 0.6+0.33=0.93


def test_publish_collision_publishes_bool(node):
    captured = {}
    node.collision_pub.publish = lambda msg: captured.__setitem__('data', msg.data)

    node.publish_collision(True)
    assert captured['data'] is True

    node.publish_collision(False)
    assert captured['data'] is False
