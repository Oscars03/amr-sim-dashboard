"""DWA local planner plus laser-based doorway/gap detection.

The laser is 0.2 m forward of base_link but collision is a circle of
radius robot_radius around base_link -- every range here is converted to
base_link-frame Cartesian points before it is used for clearance, per the
warning in CLAUDE.md.
"""
import math

import numpy as np

from amr_explorer.geometry import normalize_angle

WALL_NEAR_M = 1.8       # a beam this close is "wall", not "opening"
GAP_SEARCH_HALF_ANGLE = math.radians(100)
GAP_SEARCH_RANGE_M = 3.5

# Gap-width ceiling, expressed as a multiple of the robot's own min_fit
# (2*robot_radius + margin) rather than any map's known door size -- see
# find_gaps() for why commit vs. track need different tolerances.
COMMIT_WIDTH_FACTOR = 1.4
TRACK_WIDTH_FACTOR = 1.8


def scan_to_base(scan, laser_offset_x):
    """Returns (x_base, y_base, ranges, bearings) for finite, in-range
    beams. `bearings` are already base_link-relative: laser_joint has zero
    rotation relative to base_link, so the LaserScan's own angle field
    (angle_min + i*increment) IS the base-relative bearing."""
    ranges = np.asarray(scan.ranges, dtype=np.float64)
    n = len(ranges)
    bearings = scan.angle_min + np.arange(n, dtype=np.float64) * scan.angle_increment
    bearings = np.vectorize(normalize_angle)(bearings)
    # range == range_max means "no hit", not "a wall 12 m away" -- drop it,
    # or every tick's obstacle cloud carries ~360 phantom far points.
    valid = np.isfinite(ranges) & (ranges >= scan.range_min) & (ranges < scan.range_max - 1e-3)
    r = ranges[valid]
    b = bearings[valid]
    x_base = laser_offset_x + r * np.cos(b)
    y_base = r * np.sin(b)
    return x_base, y_base, r, b


def min_clearance_ahead(x_base, y_base, ranges, robot_radius, half_angle,
                         center_bearing=0.0, max_range=None):
    """Minimum (distance-from-base_link-centre - robot_radius) among beams
    within `half_angle` of `center_bearing`. Beams at scan.range_max mean
    "no return" and are excluded from the point cloud already (caller
    should pass only real hits) unless max_range narrows the cone further."""
    if len(x_base) == 0:
        return math.inf
    bearings = np.arctan2(y_base, x_base)
    dtheta = np.abs(np.vectorize(normalize_angle)(bearings - center_bearing))
    mask = dtheta <= half_angle
    if max_range is not None:
        mask &= ranges <= max_range
    if not mask.any():
        return math.inf
    d = np.hypot(x_base[mask], y_base[mask])
    return float(d.min() - robot_radius)


