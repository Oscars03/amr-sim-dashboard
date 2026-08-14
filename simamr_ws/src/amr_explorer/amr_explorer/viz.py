"""rviz markers for frontiers and the current goal."""
from geometry_msgs.msg import Point
from std_msgs.msg import ColorRGBA
from visualization_msgs.msg import Marker, MarkerArray


def frontier_markers(clusters, frame_id, stamp, chosen_wx=None, chosen_wy=None):
    arr = MarkerArray()

    points = Marker()
    points.header.frame_id = frame_id
    points.header.stamp = stamp
    points.ns = 'frontiers'
    points.id = 0
    points.type = Marker.SPHERE_LIST
    points.action = Marker.ADD
    points.scale.x = points.scale.y = points.scale.z = 0.15
    points.color = ColorRGBA(r=1.0, g=0.6, b=0.0, a=0.9)
    for c in clusters:
        points.points.append(Point(x=c['wx'], y=c['wy'], z=0.1))
    arr.markers.append(points)

    goal = Marker()
    goal.header.frame_id = frame_id
    goal.header.stamp = stamp
    goal.ns = 'chosen_goal'
    goal.id = 1
    goal.type = Marker.SPHERE
    goal.action = Marker.ADD if chosen_wx is not None else Marker.DELETE
    goal.scale.x = goal.scale.y = goal.scale.z = 0.35
    goal.color = ColorRGBA(r=0.1, g=1.0, b=0.1, a=0.9)
    if chosen_wx is not None:
        goal.pose.position.x = chosen_wx
        goal.pose.position.y = chosen_wy
        goal.pose.position.z = 0.15
        goal.pose.orientation.w = 1.0
    arr.markers.append(goal)

    return arr
