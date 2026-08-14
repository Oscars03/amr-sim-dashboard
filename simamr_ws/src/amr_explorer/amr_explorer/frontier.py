"""Frontier detection, clearance filtering and goal scoring.

Frontiers are found on the raw occupancy grid (not the inflated one) --
inflation erodes the free space right at a doorway threshold to nothing,
which would silently make every frontier past a narrow gap undetectable.
Reachability is instead enforced separately via the clearance map built
from the *known-occupied* cells.
"""
import math

import numpy as np
from scipy.ndimage import distance_transform_edt, generate_binary_structure, label

from amr_explorer.geometry import normalize_angle

OCC_THRESHOLD = 65


def grid_from_msg(msg):
    res = msg.info.resolution
    origin = (msg.info.origin.position.x, msg.info.origin.position.y)
    w, h = msg.info.width, msg.info.height
    grid = np.asarray(msg.data, dtype=np.int8).reshape(h, w)
    return grid, res, origin


def clearance_map_m(grid, res, occ_threshold=OCC_THRESHOLD):
    """Distance (metres) from every cell to the nearest known-occupied cell."""
    occupied = grid >= occ_threshold
    if not occupied.any():
        return np.full(grid.shape, np.inf, dtype=np.float64)
    return distance_transform_edt(~occupied) * res


def find_frontier_clusters(grid, res, origin, clearance_m, occ_threshold=OCC_THRESHOLD,
                            min_cluster_cells=8):
    """Free cells touching at least one unknown cell, grouped into
    connected clusters. The representative point of each cluster is its
    highest-clearance member cell -- both a sensible aim point (most open
    part of the boundary) and a stable one: a centroid-nearest-member pick
    jitters between neighbouring cells every time SLAM revises the cluster
    shape, which flickers the same conceptual frontier in and out of the
    clearance filter and stalls the robot. Returns a list of dicts with
    grid + world coords."""
    free = (grid >= 0) & (grid < occ_threshold)
    unknown = grid == -1

    adjacent_unknown = np.zeros_like(unknown)
    adjacent_unknown[1:, :] |= unknown[:-1, :]
    adjacent_unknown[:-1, :] |= unknown[1:, :]
    adjacent_unknown[:, 1:] |= unknown[:, :-1]
    adjacent_unknown[:, :-1] |= unknown[:, 1:]

    frontier_mask = free & adjacent_unknown
    structure = generate_binary_structure(2, 2)
    labeled, n = label(frontier_mask, structure=structure)

    clusters = []
    for cid in range(1, n + 1):
        ys, xs = np.nonzero(labeled == cid)
        if len(xs) < min_cluster_cells:
            continue
        best = np.argmax(clearance_m[ys, xs])
        ix, iy = int(xs[best]), int(ys[best])
        wx = origin[0] + (ix + 0.5) * res
        wy = origin[1] + (iy + 0.5) * res
        clusters.append({'ix': ix, 'iy': iy, 'size': len(xs), 'wx': wx, 'wy': wy})
    return clusters


def select_goal(clusters, clearance_m, res, origin, robot_xy, robot_theta,
                 weights, min_clearance, blacklist=None, blacklist_radius=0.6,
                 current_goal=None, hysteresis=0.0):
    """Pick the lowest-cost frontier, honouring the clearance filter, a
    tabu blacklist of recently-failed goals, and goal hysteresis (keep the
    current goal unless a candidate beats its *freshly recomputed* cost by
    more than `hysteresis`).

    Returns ((wx, wy), cost, cluster_size) or (None, None, None).
    """
    h, w = clearance_m.shape
    reachable = []   # passes the clearance filter, blacklist not yet applied
    candidates = []  # reachable AND not blacklisted
    for c in clusters:
        iy = min(max(c['iy'], 0), h - 1)
        ix = min(max(c['ix'], 0), w - 1)
        clr = clearance_m[iy, ix]
        if clr < min_clearance:
            continue
        wx, wy = c['wx'], c['wy']
        d = math.hypot(wx - robot_xy[0], wy - robot_xy[1])
        bearing = math.atan2(wy - robot_xy[1], wx - robot_xy[0])
        dtheta = abs(normalize_angle(bearing - robot_theta))
        info_gain = c['size']
        cost = (weights['w_distance'] * d
                - weights['w_info_gain'] * info_gain
                + weights['w_turn'] * dtheta)
        entry = (cost, wx, wy, c['size'])
        reachable.append(entry)
        if not (blacklist and any(math.hypot(wx - bx, wy - by) < blacklist_radius
                                   for bx, by in blacklist)):
            candidates.append(entry)

    # A tabu list is a preference, not a hard wall -- if every reachable
    # frontier happens to fall within blacklist_radius of a past failure
    # (common right around a single doorway, where every candidate on the
    # far side clusters together), obeying it strictly leaves no goal at
    # all and the robot sits in IDLE forever. Revisiting a recently-failed
    # goal is still better than permanent freeze.
    if not candidates:
        candidates = reachable

    if not candidates:
        return None, None, None

    candidates.sort(key=lambda t: t[0])
    best_cost, best_x, best_y, best_size = candidates[0]

    if current_goal is not None:
        current_match = min(
            (t for t in candidates
             if math.hypot(t[1] - current_goal[0], t[2] - current_goal[1]) < res * 2),
            key=lambda t: t[0], default=None)
        if current_match is not None:
            current_cost = current_match[0]
            if best_cost + hysteresis >= current_cost:
                return current_goal, current_cost, current_match[3]

    return (best_x, best_y), best_cost, best_size
