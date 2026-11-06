"""Scripted drive through AmrSimulator recording every output a default robot produces.

Used by test_default_invariance.py to prove that the sim-fidelity knobs (odometry error,
IMU source/noise, wheel slip, understeer, yaw-rate lag, drive latency) change nothing for
a URDF that does not set them. The golden files in test/data/ were generated with this
script from a clean export of amr-sim-dashboard origin/main 96efcfa, BEFORE any of those
knobs existed:

    cd simamr_ws/src/amr_2dsim && python3 test/default_trace.py     # rewrites test/data/*.json.gz

Regenerate them only from a commit that is known to be behaviour-identical, never to make
the invariance test pass.

The drive is deterministic: time.time() is replaced by a fake clock that advances exactly
0.05 s per tick, and the publishers are replaced by recorders. Header stamps (wall clock)
are not recorded. Each robot's sequence covers a straight, a turn, a reverse, a direction
flip (a cusp, with Rhino's 200 ms pre-steer hold), a v = 0 turn and a drive into a wall
(collision, sliding).

VARIANTS: urdf/amr.urdf and urdf/rhino.urdf as shipped, plus three that add existing (pre-
fidelity) tags so the code paths those robots never touch are pinned too: rhino_a4 is
exactly the rhino.urdf of exp/legA-backlash-drive-latency a93af01, the build the thesis
harness (a4_campaign_runs.sh) runs -- main + steering play, zero offset, drive response
and steering latency; amr_accel / rhino_accel set the acceleration limits.
"""
import gzip
import hashlib
import json
import os
import shutil
import sys
import tempfile
import time as _time_mod

import numpy as np
import rclpy

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
if PKG not in sys.path:
    sys.path.insert(0, PKG)

from amr_2dsim import simulator_node  # noqa: E402
from amr_2dsim.simulator_node import AmrSimulator  # noqa: E402

DT = 0.05
T0 = 1000.0

# (vx, vy, w, seconds)
SEQUENCES = {
    'amr': [
        (0.5, 0.0, 0.0, 3.0),     # straight
        (0.4, 0.0, 0.5, 3.0),     # left turn
        (-0.3, 0.0, -0.4, 2.0),   # reverse
        (0.3, 0.0, 0.3, 2.0),     # direction flip
        (0.0, 0.0, 0.8, 1.0),     # spin in place
        (0.8, 0.0, 0.0, 10.0),    # into a wall: collision, sliding
        (0.0, 0.0, 0.0, 0.5),     # stop
    ],
    'rhino': [
        (0.3, 0.0, 0.0, 2.0),     # straight
        (0.3, 0.0, 0.2, 3.0),     # left turn
        (-0.3, 0.0, 0.2, 2.0),    # cusp: reverse, 200 ms pre-steer hold
        (-0.3, 0.0, 0.0, 1.5),    # reverse straight
        (0.3, 0.0, -0.3, 2.0),    # flip forward, right turn
        (0.0, 0.0, 0.4, 0.5),     # v = 0 turn (creep 0: steers to lock, no motion)
        (0.4, 0.0, 0.0, 15.0),    # into a wall: collision, sliding
        (0.0, 0.0, 0.0, 0.5),     # stop
    ],
}


# The tags a93af01 adds to rhino.urdf (Rhino measured 2026-10-20, master-ackerman-thesis
# params/rhino.yaml steer_backlash_deg, steer_zero_offset_deg, drive_resp_*,
# steer_actuation_latency_s). a4_campaign_runs.sh EXPECT_CONFIG checks every one of them.
A4_TAGS = ('<steering_backlash>3.22</steering_backlash>'
           '<steering_zero_offset>-0.43</steering_zero_offset>'
           '<drive_resp_g_fast>0.557</drive_resp_g_fast>'
           '<drive_resp_tau_fast>0.01</drive_resp_tau_fast>'
           '<drive_resp_g_slow>0.374</drive_resp_g_slow>'
           '<drive_resp_tau_slow>7.77</drive_resp_tau_slow>'
           '<drive_resp_accel>3.81</drive_resp_accel>'
           '<drive_resp_decel>0.8</drive_resp_decel>'
           '<steering_latency>0.05</steering_latency>')

