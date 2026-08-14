Read src/amr_explorer/CLAUDE.md in full before writing any code. It contains
the task, the pass criteria, and simulator-specific constraints that are not
discoverable from the source alone.

Build the amr_explorer package: an autonomous frontier-exploration node that
maps worlds/office.json completely in a single run with zero wall contact.

The eval harness is already built, wired up and verified — do not rebuild it.
A stationary-robot baseline run returned coverage 2.89%, wall_rmse 0.025,
collisions 0, so SLAM, the frames and the ground truth are all confirmed
working. Any deviation from that baseline is caused by your code.

Environment (verified, do not guess these):
  sim executable   : ros2 run amr_2dsim amr_sim_node
  URDF             : src/amr_2dsim/urdf/amr.urdf   (diff_drive, radius 0.35)
  world            : src/amr_2dsim/worlds/office.json
  slam             : ros2 launch amr_navigation slam_launch.py
  ground truth     : 143.99 m2 reachable, eval/ground_truth.npz

Work in this order:

1. Package scaffolding — package.xml, setup.py with a console_scripts entry
   named exactly `obstacle_avoidance`, and a launch file with rviz:=false as
   the default. Confirm `colcon build --packages-select amr_explorer
   --symlink-install` succeeds before going further.

2. A deliberately broken smoke test. Make the node drive straight forward at
   0.3 m/s and nothing else, then run:

     export URDF=~/simamr_ws/src/amr_2dsim/urdf/amr.urdf
     export MAP=~/simamr_ws/src/amr_2dsim/worlds/office.json
     python3 eval/run_eval.py --seed 1 --pose "[-6.0, 4.0, -1.57]" \
       --urdf $URDF --map $MAP \
       --slam-params ~/simamr_ws/src/amr_navigation/config/slam_params.yaml \
       --timeout 60

   From that pose the robot faces -Y with a wall about 1.65 m ahead, so the
   result MUST report collision_events >= 1. If it reports anything else,
   stop and investigate — every later number would be meaningless.

3. Implement the real node: safety FSM, DWA local planner with doorway mode,
   frontier detection with the clearance filter, and rviz markers.

4. Enter the iteration loop in CLAUDE.md until run_all.sh reports SUITE PASS
   or you reach 15 iterations.

Before each eval confirm no stale nodes are running — `ros2 node list` should
be empty. Ask me before changing anything in the do-not-touch list.
