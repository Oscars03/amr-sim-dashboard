# Changelog

All notable changes to the `amr_2dsim` ROS 2 package will be documented in this file.

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
