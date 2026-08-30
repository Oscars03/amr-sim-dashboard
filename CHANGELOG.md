# Changelog

All notable changes to the IRiSH AMR Simulator Dashboard project will be documented in this file.

## [Unreleased]

### Added
- **UI Redesign**: Complete overhaul of the Dashboard UI based on new wireframes.
- **Interactive View Toolbar**: Top-right canvas HUD now features clickable icon buttons for Zoom In, Zoom Out, Rotate Left, Rotate Right, Center Camera, and Follow Robot, with mouse control hints.
- **Use Current Pose**: New button in Setup tab to easily grab the robot's current location as spawn coordinates.
- **Robot Creator — Actuator Dynamics**: Max Linear Accel, Max Angular Accel (diff-drive) / Max Steering Rate (Ackermann) sliders. Emitted into the generated URDF `<amr_sim_config>` only when non-zero; `0` keeps the simulator's instant response.
- **Robot Creator — LiDAR Range Noise**: Range Noise σ slider (metres). Emitted as `<laser_noise_stddev>` only when non-zero; `0` keeps the ideal scan.
- **Idle auto-stop**: if the robot doesn't move for 1 hour the dashboard stops the sim and shows a banner; press Launch to resume. Prevents a dashboard left running overnight from pinning a CPU core on the 20 Hz `/odom` render loop.

### Fixed
- **ROS connection leak**: `App.jsx` created a new `ROSLIB.Ros` (and WebSocket) every second while rosbridge was unreachable without closing the previous one. The old connection is now torn down before each reconnect.
- **Dashboard render-loop CPU / memory**: `/odom` (20 Hz) went through the Zustand store, re-rendering the whole `DashboardView` tree every frame — a parked robot alone held the renderer at ~90 % CPU and grew RSS to multiple GB. Pose and steering angle are now refs read straight by the canvas; `WorldMap` is memoized and redraws only on real movement; the odometry numbers are a small self-polling component. Idle renderer CPU drops from ~90 % to ~3 %.
- **Follow Robot / resize not repainting**: after the render-loop change, toggling Follow Robot (or resizing the window) while the robot was stationary didn't repaint the map until the robot next moved. `followRobot` and the canvas size are now redraw triggers.
- **Scale bar rotated with the view**: the "1 m" scale bar was drawn inside the axis-widget's `translate + rotate(view.rotation)` transform, which was also never `restore()`d — so the bar swung around and rotated as the map was rotated, and one canvas state leaked per frame. It is now screen-aligned in the bottom-left corner, and the draw loop's save/restore is balanced.

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
