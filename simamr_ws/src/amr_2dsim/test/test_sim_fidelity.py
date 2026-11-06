"""Each sim-fidelity knob does what simulator_node._DEFAULTS says, set through the URDF.

    cd simamr_ws/src/amr_2dsim && python3 -m pytest test/test_sim_fidelity.py

Robots are urdf/rhino.urdf or urdf/amr.urdf with the knob's tags added (default_trace.
urdf_with_tags), so the parser is exercised too; time is a fake 50 ms clock, the walls are
moved out of the way, and /scan and the camera are skipped (they read the true pose only).
That a robot WITHOUT the tags is unaffected is test_default_invariance.py's job.
"""
import contextlib
import math

import numpy as np
import pytest
import rclpy
from geometry_msgs.msg import PoseWithCovarianceStamped

import default_trace as D
from amr_2dsim.simulator_node import (_DEFAULTS, FIDELITY_KEYS, AmrSimulator, parse_sim_config)

DT = 0.05


class Clock:
    def __init__(self, t0=1000.0):
        self.t = t0


@contextlib.contextmanager
def sim(monkeypatch, tmp_path, robot='rhino', tags=''):
    """A node loaded from urdf/<robot>.urdf + tags, with recorders on its outputs."""
    d = tmp_path / f'urdf{len(list(tmp_path.iterdir()))}'
    d.mkdir()
    urdf = D.urdf_with_tags(robot, tags, str(d))
    clock = Clock()
    monkeypatch.setattr('amr_2dsim.simulator_node.time.time', lambda: clock.t)
    rclpy.init(args=['--ros-args', '-p', f'urdf_file:={urdf}'])
    node = AmrSimulator()
    try:
        node.wall_x3 = np.array([1e6])
        node.wall_y3 = np.array([1e6])
        node.wall_x4 = np.array([1e6 + 1.0])
        node.wall_y4 = np.array([1e6])
        node._wall_dx = node.wall_x4 - node.wall_x3
        node._wall_dy = node.wall_y4 - node.wall_y3
        node._wall_len_sq = node._wall_dx ** 2 + node._wall_dy ** 2
        node.publish_scan = lambda: None
        node.publish_camera = lambda: None
        node.rec = {}
        for key, (attr, conv) in D.OUTPUTS.items():
            if key in ('scan',):
                continue
            node.rec[key] = D.Recorder(conv)
            setattr(node, attr, node.rec[key])
        node.clock = clock
        node.last_time = clock.t
        node.last_cmd_time = clock.t
        yield node
    finally:
        node.destroy_node()
        rclpy.shutdown()


def drive(node, vx, w, steps, vy=0.0):
    """Command (vx, vy, w) for `steps` ticks; per tick: true pose, achieved and wheel twist."""
    node.cmd_vel.update(vx=vx, vy=vy, w=w)
    rows = []
    for _ in range(steps):
        node.clock.t += DT
        node.last_cmd_time = node.clock.t
        node.timer_callback()
        rows.append({'pose': (node.pose['x'], node.pose['y'], node.pose['theta']),
                     'ach': (node.achieved_vx, node.achieved_vy, node.achieved_w),
                     'wheel': (node.wheel_vx, node.wheel_vy, node.wheel_w),
                     'delta': node.wheel_angle()})
    return rows


def odom_yaw(o):
    return 2.0 * math.atan2(o['q'][2], o['q'][3])


# ── parsing ──────────────────────────────────────────────────────────────────────────────

def test_parse_reads_every_knob(tmp_path):
    from test_default_invariance import ALL_KNOBS_ON
    cfg = parse_sim_config(D.urdf_with_tags('rhino', ALL_KNOBS_ON, str(tmp_path)))
    assert (cfg['odom_lin_scale'], cfg['odom_yaw_scale']) == (1.029, 1.271)
    assert (cfg['odom_lin_noise_std'], cfg['odom_yaw_noise_std']) == (0.01, 0.01)
    assert cfg['imu_omega_source'] == 'achieved'
    assert (cfg['imu_gyro_noise_std'], cfg['imu_gyro_bias']) == (0.005, 0.002)
    assert (cfg['slip_long'], cfg['slip_yaw']) == (0.05, 0.1)
    assert (cfg['understeer_gradient'], cfg['yaw_rate_tau']) == (0.2, 0.1)
    assert cfg['drive_latency'] == 0.05 and cfg['noise_seed'] == 42


