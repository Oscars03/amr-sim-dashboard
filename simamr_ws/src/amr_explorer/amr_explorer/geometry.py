"""Small shared math helpers used by frontier.py, local_planner.py and
obstacle_avoidance.py -- kept in one place instead of copy-pasted three
times."""
import math


def normalize_angle(a):
    """Wrap to (-pi, pi]."""
    return math.atan2(math.sin(a), math.cos(a))


def yaw_from_quaternion(q):
    """geometry_msgs/Quaternion -> yaw (rad). Robot only ever has roll=pitch=0."""
    siny_cosp = 2.0 * (q.w * q.z + q.x * q.y)
    cosy_cosp = 1.0 - 2.0 * (q.y * q.y + q.z * q.z)
    return math.atan2(siny_cosp, cosy_cosp)


def quaternion_from_yaw(yaw):
    return (0.0, 0.0, math.sin(yaw / 2.0), math.cos(yaw / 2.0))
