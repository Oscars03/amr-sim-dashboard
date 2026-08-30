# AI Handover Document: IRiSH AMR Simulator

This document is intended for an AI assistant to quickly understand the project architecture, tech stack, and current state of the codebase.

## Project Architecture
The IRiSH AMR Simulator is composed of two main workspaces:
1. **Frontend**: `amr-sim-dashboard` (located at `/home/phutanate/amr-sim-dashboard`)
   - **Tech Stack**: React, Vite, and Electron.
   - **Role**: A dashboard for controlling and visualizing the Autonomous Mobile Robot (AMR).
2. **Backend**: `simamr_ws` (located at `/home/phutanate/simamr_ws`)
   - **Tech Stack**: ROS 2 (Jazzy).
   - **Role**: The ROS 2 simulation backend (`amr_2dsim` package).

## Important Files & Current Focus
Current state is focused on the `release/v0.2.9` milestone and cross-repo DOE audit fixes:
- `simamr_ws/src/amr_2dsim/amr_2dsim/simulator_node.py`: Kinematics simulator node with Ackermann steering, achieved velocity reporting in `/odom` (F-02), and `/reset_pose` / `/initialpose` handling.
- `simamr_ws/src/amr_2dsim/urdf/rhino.urdf`: URDF for Rhino Ackermann robot (wheelbase 0.385m, max steer 18° / 0.314 rad, F-03).
- `amr-sim-dashboard/electron/main.js`: Electron main process setup and ROS node management.
- `amr-sim-dashboard/src/components/views/DashboardView.jsx`: AMR monitor and control view.

## Build Workflows
### Frontend (amr-sim-dashboard)
- **Dev**: `npm run dev`
- **Build**: `npm run build` then `npx electron-builder --linux dir`

### Backend (simamr_ws)
- **Build**: `colcon build --merge-install` (Ensure you source `/opt/ros/jazzy/setup.bash` first)
- **Run**: Source `/home/phutanate/simamr_ws/install/setup.bash`

### Unified Debian Packaging
A unified script `/home/phutanate/simamr_ws/build_packages.sh` packages both frontend and backend into a single `.deb` file for Ubuntu 24.04. When instructed to "build the app", run this script.

## Architecture & Recent Core PRs (Merged to main @ d3a1f0e)
- **#19 Actuator Dynamics**: `<amr_sim_config>` `max_linear_accel`, `max_angular_accel`, `max_steering_rate`.
- **#20 LaserScan Gaussian Noise**: `<laser_noise_stddev>` simulation.
- **#21 Watchdog & Reconnect**: Idle auto-stop watchdog + ROS reconnect memory leak fix.
- **#22 Render Refactor (CRITICAL RULE)**:
  - `/odom` arrives at 20 Hz. Pose and steering **MUST NOT** be kept in Zustand or cause React re-renders.
  - `pose` and `steering` live in **mutable refs** (`poseRef`, `steeringRef`) in `DashboardView.jsx`.
  - `WorldMap` is wrapped in `React.memo` and updated imperatively via `worldMapRef.current?.markDirty()`.
  - **DO NOT** reintroduce 20 Hz `setState` in `DashboardView.jsx`.
- **#23 Canvas & Scale Bar**: Follow Robot repaint fix + canvas save-restore state isolation.
- **#26 Dead Code & Lint**: Zero lint warnings, static editor frame idle loops, clean simulator node SIGINT shutdown.

## Active Branches & PRs
- `feat/spawn-pose`: Spawn Pose Config `(X, Y, Yaw)` before launch + `/initialpose` live reset.
- PR #27 (open, do not touch): `worlds/F4_2F.json` (data only).

## Agent Specific Rules
- **Ponytail Rule**: The user enforces a "lazy senior developer" rule. Delete over addition. Minimal code. No abstractions unless explicitly requested. Root cause bug fixes.
- **Render Performance**: Always use refs and `markDirty()` for high-frequency data streams (e.g., odom, teleop).
- **Concise Thai Communication**: Communicate in concise Thai with the user. Keep responses extremely compact.
- **Git Feature Branches**: Always branch off `origin/main` for new features and submit via PR.

