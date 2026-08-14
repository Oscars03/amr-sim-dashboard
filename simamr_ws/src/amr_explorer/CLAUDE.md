# amr_explorer — autonomous exploration for amr_2dsim

Build a node that maps `office.json` completely, in one run, without ever
touching a wall. You will iterate against an automated scorer until it
passes on all three start poses.

---

## The loop

```
1. bash eval/run_all.sh
2. Read eval/results/seed*.json
3. All three PASS  -> stop, write a summary
4. Otherwise       -> form ONE hypothesis, make ONE change, go to 1
```

Before the first full suite, do a smoke run — it costs 2 minutes instead of
15 and catches the obvious breakage:

```
python3 eval/run_eval.py --seed 1 --pose "[-6.0, 4.0, -1.57]" \
    --urdf <urdf> --map <map> --slam-params <slam> --timeout 120
```

### Rules

- **One root cause per iteration.** Two simultaneous changes make the next
  result uninterpretable and you will spend three iterations untangling it.
- Prefer `config/explorer_params.yaml` over code. Tune first, restructure
  only when tuning provably cannot reach the target.
- Log every iteration to `ITERATION_LOG.md`: hypothesis, change, result
  table, what it actually taught you. Read it before each new hypothesis —
  it is the only thing preventing you from re-trying a dead end.
- Stop after 15 iterations and report, even if unsolved.

### Do not touch

`eval/`, `config/*.rviz`, `office.json`, `amr.urdf`,
`amr_2dsim/simulator_node.py`.

The scorer defines the task. Editing it, loosening a threshold, or
special-casing a start pose is not a solution — it is a silent failure that
looks like success. If you believe a threshold is genuinely unreachable,
say so and stop; do not adjust it yourself.

Runs are sequential. Never run two evals in parallel, never launch rviz
during an eval.

---

## Pass criteria (all three seeds)

| metric | threshold |
|---|---|
| `collision_events` | **0** — hard fail, no trade-offs |
| `coverage_pct` | ≥ 95 |
| `wall_rmse_m` | ≤ 0.10 |
| `elapsed_s` | ≤ 300 |
| `stuck_events` | ≤ 2 |

Coverage is measured against 143.99 m² of flood-filled reachable area at
`robot_radius = 0.35`. Sealed obstacle interiors are already excluded, so
95% is genuinely attainable — a plateau below it means real area is being
missed, not that the metric is unfair.

---

## Environment facts you must design around

**The laser is 0.2 m forward of `base_link`.** `laser_joint` sits at
`xyz="0.2 0 0.25"`, but collision is a circle of radius 0.35 around
`base_link`. Every `/scan` range must be transformed into `base_link`
before it is used for clearance. Skipping this puts a 0.2 m bias into every
distance estimate, which is larger than the margin available in a doorway.

**Contact does not stop the robot.** On collision the simulator tries to
slide the motion along X, then along Y, and only blocks translation if both
fail. A robot scraping a wall keeps making progress and can appear faster.
`collision_events` is a rising-edge count, so one long scrape registers as
one event — and one event fails the run.

**Three doorways are exactly 1.0 m wide**: `(-8,2)–(-7,2)` into the NW
room, `(6,5)–(6,6)` into the NE room, and the dead-end channel under the
triangle. At radius 0.35 that leaves 0.30 m of lateral room for the robot
centre, ±0.15 m. A DWA arc is wider than that almost immediately, so
doorways need a dedicated behaviour: stop, rotate in place until aligned
with the gap axis, then drive straight through at reduced speed. Diff-drive
can rotate in place — use it.

**The channel under the triangle is sealed at this radius.** The laser sees
into it, so a frontier will appear there that the robot can never reach.
Reject any frontier whose clearance in the inflated map is below
`frontier_min_clearance`, or the run will end with the robot parked in
front of a gap it cannot fit through.

**Wall clock only.** `amr_2dsim` uses `time.time()`, there is no `/clock`
and no speed-up. `use_sim_time` must be `false` everywhere. Every run costs
real minutes; budget your iterations accordingly.

**Frames.** The simulator publishes `odom -> base_link` from its absolute
world pose, so odom is the world frame and slam_toolbox's `map` frame
starts aligned with it. Still drive from the `map -> base_link` TF, not
from `/odom` directly: loop closures move the robot within the map, and a
controller reading raw odometry will not see it. A rising `wall_rmse` with
healthy coverage means the frames have diverged.

---

## Interfaces

Subscribe `/scan` `sensor_msgs/LaserScan` · `/map` `nav_msgs/OccupancyGrid`
(latched: **transient_local** QoS, a default subscription receives nothing)
· `/odom` `nav_msgs/Odometry` · TF `map -> base_link`.

Publish `/cmd_vel` `geometry_msgs/Twist` · `/explorer/frontiers`
`visualization_msgs/MarkerArray` · `/explorer/goal`
`geometry_msgs/PoseStamped` · `/explorer/state` `std_msgs/String`.

Never subscribe to `/collision`. It is the scorer's input; a controller that
reads it is reacting to the judge instead of to the world.

Executable name must be `obstacle_avoidance` (`setup.py` console_scripts) —
`run_eval.py` invokes `ros2 run amr_explorer obstacle_avoidance`.

---

## Suggested structure

```
amr_explorer/obstacle_avoidance.py   # node, control loop, safety FSM
amr_explorer/frontier.py             # detection, clearance filter, scoring
amr_explorer/local_planner.py        # DWA + doorway mode
amr_explorer/viz.py                  # markers
```

Frontier goal cost, where Δθ is the in-place rotation required to face the
goal — rotation buys no coverage and diff-drive pays for it in seconds:

```
J(f) = w_distance * d(f) - w_info_gain * unknown_neighbours(f) + w_turn * |Δθ(f)|
```

---

## Failure mode → first suspect

| symptom | look here first |
|---|---|
| `collision` near a doorway | doorway mode not triggering, or clearance computed in the laser frame |
| `collision` in open space | DWA sim horizon too short for the braking distance at `max_linear_vel` |
| coverage plateaus ~92% | a room never entered — check whether its frontier was filtered out by `frontier_min_clearance` |
| coverage plateaus ~85% | frontier detection stops at the inflation band; frontiers must be found on the raw map, filtered by inflated clearance |
| `timeout`, robot oscillating | goal thrash — raise `goal_hysteresis`, verify the goal only changes when meaningfully better |
| `timeout`, robot circling | `w_info_gain` dominating `w_distance`; it keeps re-picking distant frontiers |
| `stuck` in front of a gap | unreachable frontier accepted, or doorway alignment tolerance too tight to ever satisfy |
| `map_distorted` | driving from `/odom` instead of the `map -> base_link` TF |
| `no_map_received` | `/map` subscribed without transient_local QoS |

**Static TF is supplied by the harness.** `amr_2dsim` broadcasts only
`odom -> base_link`; nothing publishes `laser_joint` from the URDF, so
`run_eval.py` starts a `static_transform_publisher` for
`base_link -> laser_link` at `0.2 0 0.25`. Without it slam_toolbox drops
every scan and no map is ever produced. Do not add a second publisher for
this transform, and do not assume `robot_state_publisher` is running.

**`sync_slam_toolbox` only integrates scans after the robot moves**
(`minimum_travel_distance`). A stationary robot maps almost nothing, so
coverage staying near zero early in a run means the robot is not moving,
not that mapping is broken.
