# Changelog

All notable changes to the IRiSH AMR Simulator Dashboard project will be documented in this file.

## [Unreleased]

## [0.3.0] - 2026-08-30

### Added
- **UI Redesign**: Complete overhaul of the Dashboard UI based on new wireframes.
- **Interactive View Toolbar**: Top-right canvas HUD now features clickable icon buttons for Zoom In, Zoom Out, Rotate Left, Rotate Right, Center Camera, and Follow Robot, with mouse control hints.
- **Use Current Pose**: New button in Setup tab to easily grab the robot's current location as spawn coordinates.
- **Robot Creator — Actuator Dynamics**: Max Linear Accel, Max Angular Accel (diff-drive) / Max Steering Rate (Ackermann) sliders. Emitted into the generated URDF `<amr_sim_config>` only when non-zero; `0` keeps the simulator's instant response.
- **Robot Creator — LiDAR Range Noise**: Range Noise σ slider (metres). Emitted as `<laser_noise_stddev>` only when non-zero; `0` keeps the ideal scan.
- **Idle auto-stop**: if the robot doesn't move for 1 hour the dashboard stops the sim and shows a banner; press Launch to resume. Prevents a dashboard left running overnight from pinning a CPU core on the 20 Hz `/odom` render loop.
- **FPS readout**: the FPS toggle now shows measured against requested (`FPS 58 / 60`), so the cap alone no longer hides whether the renderer is keeping up.

### Fixed
- **ROS connection leak**: `App.jsx` created a new `ROSLIB.Ros` (and WebSocket) every second while rosbridge was unreachable without closing the previous one. The old connection is now torn down before each reconnect.
- **Dashboard render-loop CPU / memory**: `/odom` (20 Hz) went through the Zustand store, re-rendering the whole `DashboardView` tree every frame — a parked robot alone held the renderer at ~90 % CPU and grew RSS to multiple GB. Pose and steering angle are now refs read straight by the canvas; `WorldMap` is memoized and redraws only on real movement; the odometry numbers are a small self-polling component. Idle renderer CPU drops from ~90 % to ~3 %.
- **FPS cap delivered the wrong rate**: "20" measured ~14 and "60" measured ~48 on a real display. `setInterval` was unaligned with vsync; the later rAF gate compared elapsed against `1000/fps - 0.5` and snapped `last = now`, which quantises down to a sub-multiple of the frame clock under jitter. A pure `makeFrameGate` (~2 ms slack, carries the overshoot instead of snapping) now holds the rate — and a 120/144 Hz panel still caps at 60.
- **Robot marker stepped at 20 Hz**: `/odom` updates the pose 20×/s but the canvas draws up to 60, so the marker held for ~3 frames then jumped across a smooth map. The drawn pose is now eased toward each sample every frame (frame-rate independent, snaps on a teleport); the follow camera reads the same eased pose.
- **Follow camera stepping, stale button, jump on release**: the camera pinned to the raw 20 Hz pose; the toolbar button kept its own boolean and stayed lit after anything else turned follow off; releasing follow by middle-drag computed the pan from the raw pose and jumped; Follow was toggleable with no world loaded (silent no-op). Middle mousedown also wasn't cancelled, so Chromium autoscroll fought the pan.
- **Follow Robot / resize not repainting**: after the render-loop change, toggling Follow Robot (or resizing the window) while the robot was stationary didn't repaint the map until the robot next moved. `followRobot` and the canvas size are now redraw triggers.
- **Metres-per-pixel scale varied by world**: the base scale was fit-to-world, so the same robot rendered a different size in every world (~12.6 px/m vs ~31.5). Now a constant `PX_PER_METRE`; `view.zoom` is user-driven, so a large world no longer fits on open.
- **Dropdown options truncated**: Robot/World lists were clipped to the trigger width (`Squar…`, `amr…`). The panel is sized to its content, capped at `min(320px, 90vw)`, and anchored to grow away from the sidebar edge.
- **Spawn-pose panel layout**: X / Y / Yaw each on their own row; Reset moved below the fields it clears instead of next to Use Current.
- **Scale bar rotated with the view**: the "1 m" scale bar was drawn inside the axis-widget's `translate + rotate(view.rotation)` transform, which was also never `restore()`d — so the bar swung around and rotated as the map was rotated, and one canvas state leaked per frame. It is now screen-aligned in the bottom-left corner, and the draw loop's save/restore is balanced.

### Changed
- **All FPS modes skip idle frames**: only "20" skipped redraws when nothing moved; at "60" and unlimited a parked robot redrew the canvas every vsync (measured 28 % at "60", 68 % at unlimited, renderer + GPU on a 144 Hz panel). Every mode now skips idle frames — ~5 % parked — and a moving robot is unaffected.

### Removed
- **Telemetry sparklines**: three unlabelled 28px trend charts removed (~100px back); X / Y / ANGLE labels resized from 10px to 24px to match their values.

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