@pytest.mark.parametrize('robot', ['amr', 'rhino'])
def test_shipped_urdfs_set_no_knob(robot):
    cfg = parse_sim_config(D.urdf_path(robot))
    assert {k: cfg[k] for k in FIDELITY_KEYS} == {k: _DEFAULTS[k] for k in FIDELITY_KEYS}


@pytest.mark.parametrize('tag, value', [
    ('slip_long', '1.0'), ('slip_yaw', '-0.1'), ('odom_lin_scale', '0'), ('odom_yaw_scale', '-1'),
    ('odom_yaw_noise_std', '-0.01'), ('yaw_rate_tau', 'nan'), ('drive_latency', 'abc'),
    ('understeer_gradient', '-0.5'), ('imu_gyro_bias', 'inf'), ('imu_omega_source', 'gyro'),
    ('noise_seed', '-3'), ('noise_seed', '1.5'),
])
def test_bad_values_keep_the_default(tmp_path, tag, value):
    cfg = parse_sim_config(D.urdf_with_tags('rhino', f'<{tag}>{value}</{tag}>', str(tmp_path)))
    assert cfg[tag] == _DEFAULTS[tag]


# ── odometry: scale ──────────────────────────────────────────────────────────────────────

def test_odom_yaw_scale_over_reads_the_yaw_rate_and_the_heading(monkeypatch, tmp_path):
    with sim(monkeypatch, tmp_path, tags='<odom_yaw_scale>1.271</odom_yaw_scale>') as node:
        rows = drive(node, 0.3, 0.2, 60)
        odom, tf = node.rec['odom'].items, node.rec['tf'].items
    for r, o, t in zip(rows, odom, tf):
        assert o['ang'][2] == pytest.approx(1.271 * r['ach'][2], rel=1e-12, abs=1e-15)
        assert o['lin'][0] == r['ach'][0]                     # distance untouched
        assert odom_yaw(o) == pytest.approx(1.271 * r['pose'][2], rel=1e-9, abs=1e-12)
        assert (t['tr'], t['q']) == (o['pos'], o['q'])         # TF = /odom
    assert rows[-1]['ach'][2] > 0.1                            # it really turned


def test_odom_lin_scale_over_reads_distance(monkeypatch, tmp_path):
    with sim(monkeypatch, tmp_path, tags='<odom_lin_scale>1.029</odom_lin_scale>') as node:
        rows = drive(node, 0.3, 0.0, 40)
        odom = node.rec['odom'].items
    assert odom[-1]['pos'][0] == pytest.approx(1.029 * rows[-1]['pose'][0], rel=1e-12)
    assert odom[-1]['lin'][0] == pytest.approx(1.029 * 0.3, rel=1e-12)
    assert rows[-1]['pose'][0] == pytest.approx(40 * DT * 0.3, rel=1e-9)   # truth untouched


# ── odometry: noise, seed ────────────────────────────────────────────────────────────────

NOISE = '<odom_lin_noise_std>0.02</odom_lin_noise_std><odom_yaw_noise_std>0.01</odom_yaw_noise_std>'
N_NOISE = 4000


def test_odom_noise_has_the_configured_std_and_makes_the_pose_drift(monkeypatch, tmp_path):
    with sim(monkeypatch, tmp_path, tags=NOISE + '<noise_seed>7</noise_seed>') as node:
        rows = drive(node, 0.3, 0.0, N_NOISE)
        odom = node.rec['odom'].items
    ev = np.array([o['lin'][0] - r['ach'][0] for o, r in zip(odom, rows)])
    ew = np.array([o['ang'][2] - r['ach'][2] for o, r in zip(odom, rows)])
    # Sample std of n normal draws has a relative sd of ~1/sqrt(2n) = 1.1%: 5% is > 4 sd.
    assert np.std(ev) == pytest.approx(0.02, rel=0.05)
    assert np.std(ew) == pytest.approx(0.01, rel=0.05)
    assert abs(np.mean(ev)) < 4 * 0.02 / math.sqrt(N_NOISE)
    assert abs(np.mean(ew)) < 4 * 0.01 / math.sqrt(N_NOISE)
    # The truth drove dead straight; odometry integrated the noise into a heading walk.
    assert rows[-1]['pose'][1] == 0.0 and rows[-1]['pose'][2] == 0.0
    assert abs(odom_yaw(odom[-1])) > 1e-3 and abs(odom[-1]['pos'][1]) > 1e-3
    # Per-tick integration of the reported twist (midpoint), not a copy of the truth.
    o0, o1 = odom[-2], odom[-1]
    th0, w = odom_yaw(o0), o1['ang'][2]
    mid = th0 + w * DT / 2.0
    assert o1['pos'][0] == pytest.approx(o0['pos'][0] + o1['lin'][0] * math.cos(mid) * DT, abs=1e-6)


