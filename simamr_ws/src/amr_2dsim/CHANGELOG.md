# Changelog

All notable changes to the `amr_2dsim` ROS 2 package will be documented in this file.

## [Unreleased]

### Added
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
