# Changelog

All notable changes to the `amr_2dsim` ROS 2 package will be documented in this file.

## [Unreleased]

### Fixed
- **Ackermann pre-steer at a cusp now steers the way the robot does (2026-09-28)**: the steering target is computed from the *commanded, signed* `/cmd_vel` (v, ω) before the pre-steer hold / creep rewrite v, ported from rhino_interface `base_controller.cpp` `kinematic_steer_deg()` (rhino-robot-ws main `43728f6`): `atan(L·ω/v)` for |v| > 0.01, full lock by sign(ω) at or below it, clamped. Before, the 200 ms hold set v = 0 and the angle was taken from that, so it went to full lock by sign(ω): reversing with ω > 0 drove the servo to the wrong side first (Rhino, 0.3 m/s ω 0.3 cusp: +21.06° → +22.80° → −21.06°, reaching the target at 1050 ms instead of 800 ms). Side effects, both also matching the robot: with creep on, a v = 0 turn is full lock (creep no longer sets the angle), and the full-lock threshold is |v| ≤ 0.01 instead of < 1e-4. The servo slew (`max_steering_rate` / `max_steering_accel`) is unchanged and still acts on the target; `creep_on_turn_mps` stays 0.0 for Rhino. Test: `test/test_presteer_cusp.py`.

### Added
- **Steering servo acceleration limit**: optional `<amr_sim_config>` `max_steering_accel` (deg/s²). The Ackermann steering now follows a trapezoidal profile limited in both acceleration and rate (`amr_2dsim/actuators.py`, `slew_steering`), braking on the sampled stopping curve so it never overshoots or stops harder than the limit (except the sub-tick remainder of the landing tick). With Rhino's measured 262.2 deg/s² / 82.0 deg/s it reproduces what was measured on the robot: a 5° correction peaks at ~36 deg/s and averages ~18, and only steps ≥ 25.6° reach the peak. `0` keeps the rate-only behaviour. Also exposed in *Create Robot*.
- **ROS-free tests**: `test/test_steering_servo_model.py` (servo model against the measured numbers) and `test/test_rhino_urdf_matches_thesis.py` (Rhino's sim config against master-ackerman-thesis `CLAUDE_rhino.md`) run with plain `pytest`, no `rclpy`.

### Changed
- **`urdf/rhino.urdf` `max_steering_angle` 18.95 → 18.0° (2026-09-29)**: the robot's `base_controller` command cap `max_steer_deg: 18.0` (rhino-robot-ws#31), one value for both sides. The steering servo was found loose and refitted on 2026-09-28; since then a +20° command stalls against a stop at +18.62° (servo axis), so the command is capped at 18°. The sim takes δ_bike = command because it has no linkage — 18.0 is a command cap, **not** a measured δ_bike (δ_bike after the refit is not measured). R = 1.185 m, under Nav2's `minimum_turning_radius` 1.20. 18.95° (static, 2026-09-07) and the floor values 16.49° L / 22.80° R (2026-09-12) were all measured at the 20° command with the loose servo and are superseded.
- **`urdf/rhino.urdf` re-synced to the thesis (2026-09-24)**: `max_steering_angle` 18.0 → **18.95°** (δ_bike worst case, left; R_min 1.121 m under Nav2's 1.20), **`max_steering_rate` 82.0 deg/s** and **`max_steering_accel` 262.2 deg/s²** [measured 2026-09-08], **`creep_on_turn_mps` 0.3 → 0.0** (§19 LOCK — 0.3 drove the robot forward on every rotation command). The retracted "18° L / 25° R" and "R_min 1.185 m" notes are marked as such. `max_linear_accel` deliberately left unset: the MCU's running value is unresolved (PRSH 5.0 vs 0.2 in the source).
- *Create Robot* writes `max_steering_angle` with two decimals, so 18.95 is no longer rounded to 19.0.
- **Actuator Dynamics**: Optional `<amr_sim_config>` limits — `max_linear_accel` (m/s²), `max_angular_accel` (rad/s², diff-drive/omni), and `max_steering_rate` (deg/s, Ackermann steering servo). The simulator now slews velocity and steering toward the command instead of applying it instantly, so `/odom` and controller behaviour match real hardware. Each limit defaults to `0` (instant response — unchanged behaviour for existing robots).
- **LiDAR Range Noise**: Optional `<amr_sim_config>` `laser_noise_stddev` (metres) adds Gaussian error to each `/scan` hit, so SLAM / AMCL results are no longer based on a perfect scan. Max-range "no return" beams are left exact and every value stays within `[range_min, range_max]`. Defaults to `0` (ideal scan).

## [0.2.8] - 2026-07-31

### Added
- **Ackermann Steering Kinematics**: Implemented realistic Ackermann velocity integration, physical steering limits (`max_steering_angle`), and steering calculations.
- **Joint States Publisher**: Published `/joint_states` topic for real-time virtual wheel/steer visualizers.
- **Watchdog Parameter Support**: Added `enable_watchdog` and `watchdog_timeout` ROS 2 parameters to automatically halt movement when command velocity stream drops.

### Changed
- Refactored `simulator_node.py` config parsing to dynamically process `max_steering_angle` from URDF simulation tags.

---

## [0.2.6] - 2026-07-18

### Fixed
- Fixed URDF naming conventions, mapping launch parameters, and simulator position integration precision.
