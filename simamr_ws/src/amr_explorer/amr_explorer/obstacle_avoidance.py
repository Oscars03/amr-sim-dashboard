#!/usr/bin/env python3
"""obstacle_avoidance -- amr_explorer's node: safety FSM, DWA local planner
with a doorway mode, and frontier-driven exploration.

Control loop (control_rate Hz):
  1. Read pose from the map->base_link TF (not /odom -- loop closures move
     the robot within the map and a controller reading raw odometry won't
     see it; wall_rmse is the canary for this class of bug).
  2. Read body-frame velocity from /odom.twist (unaffected by map drift).
  3. Convert /scan to base_link-frame points (laser is 0.2 m forward of
     base_link; collision is a circle around base_link).
  4. Safety layer: cap DWA's linear-velocity window from scan clearance;
     hard BACKOFF if something is already inside stop_dist. In-place
     rotation never needs gating -- a circular footprint spinning about its
     own centre never gets closer to a static wall.
  5. Doorway layer: if a wall-opening-wall gap is found ahead and roughly
     toward the goal, override DWA with align-then-through.
  6. Otherwise run DWA toward the current frontier goal, replanned every
     replan_period seconds with hysteresis so the goal doesn't thrash.
"""
import math
import time

import numpy as np
import rclpy
import tf2_ros
from geometry_msgs.msg import PoseStamped, Twist
from nav_msgs.msg import OccupancyGrid, Odometry
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, HistoryPolicy, QoSProfile, ReliabilityPolicy
from sensor_msgs.msg import LaserScan
from std_msgs.msg import String
from visualization_msgs.msg import MarkerArray

from amr_explorer import frontier, viz
from amr_explorer.geometry import normalize_angle
from amr_explorer.local_planner import DWAPlanner, find_gaps, min_clearance_ahead, scan_to_base

MAP_QOS = QoSProfile(
    depth=1,
    reliability=ReliabilityPolicy.RELIABLE,
    durability=DurabilityPolicy.TRANSIENT_LOCAL,
    history=HistoryPolicy.KEEP_LAST,
)

PARAM_DEFAULTS = {
    'robot_radius': 0.35,
    'laser_offset_x': 0.2,
    'control_rate': 10.0,
    'max_linear_vel': 0.45,
    'min_linear_vel': -0.15,
    'max_angular_vel': 1.0,
    'linear_accel': 0.6,
    'angular_accel': 1.8,
    'dwa_sim_time': 1.5,
    'dwa_v_samples': 7,
    'dwa_w_samples': 15,
    'w_heading': 1.0,
    'w_clearance': 2.0,
    'w_velocity': 0.4,
    'slow_dist': 0.60,
    'stop_dist': 0.30,
    'backoff_dist': 0.30,
    'stuck_window_s': 6.0,
    'stuck_dist': 0.10,
    'doorway_clearance': 0.55,
    'doorway_vel': 0.15,
    'doorway_align_tol': 0.10,
    'min_frontier_cells': 8,
    'frontier_min_clearance': 0.40,
    'goal_tolerance': 0.35,
    'replan_period': 1.0,
    'goal_hysteresis': 0.20,
    'w_distance': 1.0,
    'w_info_gain': 2.5,
    'w_turn': 0.8,
}

DOORWAY_ENGAGE_RANGE_M = 2.0
DOORWAY_GOAL_ALIGN_MAX = math.radians(70)
DOORWAY_THROUGH_DIST_M = 1.4
DOORWAY_MAX_TIME_S = 10.0
DOORWAY_EMERGENCY_DIST = 0.15
BACKOFF_MIN_DURATION_S = 1.0
STUCK_RECOVERY_TIME_S = 3.0
BLACKLIST_TTL_S = 60.0


