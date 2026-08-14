#!/usr/bin/env python3
"""
run_eval.py -- one exploration run, start to teardown.

Every child is started with start_new_session=True so the whole run lives in
its own process group and can be killed with a single killpg. ROS 2 launch
does not propagate signals to nodes it spawned, which is how orphaned
rosbridge/slam processes survive a Ctrl-C and then poison the next run with
stale /map data -- the process group plus the pkill sweep closes both holes.

Runs are strictly sequential. Two sims at once fight over /cmd_vel and
saturate the CPU, and the timings stop meaning anything.
"""
import argparse
import json
import os
import signal
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))

# Anything matching these is swept after teardown, in case a node escaped
# its process group. Deliberately narrow: it must never touch unrelated
# ROS work the developer has running.
SWEEP_PATTERNS = [
    'amr_2dsim.*amr_sim_node',
    'obstacle_avoidance',
    'eval_metrics',
    'slam_toolbox',
    'static_transform_publisher',
    'joy_ackermann_teleop',
    'joy_node',
    'async_slam_toolbox_node',
]


def sweep():
    for pat in SWEEP_PATTERNS:
        subprocess.run(['pkill', '-9', '-f', pat],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.0)


def spawn(cmd, log_path):
    log = open(log_path, 'w')
    return subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT,
                            start_new_session=True), log


def kill(proc):
    if proc is None or proc.poll() is not None:
        return
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGINT)
        proc.wait(timeout=5)
    except Exception:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except Exception:
            pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--seed', type=int, required=True)
    ap.add_argument('--pose', required=True, help='"[x, y, theta]"')
    ap.add_argument('--urdf', required=True)
    ap.add_argument('--map', required=True)
    ap.add_argument('--ground-truth', default=os.path.join(HERE, 'ground_truth.npz'))
    ap.add_argument('--slam-params', required=True)
    ap.add_argument('--timeout', type=float, default=300.0)
    ap.add_argument('--outdir', default=os.path.join(HERE, 'results'))
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    logdir = os.path.join(args.outdir, f'seed{args.seed}_logs')
    os.makedirs(logdir, exist_ok=True)
    result_path = os.path.join(args.outdir, f'seed{args.seed}.json')
    if os.path.exists(result_path):
        os.remove(result_path)

    sweep()
    procs = []
    try:
        sim, _ = spawn([
            'ros2', 'run', 'amr_2dsim', 'amr_sim_node', '--ros-args',
            '-p', f'urdf_file:={args.urdf}',
            '-p', f'map_file:={args.map}',
            '-p', f'initial_pose:={args.pose}',
        ], os.path.join(logdir, 'sim.log'))
        procs.append(sim)
        time.sleep(3.0)

        # amr_2dsim only broadcasts odom->base_link. Nothing publishes the
        # laser_joint transform from the URDF, so slam_toolbox drops every
        # scan with "Message Filter dropping message: frame 'laser_link'"
        # and never produces a map. Values match laser_joint in amr.urdf.
        stf, _ = spawn([
            'ros2', 'run', 'tf2_ros', 'static_transform_publisher',
            '--x', '0.2', '--y', '0', '--z', '0.25',
            '--frame-id', 'base_link', '--child-frame-id', 'laser_link',
        ], os.path.join(logdir, 'static_tf.log'))
        procs.append(stf)
        time.sleep(1.0)

        # use_rviz / use_joy must both be false: rviz perturbs the timings
        # and joy_ackermann_teleop publishes /cmd_vel, which would fight the
        # explorer for control of the robot.
        slam, _ = spawn([
            'ros2', 'launch', 'amr_navigation', 'slam_launch.py',
            f'slam_params_file:={args.slam_params}',
            'use_rviz:=false', 'use_joy:=false',
        ], os.path.join(logdir, 'slam.log'))
        procs.append(slam)
        time.sleep(6.0)

        metrics, _ = spawn([
            'python3', os.path.join(HERE, 'metrics_node.py'),
            '--ground-truth', args.ground_truth,
            '--out', result_path,
            '--seed', str(args.seed),
            '--initial-pose', args.pose,
            '--timeout', str(args.timeout),
        ], os.path.join(logdir, 'metrics.log'))
        procs.append(metrics)

        explorer, _ = spawn([
            'ros2', 'run', 'amr_explorer', 'obstacle_avoidance', '--ros-args',
            '--params-file', os.path.join(HERE, '..', 'config', 'explorer_params.yaml'),
        ], os.path.join(logdir, 'explorer.log'))
        procs.append(explorer)

        # The metrics node owns the stopping decision; this is only a
        # backstop for the case where it dies without writing a result.
        deadline = time.time() + args.timeout + 60
        while time.time() < deadline:
            if metrics.poll() is not None:
                break
            time.sleep(1.0)

    finally:
        for p in reversed(procs):
            kill(p)
        sweep()

    if not os.path.exists(result_path):
        json.dump({'seed': args.seed, 'completed': False,
                   'fail_reason': 'harness_crash'},
                  open(result_path, 'w'), indent=2)

    res = json.load(open(result_path))
    print(json.dumps(res, indent=2))
    return 0 if res.get('completed') else 1


if __name__ == '__main__':
    sys.exit(main())
