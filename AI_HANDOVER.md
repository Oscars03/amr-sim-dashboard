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
The user has recently been working on the following files:
- `amr-sim-dashboard/src/components/ui/UpdateProgressModal.css` & `.jsx`: UI for update progress modal.
- `amr-sim-dashboard/src/components/common/SplitButton.css`: UI component styling.
- `amr-sim-dashboard/electron/main.js`: Electron main process setup.
- `simamr_ws/src/amr_2dsim/urdf/tango.urdf`: URDF (Unified Robot Description Format) file for a robot named Tango.

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
To continue from this point, review the modified files (especially `UpdateProgressModal` and `tango.urdf`), and verify with the user what the immediate goal is (e.g., debugging a visual UI issue in the React dashboard, or updating the URDF properties of the tango robot in ROS 2).