class ObstacleAvoidance(Node):
    def __init__(self):
        super().__init__('obstacle_avoidance')
        for name, default in PARAM_DEFAULTS.items():
            self.declare_parameter(name, default)
        self.p = {name: self.get_parameter(name).value for name in PARAM_DEFAULTS}

        self.dwa = DWAPlanner(self.p)

        self.tf_buffer = tf2_ros.Buffer()
        self.tf_listener = tf2_ros.TransformListener(self.tf_buffer, self)

        self.cmd_pub = self.create_publisher(Twist, '/cmd_vel', 10)
        self.frontier_pub = self.create_publisher(MarkerArray, '/explorer/frontiers', 10)
        self.goal_pub = self.create_publisher(PoseStamped, '/explorer/goal', 10)
        self.state_pub = self.create_publisher(String, '/explorer/state', 10)

        self.create_subscription(LaserScan, '/scan', self.on_scan, 10)
        self.create_subscription(OccupancyGrid, '/map', self.on_map, MAP_QOS)
        self.create_subscription(Odometry, '/odom', self.on_odom, 20)

        self.latest_scan = None
        self.latest_map = None
        self.v_now = 0.0
        self.w_now = 0.0

        self.state = 'INIT'
        self.goal = None
        self.pose_history = []  # (t, x, y)
        self.blacklist = []     # (x, y, t)
        self.last_replan_t = 0.0
        self.doorway_target_bearing = None
        self.doorway_through_start = None
        self.doorway_enter_t = None
        self.stuck_recovery_start = None
        self.backoff_enter_t = 0.0

        self.create_timer(1.0 / self.p['control_rate'], self.control_loop)

    # ------------------------------------------------------------------
    def on_scan(self, msg):
        self.latest_scan = msg

    def on_map(self, msg):
        self.latest_map = msg

    def on_odom(self, msg):
        self.v_now = msg.twist.twist.linear.x
        self.w_now = msg.twist.twist.angular.z

    # ------------------------------------------------------------------
    def get_pose(self):
        try:
            t = self.tf_buffer.lookup_transform('map', 'base_link', rclpy.time.Time())
        except (tf2_ros.LookupException, tf2_ros.ConnectivityException,
                tf2_ros.ExtrapolationException):
            return None
        q = t.transform.rotation
        yaw = math.atan2(2.0 * (q.w * q.z + q.x * q.y), 1.0 - 2.0 * (q.y * q.y + q.z * q.z))
        return (t.transform.translation.x, t.transform.translation.y, yaw)

    def publish_cmd(self, v, w):
        msg = Twist()
        msg.linear.x = v
        msg.angular.z = w
        self.cmd_pub.publish(msg)

    def publish_state(self, extra=''):
        self.state_pub.publish(String(data=f'{self.state}{extra}'))

    def update_stuck(self, now, x, y):
        self.pose_history.append((now, x, y))
        while self.pose_history and now - self.pose_history[0][0] > self.p['stuck_window_s']:
            self.pose_history.pop(0)
        if len(self.pose_history) < 5 or now - self.pose_history[0][0] < self.p['stuck_window_s'] * 0.9:
            return False
        xs = [w[1] for w in self.pose_history]
        ys = [w[2] for w in self.pose_history]
        spread = math.hypot(max(xs) - min(xs), max(ys) - min(ys))
        return spread < self.p['stuck_dist']

    def prune_blacklist(self, now):
        self.blacklist = [(x, y, t) for x, y, t in self.blacklist if now - t < BLACKLIST_TTL_S]

    # ------------------------------------------------------------------
    def control_loop(self):
        now = time.time()
        pose = self.get_pose()
        if pose is None or self.latest_scan is None or self.latest_map is None:
            self.publish_cmd(0.0, 0.0)
            self.state = 'INIT'
            self.publish_state()
            return

        x, y, theta = pose
        x_base, y_base, ranges, bearings = scan_to_base(self.latest_scan, self.p['laser_offset_x'])
        front_clear = min_clearance_ahead(x_base, y_base, ranges, self.p['robot_radius'],
                                           half_angle=math.radians(50), center_bearing=0.0)
        rear_clear = min_clearance_ahead(x_base, y_base, ranges, self.p['robot_radius'],
                                          half_angle=math.radians(50), center_bearing=math.pi)

        # DOORWAY_ALIGN deliberately holds position (v=0) while rotating to
        # face the gap -- that's not stuck, it's working. Its own
        # DOORWAY_MAX_TIME_S timeout is what gives up on a bad alignment.
        stuck_exempt = self.state == 'DOORWAY_ALIGN'
        is_stuck = self.update_stuck(now, x, y) and not stuck_exempt
        self.prune_blacklist(now)

        self.get_logger().info(
            f"state={self.state} pose=({x:.2f},{y:.2f},{theta:.2f}) "
            f"front={front_clear:.2f} rear={rear_clear:.2f} stuck={is_stuck} "
            f"goal={self.goal} clusters={len(getattr(self, '_last_clusters', []))} "
            f"blacklist={len(self.blacklist)} v_now={self.v_now:.3f} w_now={self.w_now:.3f}",
            throttle_duration_sec=1.0)

        # --- safety takes priority over everything else. DOORWAY_ALIGN never
        # commands v > 0 -- in-place rotation can't get closer to a static
        # wall, so a front-clearance dip there is not a translation risk and
        # must not steal the state (it was clobbering the stuck exemption
        # above, which then fired STUCK_RECOVERY on a perfectly good align).
        #
        # DOORWAY_THROUGH gets a *tighter* threshold instead of a full
        # exemption. Fully exempting it (tried in a previous iteration) let
        # a slightly-off-angle approach collapse front_clear 0.34 -> 0.00 in
        # 5 ticks with nothing to catch it -- real wall contact. But gating
        # on the open-space stop_dist re-introduced the opposite bug: a
        # normal, safe gap crossing dips under stop_dist by design (already
        # validated by the pre-commit find_gaps width check) and got
        # endlessly retreated-and-retried. DOORWAY_EMERGENCY_DIST is the
        # compromise -- ignore the expected close pass, still abort before
        # actual contact.
        if self.state == 'DOORWAY_THROUGH':
            unsafe = front_clear < DOORWAY_EMERGENCY_DIST
        else:
            unsafe = front_clear < self.p['stop_dist']
        if unsafe and self.state not in ('BACKOFF', 'DOORWAY_ALIGN'):
            self.state = 'BACKOFF'
            self.backoff_enter_t = now
        # A single tick of reverse (~1.5cm at min_linear_vel) was enough to
        # clear stop_dist+0.05 from point-blank range, so BACKOFF kept
        # exiting after one tick and immediately re-lunging from virtually
        # the same spot and angle -- hundreds of retreat/re-attempt cycles
        # at the same doorway without ever repositioning enough to fix a
        # bad approach angle. Commit to a minimum retreat duration so it
        # actually gains room to re-align differently.
        elif (self.state == 'BACKOFF' and front_clear > self.p['stop_dist'] + 0.05
              and now - self.backoff_enter_t >= BACKOFF_MIN_DURATION_S):
            self.state = 'NORMAL'

        if self.state == 'BACKOFF':
            if rear_clear > self.p['stop_dist']:
                self.publish_cmd(self.p['min_linear_vel'], 0.0)
            else:
                self.publish_cmd(0.0, self.p['max_angular_vel'] * 0.5)
            self.publish_state()
            return

        # --- stuck recovery (only once safety is clear)
        if is_stuck and self.state not in ('STUCK_RECOVERY',):
            self.state = 'STUCK_RECOVERY'
            self.stuck_recovery_start = now
            if self.goal is not None:
                self.blacklist.append((self.goal[0], self.goal[1], now))
                self.goal = None

        if self.state == 'STUCK_RECOVERY':
            if now - self.stuck_recovery_start > STUCK_RECOVERY_TIME_S:
                self.state = 'NORMAL'
                self.pose_history = []
            else:
                self.publish_cmd(0.0, self.p['max_angular_vel'] * 0.6)
                self.publish_state()
                return

        # --- replan goal
        if self.goal is not None and math.hypot(self.goal[0] - x, self.goal[1] - y) < self.p['goal_tolerance']:
            self.goal = None

        if self.goal is None or now - self.last_replan_t > self.p['replan_period']:
            self.last_replan_t = now
            self.replan(x, y, theta)

        if self.goal is None:
            self.state = 'IDLE'
            self.publish_cmd(0.0, 0.0)
            self.publish_state()
            self.publish_viz(x, y, theta)
            return

        goal_bearing_world = math.atan2(self.goal[1] - y, self.goal[0] - x)
        goal_bearing = normalize_angle(goal_bearing_world - theta)

        # --- doorway detection/override. Strict width filter to *commit*
        # from NORMAL (avoid phantom-gap lock-on) and while still aligning
        # (the wider band can admit two plausible-width gaps at once,
        # which made the align target flip-flop between them every tick
        # and never converge -- ALIGN hasn't committed to any motion yet,
        # so there's no noise-tolerance argument for loosening it). Only
        # DOORWAY_THROUGH gets the lenient band, to keep tracking an
        # already-committed gap through ordinary motion noise.
        gaps = find_gaps(x_base, y_base, ranges, bearings, self.p['robot_radius'],
                          strict=self.state != 'DOORWAY_THROUGH')
        aligned_gap = next(
            (g for g in gaps
             if g[2] < DOORWAY_ENGAGE_RANGE_M and abs(normalize_angle(g[1] - goal_bearing)) < DOORWAY_GOAL_ALIGN_MAX),
            None)

        if self.state not in ('DOORWAY_ALIGN', 'DOORWAY_THROUGH') and aligned_gap is not None:
            self.state = 'DOORWAY_ALIGN'
            self.doorway_target_bearing = aligned_gap[1]
            self.doorway_enter_t = now

        if self.state in ('DOORWAY_ALIGN', 'DOORWAY_THROUGH'):
            if now - self.doorway_enter_t > DOORWAY_MAX_TIME_S:
                self.state = 'NORMAL'
                # Align held position on purpose; don't let those frozen
                # samples immediately read as "stuck" now that NORMAL is
                # no longer exempt from the position-stuck check.
                self.pose_history = []
            else:
                if aligned_gap is not None:
                    self.doorway_target_bearing = aligned_gap[1]
                v, w, done = self.run_doorway(now, x, y)
                self.publish_cmd(v, w)
                self.publish_state()
                self.publish_viz(x, y, theta)
                if done:
                    self.state = 'NORMAL'
                return

        # --- normal DWA
        v_max = self.p['max_linear_vel']
        if front_clear < self.p['slow_dist']:
            span = max(self.p['slow_dist'] - self.p['stop_dist'], 1e-3)
            frac = max(0.0, min(1.0, (front_clear - self.p['stop_dist']) / span))
            v_max = self.p['doorway_vel'] + frac * (self.p['max_linear_vel'] - self.p['doorway_vel'])

        v, w = self.dwa.plan(self.v_now, self.w_now, goal_bearing, x_base, y_base,
                              v_max_override=v_max)
        self.get_logger().info(
            f"dwa: v0={self.v_now:.3f} w0={self.w_now:.3f} v_max={v_max:.3f} "
            f"goal_bearing={goal_bearing:.3f} -> v={v:.3f} w={w:.3f}",
            throttle_duration_sec=0.5)
        self.state = 'NORMAL'
        self.publish_cmd(v, w)
        self.publish_state()
        self.publish_viz(x, y, theta)

    # ------------------------------------------------------------------
    def run_doorway(self, now, x, y):
        bearing = self.doorway_target_bearing
        if self.state == 'DOORWAY_ALIGN':
            self.get_logger().info(f"align: bearing={bearing:.3f}", throttle_duration_sec=0.3)
            if abs(bearing) < self.p['doorway_align_tol']:
                self.state = 'DOORWAY_THROUGH'
                self.doorway_through_start = (x, y, now)
                self.pose_history = []  # align held position -- don't count that against THROUGH
                return self.p['doorway_vel'], 0.0, False
            w = max(-self.p['max_angular_vel'], min(self.p['max_angular_vel'], 2.0 * bearing))
            return 0.0, w, False

        # DOORWAY_THROUGH. ALIGN already validated a real gap before
        # committing here -- re-proving it exists every tick during the
        # crossing itself is fragile (ordinary motion noise repeatedly
        # dropped detection well before reaching the tight part of the
        # gap, aborting a good crossing partway through every single
        # attempt). Once committed, drive the distance on the last-known
        # bearing correction; DOORWAY_MAX_TIME_S (checked by the caller)
        # and DOORWAY_EMERGENCY_DIST remain as the actual safety backstops.
        sx, sy, st = self.doorway_through_start
        traveled = math.hypot(x - sx, y - sy)
        if traveled > DOORWAY_THROUGH_DIST_M:
            self.get_logger().info(f"through done: traveled={traveled:.2f}")
            return 0.0, 0.0, True
        w = max(-0.5, min(0.5, 2.0 * bearing))
        return self.p['doorway_vel'], w, False

    # ------------------------------------------------------------------
    def replan(self, x, y, theta):
        grid, res, origin = frontier.grid_from_msg(self.latest_map)
        clearance = frontier.clearance_map_m(grid, res)
        clusters = frontier.find_frontier_clusters(
            grid, res, origin, clearance, min_cluster_cells=self.p['min_frontier_cells'])
        weights = {'w_distance': self.p['w_distance'],
                   'w_info_gain': self.p['w_info_gain'],
                   'w_turn': self.p['w_turn']}
        blacklist_xy = [(bx, by) for bx, by, _ in self.blacklist]
        goal, cost, size = frontier.select_goal(
            clusters, clearance, res, origin, (x, y), theta, weights,
            self.p['frontier_min_clearance'], blacklist=blacklist_xy,
            current_goal=self.goal, hysteresis=self.p['goal_hysteresis'])
        self.get_logger().info(
            f"replan: {len(clusters)} clusters -> goal={goal} cost={cost} size={size}",
            throttle_duration_sec=1.0)
        self.goal = goal
        self._last_clusters = clusters

    def publish_viz(self, x, y, theta):
        clusters = getattr(self, '_last_clusters', [])
        stamp = self.get_clock().now().to_msg()
        gx, gy = (self.goal[0], self.goal[1]) if self.goal else (None, None)
        self.frontier_pub.publish(viz.frontier_markers(clusters, 'map', stamp, gx, gy))
        if self.goal is not None:
            ps = PoseStamped()
            ps.header.frame_id = 'map'
            ps.header.stamp = stamp
            ps.pose.position.x = self.goal[0]
            ps.pose.position.y = self.goal[1]
            ps.pose.orientation.w = 1.0
            self.goal_pub.publish(ps)


def main():
    rclpy.init()
    node = ObstacleAvoidance()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == '__main__':
    main()
