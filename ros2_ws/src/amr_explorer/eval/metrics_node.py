#!/usr/bin/env python3
"""
metrics_node.py -- the judge. Owns the definition of "done" for one eval run.

Scores an exploration run against the ground truth built by json_to_grid.py
and writes result.json, then shuts itself down. run_eval.py treats this
node's exit as the signal to tear the run down.

Nothing else in the stack is allowed to decide pass/fail. The explorer node
never sees these numbers while it runs -- it must not be able to optimize
against the scorer directly.

Frame note: amr_2dsim publishes odom->base_link using its absolute world
pose, so the odom frame is the world frame of the map JSON. slam_toolbox
initializes map->odom at identity, which makes the map frame world-aligned
too. wall_rmse is the canary here: if it blows up while coverage looks
fine, the frames have drifted apart and the coverage number is meaningless.
"""
import argparse
import json
import math
import os
import sys
import time

import numpy as np
import rclpy
from nav_msgs.msg import OccupancyGrid, Odometry
from rclpy.node import Node
from rclpy.qos import (DurabilityPolicy, HistoryPolicy, QoSProfile,
                       ReliabilityPolicy)
from std_msgs.msg import Bool

# slam_toolbox latches /map; a plain depth-10 subscription silently
# receives nothing until the next republish.
MAP_QOS = QoSProfile(
    depth=1,
    reliability=ReliabilityPolicy.RELIABLE,
    durability=DurabilityPolicy.TRANSIENT_LOCAL,
    history=HistoryPolicy.KEEP_LAST,
)

OCC_THRESHOLD = 65      # >= this in an OccupancyGrid means "occupied"
STUCK_WINDOW_S = 8.0
STUCK_DIST_M = 0.10