# variant -> (urdf/<robot>.urdf, extra <amr_sim_config> tags or '')
VARIANTS = {
    'amr': ('amr', ''),
    'rhino': ('rhino', ''),
    'rhino_a4': ('rhino', A4_TAGS),
    'amr_accel': ('amr', '<max_linear_accel>0.5</max_linear_accel>'
                         '<max_angular_accel>1.0</max_angular_accel>'),
    'rhino_accel': ('rhino', '<max_linear_accel>0.3</max_linear_accel>'),
}


def urdf_path(robot):
    return os.path.join(PKG, 'urdf', f'{robot}.urdf')


def urdf_with_tags(robot, tags, directory=None):
    """urdf/<robot>.urdf with `tags` added at the end of <amr_sim_config>; the file itself
    when tags is empty. Written to `directory` (a fresh temp dir by default)."""
    path = urdf_path(robot)
    if not tags:
        return path
    with open(path) as f:
        text = f.read()
    assert text.count('</amr_sim_config>') == 1
    text = text.replace('</amr_sim_config>', tags + '</amr_sim_config>')
    out = os.path.join(directory or tempfile.mkdtemp(prefix='amr2dsim_'), f'{robot}.urdf')
    with open(out, 'w') as f:
        f.write(text)
    return out


def golden_path(variant):
    return os.path.join(HERE, 'data', f'default_trace_{variant}.json.gz')


def load_golden(variant):
    with gzip.open(golden_path(variant), 'rt') as f:
        return json.load(f)


class Recorder:
    def __init__(self, conv):
        self.conv = conv
        self.items = []

    def publish(self, msg):
        self.items.append(self.conv(msg))

    def sendTransform(self, t):  # noqa: N802 -- TransformBroadcaster API
        self.items.append(self.conv(t))


class LogRecorder:
    def __init__(self):
        self.lines = []

    def _rec(self, level):
        def f(msg, *a, **k):
            self.lines.append((level, str(msg)))
        return f

    def __getattr__(self, name):
        if name in ('info', 'warning', 'warn', 'error', 'debug', 'fatal'):
            return self._rec(name)
        raise AttributeError(name)


def _v3(v):
    return [v.x, v.y, v.z]


def _q(q):
    return [q.x, q.y, q.z, q.w]


def conv_odom(m):
    return {'frame': m.header.frame_id, 'child': m.child_frame_id,
            'pos': _v3(m.pose.pose.position), 'q': _q(m.pose.pose.orientation),
            'lin': _v3(m.twist.twist.linear), 'ang': _v3(m.twist.twist.angular),
            'pcov': list(m.pose.covariance), 'tcov': list(m.twist.covariance)}


def conv_imu(m):
    return {'frame': m.header.frame_id, 'q': _q(m.orientation),
            'ang': _v3(m.angular_velocity), 'acc': _v3(m.linear_acceleration),
            'ocov': list(m.orientation_covariance), 'acov': list(m.angular_velocity_covariance),
            'lcov': list(m.linear_acceleration_covariance)}


def conv_tf(t):
    return {'frame': t.header.frame_id, 'child': t.child_frame_id,
            'tr': _v3(t.transform.translation), 'q': _q(t.transform.rotation)}


def conv_scan(m):
    return hashlib.sha256(np.asarray(m.ranges, dtype=np.float64).tobytes()).hexdigest()


def conv_twist(m):
    return [m.linear.x, m.angular.z]


def conv_joint(m):
    return [list(m.name), list(m.position)]


def conv_data(m):
    return m.data