def find_gaps(x_base, y_base, ranges, bearings, robot_radius, strict=True):
    """Classic wall-opening-wall gap detector. Scans a forward angular
    window in angle order for a near-wall beam, a run of far/open beams,
    then a near-wall beam again -- the two boundary beams are the doorway
    posts. Returns a list of (width_m, bearing_to_center, dist_to_center),
    nearest first.

    The width ceiling is expressed relative to the robot's own minimum-fit
    width (`min_fit`, purely a function of `robot_radius`), not any
    specific map's known door size -- this has to hold up on maps this
    code has never seen, not just office.json.

    `strict` picks which multiple of `min_fit` is used. True (the
    default) is for deciding whether to *commit* to entering doorway mode
    from NORMAL -- tight, so a coincidental wide pairing between two
    unrelated wall features in an open multi-room area doesn't get
    mistaken for a tight passage (a phantom gap that previously stranded
    the robot aimed at empty space). False is for re-checking "is there
    still a gap roughly here" once already inside DOORWAY_ALIGN/THROUGH --
    the strict band sits close enough to a snug doorway's true width that
    ordinary measurement noise while moving intermittently dropped a
    real, already-committed-to gap out of detection, aborting the
    crossing right before completion. Once committed, minor noise on the
    re-check isn't a reason to bail.
    """
    mask = np.abs(bearings) <= GAP_SEARCH_HALF_ANGLE
    if mask.sum() < 5:
        return []
    idx = np.where(mask)[0]
    order = idx[np.argsort(bearings[idx])]
    r = ranges[order]
    x = x_base[order]
    y = y_base[order]

    min_fit = 2.0 * robot_radius + 0.05
    max_fit = min_fit * (COMMIT_WIDTH_FACTOR if strict else TRACK_WIDTH_FACTOR)

    gaps = []
    i = 0
    n = len(order)
    while i < n:
        if r[i] >= WALL_NEAR_M:
            i += 1
            continue
        # r[i] is a near/wall beam (the left post) -- skip over the open
        # run that follows it to find the wall beam that closes it again
        # (the right post). j must land back on a NEAR beam, not the first
        # beam that happens to be open.
        j = i + 1
        while j < n and r[j] >= WALL_NEAR_M:
            j += 1
        if j >= n:
            break  # opened up but never closed again within the window
        if j == i + 1:
            i += 1
            continue  # no open run at all -- adjacent wall beams, not a gap
        width = math.hypot(x[j] - x[i], y[j] - y[i])
        if min_fit <= width <= max_fit and (r[i] < GAP_SEARCH_RANGE_M or r[j] < GAP_SEARCH_RANGE_M):
            mx, my = (x[i] + x[j]) / 2.0, (y[i] + y[j]) / 2.0
            gaps.append((width, math.atan2(my, mx), math.hypot(mx, my)))
        i = j
    gaps.sort(key=lambda g: g[2])
    return gaps


class DWAPlanner:
    def __init__(self, params):
        self.p = params

    def plan(self, v0, w0, goal_bearing, x_base, y_base, v_max_override=None):
        p = self.p
        dt = 1.0 / p['control_rate']
        v_lo = max(p['min_linear_vel'], v0 - p['linear_accel'] * dt)
        v_hi = min(p['max_linear_vel'], v0 + p['linear_accel'] * dt)
        if v_max_override is not None:
            v_hi = min(v_hi, v_max_override)
            v_lo = min(v_lo, v_hi)
        w_lo = max(-p['max_angular_vel'], w0 - p['angular_accel'] * dt)
        w_hi = min(p['max_angular_vel'], w0 + p['angular_accel'] * dt)

        vs = np.linspace(v_lo, v_hi, max(p['dwa_v_samples'], 1))
        ws = np.linspace(w_lo, w_hi, max(p['dwa_w_samples'], 1))

        sim_time = p['dwa_sim_time']
        steps = max(int(sim_time / dt), 1)
        radius = p['robot_radius']

        best_score = -math.inf
        best_v, best_w = 0.0, 0.0
        any_admissible = False

        for v in vs:
            for w in ws:
                theta = 0.0
                x = y = 0.0
                collided = False
                min_clear = math.inf
                for s in range(steps):
                    theta += w * dt
                    x += v * math.cos(theta) * dt
                    y += v * math.sin(theta) * dt
                    if len(x_base):
                        d = np.hypot(x_base - x, y_base - y)
                        c = float(d.min()) - radius
                        min_clear = min(min_clear, c)
                        if c < 0.0:
                            collided = True
                            break
                if collided:
                    continue
                any_admissible = True

                final_bearing_to_goal = normalize_angle(goal_bearing - theta)
                heading_score = 1.0 - abs(final_bearing_to_goal) / math.pi
                clearance_score = max(0.0, min(min_clear, p['slow_dist'])) / p['slow_dist']
                velocity_score = max(v, 0.0) / max(p['max_linear_vel'], 1e-6)

                score = (p['w_heading'] * heading_score
                         + p['w_clearance'] * clearance_score
                         + p['w_velocity'] * velocity_score)
                if score > best_score:
                    best_score = score
                    best_v, best_w = float(v), float(w)

        if not any_admissible:
            # Nothing is admissible -- rotate toward the side with more
            # room instead of freezing (safety FSM handles true contact).
            spin = p['max_angular_vel'] * 0.5
            best_v = 0.0
            best_w = spin if goal_bearing >= 0 else -spin
        return best_v, best_w