def odom_sequence(monkeypatch, tmp_path, tags, steps=50):
    with sim(monkeypatch, tmp_path, tags=tags) as node:
        drive(node, 0.3, 0.1, steps)
        return [(o['lin'][0], o['ang'][2]) for o in node.rec['odom'].items], node.noise_seed


def test_same_seed_same_noise_other_seed_other_noise(monkeypatch, tmp_path):
    a, _ = odom_sequence(monkeypatch, tmp_path, NOISE + '<noise_seed>7</noise_seed>')
    b, _ = odom_sequence(monkeypatch, tmp_path, NOISE + '<noise_seed>7</noise_seed>')
    c, _ = odom_sequence(monkeypatch, tmp_path, NOISE + '<noise_seed>8</noise_seed>')
    assert a == b
    assert a != c


def test_the_logged_auto_seed_reproduces_the_run(monkeypatch, tmp_path):
    a, seed = odom_sequence(monkeypatch, tmp_path, NOISE)
    b, _ = odom_sequence(monkeypatch, tmp_path, NOISE + f'<noise_seed>{seed}</noise_seed>')
    assert a == b


def test_gyro_noise_does_not_change_the_odom_noise(monkeypatch, tmp_path):
    """Independent streams: switching one noise knob on leaves another's sequence alone."""
    a, _ = odom_sequence(monkeypatch, tmp_path, NOISE + '<noise_seed>7</noise_seed>')
    b, _ = odom_sequence(monkeypatch, tmp_path, NOISE + '<noise_seed>7</noise_seed>'
                         '<imu_gyro_noise_std>0.05</imu_gyro_noise_std>')
    assert a == b


# ── IMU ──────────────────────────────────────────────────────────────────────────────────

def test_imu_default_is_the_commanded_yaw_rate(monkeypatch, tmp_path):
    with sim(monkeypatch, tmp_path) as node:
        drive(node, 0.3, 0.2, 10)
        assert all(m['ang'][2] == 0.2 for m in node.rec['imu'].items)


def test_imu_achieved_is_the_true_yaw_rate(monkeypatch, tmp_path):
    with sim(monkeypatch, tmp_path, tags='<imu_omega_source>achieved</imu_omega_source>'
             '<slip_yaw>0.1</slip_yaw>') as node:
        rows = drive(node, 0.3, 0.2, 40)
        imu = node.rec['imu'].items
    assert [m['ang'][2] for m in imu] == [r['ach'][2] for r in rows]
    assert imu[-1]['ang'][2] != 0.2 and imu[-1]['ang'][2] > 0.1


def test_imu_bias_and_noise(monkeypatch, tmp_path):
    tags = ('<imu_omega_source>achieved</imu_omega_source><imu_gyro_bias>0.002</imu_gyro_bias>'
            '<imu_gyro_noise_std>0.005</imu_gyro_noise_std><noise_seed>3</noise_seed>')
    with sim(monkeypatch, tmp_path, tags=tags) as node:
        rows = drive(node, 0.3, 0.0, N_NOISE)
        imu = node.rec['imu'].items
    e = np.array([m['ang'][2] - r['ach'][2] for m, r in zip(imu, rows)])
    assert np.std(e) == pytest.approx(0.005, rel=0.05)
    assert np.mean(e) == pytest.approx(0.002, abs=4 * 0.005 / math.sqrt(N_NOISE))


def test_imu_bias_alone_is_exact(monkeypatch, tmp_path):
    with sim(monkeypatch, tmp_path, tags='<imu_gyro_bias>-0.003</imu_gyro_bias>') as node:
        drive(node, 0.3, 0.2, 5)
        assert all(m['ang'][2] == pytest.approx(0.2 - 0.003, abs=1e-15) for m in node.rec['imu'].items)