OUTPUTS = {
    'odom': ('odom_pub', conv_odom),
    'imu': ('imu_pub', conv_imu),
    'tf': ('tf_broadcaster', conv_tf),
    'scan': ('scan_pub', conv_scan),
    'encoder': ('encoder_pub', conv_data),
    'wheel_vel': ('wheel_vel_pub', conv_twist),
    'joint_states': ('joint_pub', conv_joint),
    'collision': ('collision_pub', conv_data),
    'ground_truth': ('ground_truth_pub', conv_odom),
}


def run_trace(variant, setup=None, tags=None):
    """Drive a variant's sequence through a fresh node loaded from its URDF.

    `tags` (extra <amr_sim_config> tags) are added after the variant's own;
    setup(node) may change the node after construction.
    Returns ({'log': [...], 'pose': [...], <output>: [...]}, node).
    """
    robot, vtags = VARIANTS[variant]
    tmp = tempfile.mkdtemp(prefix='amr2dsim_')
    urdf = urdf_with_tags(robot, vtags + (tags or ''), tmp)
    log = LogRecorder()
    orig_get_logger = AmrSimulator.get_logger
    orig_time = _time_mod.time
    clock = {'t': T0}
    AmrSimulator.get_logger = lambda self: log
    rclpy.init(args=['--ros-args', '-p', f'urdf_file:={urdf}'])
    try:
        node = AmrSimulator()
        try:
            simulator_node.time.time = lambda: clock['t']
            node.camera_pub = Recorder(lambda m: None)
            recs = {}
            for key, (attr, conv) in OUTPUTS.items():
                if hasattr(node, attr):   # ground_truth_pub does not exist before the knobs
                    recs[key] = Recorder(conv)
                    setattr(node, attr, recs[key])
            if setup is not None:
                setup(node)
            node.last_time = clock['t']
            node.last_cmd_time = clock['t']
            poses = []
            for vx, vy, w, secs in SEQUENCES[robot]:
                node.cmd_vel['vx'] = vx
                node.cmd_vel['vy'] = vy
                node.cmd_vel['w'] = w
                for _ in range(int(round(secs / DT))):
                    clock['t'] += DT
                    node.last_cmd_time = clock['t']
                    node.timer_callback()
                    poses.append([node.pose['x'], node.pose['y'], node.pose['theta']])
            out = {'log': [line for _, line in log.lines], 'pose': poses}
            out.update({k: r.items for k, r in recs.items()})
            return out, node
        finally:
            simulator_node.time.time = orig_time
            node.destroy_node()
    finally:
        AmrSimulator.get_logger = orig_get_logger
        rclpy.shutdown()
        shutil.rmtree(tmp, ignore_errors=True)


def loaded_config_line(log_lines):
    """The line a4_campaign_runs.sh config_ok() reads: grep -m1 'Loaded config from URDF'."""
    for line in log_lines:
        if 'Loaded config from URDF' in line:
            return line
    return None


def golden_record(variant):
    out, _ = run_trace(variant)
    rec = {k: v for k, v in out.items() if k != 'log'}
    rec['loaded_config_line'] = loaded_config_line(out['log'])
    return rec


def main():
    os.makedirs(os.path.join(HERE, 'data'), exist_ok=True)
    for variant in VARIANTS:
        rec = golden_record(variant)
        # mtime=0: the same trace always gives the same bytes.
        with open(golden_path(variant), 'wb') as raw, \
                gzip.GzipFile(fileobj=raw, mode='wb', mtime=0, compresslevel=9) as f:
            f.write((json.dumps(rec, separators=(',', ':')) + '\n').encode())
        n = len(rec['pose'])
        print(f'{variant}: {n} ticks, collisions {sum(rec["collision"])}, '
              f'final pose {rec["pose"][-1]} -> {golden_path(variant)}')
        print(f'  {rec["loaded_config_line"]}')


if __name__ == '__main__':
    main()