class MetricsNode(Node):
    def __init__(self, args):
        super().__init__('eval_metrics')
        self.args = args

        gt = np.load(args.ground_truth)
        self.reachable = gt['reachable']
        self.wall_dist = gt['dist']
        self.gt_origin = gt['origin']
        self.gt_res = float(gt['res'])
        self.gt_radius = float(gt['radius'])

        ys, xs = np.nonzero(self.reachable)
        self.gt_wx = self.gt_origin[0] + (xs + 0.5) * self.gt_res
        self.gt_wy = self.gt_origin[1] + (ys + 0.5) * self.gt_res
        self.total_cells = len(xs)
        self.get_logger().info(
            f"ground truth: {self.total_cells} reachable cells "
            f"({self.total_cells * self.gt_res**2:.2f} m2) @ r={self.gt_radius}")

        # --- run state
        self.t0 = time.time()
        self.coverage = 0.0
        self.wall_rmse = float('nan')
        self.collision_events = 0
        self.contact_duration = 0.0
        self._prev_collision = False
        self._last_collision_stamp = None
        self.stuck_events = 0
        self.distance = 0.0
        self._last_xy = None
        self._window = []          # (t, x, y) for the stuck detector
        self._in_stuck = False
        self._map_msgs = 0
        self.result_written = False

        self.create_subscription(OccupancyGrid, '/map', self.on_map, MAP_QOS)
        self.create_subscription(Bool, '/collision', self.on_collision, 10)
        self.create_subscription(Odometry, '/odom', self.on_odom, 20)
        self.create_timer(1.0, self.on_tick)

    # ------------------------------------------------------------------
    def on_collision(self, msg):
        now = time.time()
        if msg.data:
            # /collision is a level, published every sim tick at 20 Hz --
            # count the rising edge, not the samples, or one scrape against
            # a wall reads as hundreds of separate collisions.
            if not self._prev_collision:
                self.collision_events += 1
                self.get_logger().error(
                    f"COLLISION #{self.collision_events} at t={now - self.t0:.1f}s")
            if self._last_collision_stamp is not None:
                self.contact_duration += now - self._last_collision_stamp
            self._last_collision_stamp = now
        else:
            self._last_collision_stamp = None
        self._prev_collision = bool(msg.data)

    def on_odom(self, msg):
        p = msg.pose.pose.position
        now = time.time()
        if self._last_xy is not None:
            self.distance += math.hypot(p.x - self._last_xy[0], p.y - self._last_xy[1])
        self._last_xy = (p.x, p.y)

        self._window.append((now, p.x, p.y))
        while self._window and now - self._window[0][0] > STUCK_WINDOW_S:
            self._window.pop(0)
        if len(self._window) > 20 and now - self._window[0][0] >= STUCK_WINDOW_S * 0.9:
            xs = [w[1] for w in self._window]
            ys = [w[2] for w in self._window]
            spread = math.hypot(max(xs) - min(xs), max(ys) - min(ys))
            if spread < STUCK_DIST_M:
                # Latch so one long stall counts once, not once per second.
                if not self._in_stuck:
                    self.stuck_events += 1
                    self._in_stuck = True
                    self.get_logger().warning(
                        f"stuck #{self.stuck_events} at ({p.x:.2f}, {p.y:.2f})")
            else:
                self._in_stuck = False

    def on_map(self, msg):
        self._map_msgs += 1
        res = msg.info.resolution
        ox = msg.info.origin.position.x
        oy = msg.info.origin.position.y
        w, h = msg.info.width, msg.info.height
        grid = np.asarray(msg.data, dtype=np.int8).reshape(h, w)

        # coverage: ground-truth reachable cells that SLAM has resolved
        ix = np.floor((self.gt_wx - ox) / res).astype(int)
        iy = np.floor((self.gt_wy - oy) / res).astype(int)
        inside = (ix >= 0) & (ix < w) & (iy >= 0) & (iy < h)
        known = np.zeros(self.total_cells, dtype=bool)
        known[inside] = grid[iy[inside], ix[inside]] != -1
        self.coverage = 100.0 * known.sum() / self.total_cells

        # wall_rmse: how far SLAM's occupied cells sit from the true walls
        oy_i, ox_i = np.nonzero(grid >= OCC_THRESHOLD)
        if len(ox_i):
            wx = ox + (ox_i + 0.5) * res
            wy = oy + (oy_i + 0.5) * res
            gx = np.floor((wx - self.gt_origin[0]) / self.gt_res).astype(int)
            gy = np.floor((wy - self.gt_origin[1]) / self.gt_res).astype(int)
            ok = ((gx >= 0) & (gx < self.wall_dist.shape[1]) &
                  (gy >= 0) & (gy < self.wall_dist.shape[0]))
            if ok.any():
                d = self.wall_dist[gy[ok], gx[ok]]
                self.wall_rmse = float(np.sqrt(np.mean(d ** 2)))

    # ------------------------------------------------------------------
    def on_tick(self):
        elapsed = time.time() - self.t0
        self.get_logger().info(
            f"t={elapsed:5.1f}s  cov={self.coverage:5.1f}%  "
            f"col={self.collision_events}  rmse={self.wall_rmse:.3f}  "
            f"stuck={self.stuck_events}  dist={self.distance:.1f}m")

        if self.collision_events > 0:
            return self.finish(False, 'collision')
        if self._map_msgs == 0 and elapsed > 30.0:
            return self.finish(False, 'no_map_received')
        if self.coverage >= self.args.target_coverage:
            return self.finish(True, None)
        if elapsed > self.args.timeout:
            return self.finish(False, 'timeout')

    def finish(self, completed, fail_reason):
        if self.result_written:
            return
        elapsed = time.time() - self.t0
        if completed and not math.isnan(self.wall_rmse) \
                and self.wall_rmse > self.args.max_rmse:
            completed, fail_reason = False, 'map_distorted'

        result = {
            'seed': self.args.seed,
            'initial_pose': self.args.initial_pose,
            'coverage_pct': round(self.coverage, 2),
            'collision_events': self.collision_events,
            'contact_duration_s': round(self.contact_duration, 2),
            'wall_rmse_m': (None if math.isnan(self.wall_rmse)
                            else round(self.wall_rmse, 4)),
            'elapsed_s': round(elapsed, 1),
            'stuck_events': self.stuck_events,
            'distance_m': round(self.distance, 1),
            'completed': bool(completed),
            'fail_reason': fail_reason,
        }
        os.makedirs(os.path.dirname(os.path.abspath(self.args.out)), exist_ok=True)
        with open(self.args.out, 'w') as f:
            json.dump(result, f, indent=2)
        self.result_written = True
        self.get_logger().info(f"RESULT {json.dumps(result)}")
        raise SystemExit(0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ground-truth', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--initial-pose', default='[0.0, 0.0, 0.0]')
    ap.add_argument('--timeout', type=float, default=300.0)
    ap.add_argument('--target-coverage', type=float, default=95.0)
    ap.add_argument('--max-rmse', type=float, default=0.10)
    args, ros_args = ap.parse_known_args()

    rclpy.init(args=ros_args)
    node = MetricsNode(args)
    try:
        rclpy.spin(node)
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        if not node.result_written:
            node.finish(False, 'aborted')
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()
    return 0


if __name__ == '__main__':
    sys.exit(main())
