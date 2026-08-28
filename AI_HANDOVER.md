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

## Agent Specific Rules
- **Ponytail Rule**: The user enforces a "lazy senior developer" rule. Delete over addition. Minimal code. No abstractions unless explicitly requested. Root cause bug fixes.
- **Concise Thai Communication**: Communicate in concise Thai with the user. Keep responses extremely compact.

## Next Steps for AI
- Check open PR #16 (`Release v0.2.9`) and ensure builds succeed using `/home/phutanate/simamr_ws/build_packages.sh`.
- Validate kinematic compatibility with `master-ackerman-thesis` and `nav2-param-visualizer`.
