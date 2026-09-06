import pytest
import rclpy
from sensor_msgs.msg import Image
from std_msgs.msg import Empty
from amr_2dsim.simulator_node import AmrSimulator


@pytest.fixture
def node():
    rclpy.init()
    n = AmrSimulator()
    n.pose = {'x': 0.0, 'y': 0.0, 'theta': 0.0}
    yield n
    n.destroy_node()
    rclpy.shutdown()


def test_camera_publishes_valid_image(node):
    captured = []
    node.camera_pub.publish = captured.append
    node.stamp = node.get_clock().now().to_msg()
    node.publish_camera()

    assert len(captured) == 1
    msg = captured[0]
    assert isinstance(msg, Image)
    assert msg.width == 320
    assert msg.height == 240
    assert msg.encoding == 'rgb8'
    assert msg.step == 320 * 3
    assert len(msg.data) == 320 * 240 * 3


def test_camera_shutter_triggers_image_publish(node):
    captured = []
    node.camera_pub.publish = captured.append
    node.stamp = node.get_clock().now().to_msg()

    # Trigger shutter
    node.camera_shutter_callback(Empty())

    assert len(captured) == 1
    msg = captured[0]
    assert msg.width == 320
    assert msg.height == 240
    assert len(msg.data) == 320 * 240 * 3