# ── wheel slip ───────────────────────────────────────────────────────────────────────────

def test_yaw_slip_reduces_the_true_yaw_rate_and_odometry_over_reads(monkeypatch, tmp_path):
    with sim(monkeypatch, tmp_path, tags='<slip_yaw>0.1</slip_yaw>') as node:
        rows = drive(node, 0.3, 0.2, 40)
        odom, gt = node.rec['odom'].items, node.rec['ground_truth'].items
    for r, o, g in zip(rows, odom, gt):
        kin = r['wheel'][0] * math.tan(r['delta']) / node.wheel_base
        assert r['ach'][2] == pytest.approx(0.9 * kin, rel=1e-12, abs=1e-15)   # true
        assert o['ang'][2] == pytest.approx(kin, rel=1e-12, abs=1e-15)         # odom: pre-slip
        assert g['ang'][2] == r['ach'][2] and g['pos'][:2] == list(r['pose'][:2])
        assert r['ach'][0] == r['wheel'][0] == o['lin'][0]                     # speed untouched
    assert rows[-1]['ach'][2] > 0.1


def test_longitudinal_slip_keeps_the_path_and_slows_the_chassis(monkeypatch, tmp_path):
    with sim(monkeypatch, tmp_path, tags='<slip_long>0.2</slip_long>') as node:
        rows = drive(node, 0.3, 0.2, 40)
        odom, wv, enc = node.rec['odom'].items, node.rec['wheel_vel'].items, node.rec['encoder'].items
    r = rows[-1]
    assert r['ach'][0] == pytest.approx(0.8 * 0.3, rel=1e-12)
    assert r['ach'][2] / r['ach'][0] == pytest.approx(math.tan(r['delta']) / node.wheel_base, rel=1e-12)
    assert odom[-1]['lin'][0] == 0.3 and wv[-1][0] == 0.3                      # the wheels' speed
    assert odom[-1]['ang'][2] == pytest.approx(0.3 * math.tan(r['delta']) / node.wheel_base, rel=1e-12)
    left, right = (int(v) for v in enc[-1][4:].split(','))     # 'ENC:<left>,<right>'
    assert left == right
    assert abs(left - 40 * DT * 0.3 * node.ticks_per_meter) <= 1  # wheel travel, not 0.8x


def test_slip_and_odom_scale_multiply(monkeypatch, tmp_path):
    """Documented interaction: odom / true distance = odom_lin_scale / (1 - slip_long)."""
    tags = '<slip_long>0.1</slip_long><odom_lin_scale>1.029</odom_lin_scale>'
    with sim(monkeypatch, tmp_path, tags=tags) as node:
        rows = drive(node, 0.3, 0.0, 40)
        odom = node.rec['odom'].items
    assert odom[-1]['pos'][0] / rows[-1]['pose'][0] == pytest.approx(1.029 / 0.9, rel=1e-9)


def test_diff_drive_slip(monkeypatch, tmp_path):
    with sim(monkeypatch, tmp_path, robot='amr', tags='<slip_long>0.1</slip_long><slip_yaw>0.2</slip_yaw>') as node:
        rows = drive(node, 0.4, 0.5, 10)
        odom = node.rec['odom'].items
    assert rows[-1]['ach'][0] == pytest.approx(0.9 * 0.4, rel=1e-12)
    assert rows[-1]['ach'][2] == pytest.approx(0.8 * 0.9 * 0.5, rel=1e-12)
    assert (odom[-1]['lin'][0], odom[-1]['ang'][2]) == (0.4, 0.5)


# ── mass / inertia proxies ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize('v', [0.05, 0.4, 1.0])
def test_understeer_curvature_matches_the_formula(monkeypatch, tmp_path, v):
    k_us = 0.5
    with sim(monkeypatch, tmp_path, tags=f'<understeer_gradient>{k_us}</understeer_gradient>') as node:
        rows = drive(node, v, 0.3 * v, 40)
        odom = node.rec['odom'].items
    r = rows[-1]
    kappa = r['ach'][2] / r['ach'][0]
    assert kappa == pytest.approx(math.tan(r['delta']) / (node.wheel_base + k_us * v * v), rel=1e-12)
    # wheel odometry assumes the kinematic tan(delta) / L, so it over-reads the yaw
    assert odom[-1]['ang'][2] == pytest.approx(v * math.tan(r['delta']) / node.wheel_base, rel=1e-12)


