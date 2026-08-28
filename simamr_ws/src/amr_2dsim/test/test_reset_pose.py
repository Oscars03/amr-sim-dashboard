import math
import numpy as np
import pytest
import rclpy
from geometry_msgs.msg import PoseWithCovarianceStamped
from std_msgs.msg import Empty
from std_srvs.srv import Trigger

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


def test_reset_pose_service(node):
    # Change pose and state
    node.pose = {'x': 10.5, 'y': -3.2, 'theta': 1.57, 'vx': 1.0, 'vy': 0.0, 'w': 0.5}
    node.total_pulse_left = 100.0
    node.total_pulse_right = 100.0
    node.current_steering_angle = 0.4

    req = Trigger.Request()
    res = Trigger.Response()
    node.reset_pose_callback(req, res)

    assert res.success is True
    assert node.pose['x'] == node._initial_pose[0]
    assert node.pose['y'] == node._initial_pose[1]
    assert node.pose['theta'] == node._initial_pose[2]
    assert node.pose['vx'] == 0.0
    assert node.total_pulse_left == 0.0
    assert node.current_steering_angle == 0.0


def test_reset_pose_topic(node):
    # Change pose and state
    node.pose = {'x': 7.0, 'y': 8.0, 'theta': -1.2, 'vx': 0.5, 'vy': 0.0, 'w': 0.2}
    node.total_pulse_left = 50.0

    msg = Empty()
    node.reset_pose_topic_callback(msg)

    assert node.pose['x'] == node._initial_pose[0]
    assert node.pose['y'] == node._initial_pose[1]
    assert node.pose['theta'] == node._initial_pose[2]
    assert node.pose['vx'] == 0.0
    assert node.total_pulse_left == 0.0


def test_initial_pose_topic(node):
    msg = PoseWithCovarianceStamped()
    msg.pose.pose.position.x = 3.5
    msg.pose.pose.position.y = -2.5
    msg.pose.pose.position.z = 0.0
    # 90 degrees yaw: qz = sin(pi/4), qw = cos(pi/4)
    msg.pose.pose.orientation.z = math.sin(math.pi / 4.0)
    msg.pose.pose.orientation.w = math.cos(math.pi / 4.0)

    node.initial_pose_topic_callback(msg)

    assert node.pose['x'] == pytest.approx(3.5)
    assert node.pose['y'] == pytest.approx(-2.5)
    assert node.pose['theta'] == pytest.approx(math.pi / 2.0)
    assert node.pose['vx'] == 0.0
