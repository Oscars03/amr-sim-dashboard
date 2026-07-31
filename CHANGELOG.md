# Changelog

All notable changes to the IRiSH AMR Simulator Dashboard project will be documented in this file.

## [0.2.8] - 2026-07-31

### Added
- **Robot Creator Enhancements**: Visual URDF parameter configuration, real-time robot footprint visualization, and Ackermann steering kinematic parameter controls.
- **Watchdog Safety System**: Interactive watchdog toggle switch in Dashboard view to auto-stop robot movement on telemetry/command timeout.
- **Joint State Visualizer**: Real-time joint states rendering for wheel steering and drive linkages.
- **Unit Testing Suite**: Integrated Vitest test runner and coverage configurations.

### Fixed & Improved
- Fixed map server static file serving and map loading resilience.
- Improved ROS 2 connection state indicator and telemetry status reporting.
- Refactored layout for seamless view switching between Dashboard, Robot Creator, and World Creator.

---

## [0.2.7] - 2026-07-31

### Added
- Watchdog toggle switch for simulation control.

### Fixed
- Updated ROS 2 connection status reporting and launch button interaction logic.
- Standardized World and Map label display formats.

---

## [0.2.6] - 2026-07-19

### Fixed
- Resolved AMR motion judder and black screen issues during map reset.
- Fixed map and robot deletion handling across all workspace file paths.