def test_yaw_rate_lag_is_first_order(monkeypatch, tmp_path):
    tau = 0.2
    with sim(monkeypatch, tmp_path, tags=f'<yaw_rate_tau>{tau}</yaw_rate_tau>') as node:
        node.max_steering_rate = 0.0       # instant servo: the target yaw rate is a step
        node.max_steering_accel = 0.0
        rows = drive(node, 0.3, 0.2, 30)
        target = 0.3 * math.tan(rows[0]['delta']) / node.wheel_base
        for k, r in enumerate(rows, start=1):
            assert r['ach'][2] == pytest.approx(target * (1.0 - math.exp(-k * DT / tau)), rel=1e-9)
        # an Ackermann chassis does not yaw at standstill, lag or not
        rows = drive(node, 0.0, 0.4, 3)
        assert all(r['ach'][2] == 0.0 for r in rows)


def test_yaw_rate_lag_diff_drive_spins_up(monkeypatch, tmp_path):
    with sim(monkeypatch, tmp_path, robot='amr', tags='<yaw_rate_tau>0.1</yaw_rate_tau>') as node:
        rows = drive(node, 0.0, 0.8, 4)
    assert [r['ach'][2] for r in rows] == pytest.approx(
        [0.8 * (1.0 - math.exp(-k * DT / 0.1)) for k in range(1, 5)], rel=1e-9)


# ── drive latency ────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize('base_tags', ['', D.A4_TAGS])
def test_drive_latency_shifts_the_speed_response(monkeypatch, tmp_path, base_tags):
    """0.1 s at the 50 ms tick = the same response two ticks later, with or without
    Rhino's fitted drive response (A4_TAGS)."""
    with sim(monkeypatch, tmp_path, tags=base_tags) as node:
        base = [r['ach'][0] for r in drive(node, 0.4, 0.0, 30)]
    with sim(monkeypatch, tmp_path, tags=base_tags + '<drive_latency>0.1</drive_latency>') as node:
        late = [r['ach'][0] for r in drive(node, 0.4, 0.0, 30)]
    assert late[:2] == [0.0, 0.0]
    assert late[2:] == pytest.approx(base[:-2], rel=1e-12, abs=1e-15)
    assert base[0] > 0.0


# ── ground truth, reset ──────────────────────────────────────────────────────────────────

def test_ground_truth_stays_true_under_every_odometry_error(monkeypatch, tmp_path):
    from test_default_invariance import ALL_KNOBS_ON
    with sim(monkeypatch, tmp_path, tags=ALL_KNOBS_ON) as node:
        rows = drive(node, 0.3, 0.2, 60)
        gt, odom = node.rec['ground_truth'].items, node.rec['odom'].items
    for r, g in zip(rows, gt):
        assert g['frame'] == 'map' and g['child'] == 'base_link'
        assert g['pos'][:2] == list(r['pose'][:2])
        assert 2.0 * math.atan2(g['q'][2], g['q'][3]) == pytest.approx(r['pose'][2], abs=1e-12)
        assert (g['lin'][0], g['ang'][2]) == (r['ach'][0], r['ach'][2])
    assert math.dist(odom[-1]['pos'][:2], gt[-1]['pos'][:2]) > 0.01


def test_initialpose_restarts_odometry_at_the_new_pose(monkeypatch, tmp_path):
    with sim(monkeypatch, tmp_path, tags='<odom_yaw_scale>1.271</odom_yaw_scale>') as node:
        drive(node, 0.3, 0.2, 40)
        msg = PoseWithCovarianceStamped()
        msg.pose.pose.position.x, msg.pose.pose.position.y = 2.0, -1.0
        msg.pose.pose.orientation.z, msg.pose.pose.orientation.w = math.sin(0.25), math.cos(0.25)
        node.initial_pose_topic_callback(msg)
        assert node.odom_pose == pytest.approx({'x': 2.0, 'y': -1.0, 'theta': 0.5})
        drive(node, 0.0, 0.0, 1)
        assert node.rec['odom'].items[-1]['pos'][:2] == pytest.approx([2.0, -1.0])
        assert node.rec['tf'].items[-1]['tr'][:2] == pytest.approx([2.0, -1.0])
