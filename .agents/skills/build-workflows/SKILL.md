---
name: build-workflows
description: Build procedures and packaging workflows for IRiSH AMR Simulator (Electron frontend, ROS 2 simamr_ws backend, and unified Debian .deb packages).
---

# Build Workflows Skill

This skill documents the standard build, run, and packaging workflows for the **IRiSH AMR Simulator** ecosystem, comprising the Electron/React dashboard frontend and the ROS 2 (Jazzy) backend simulation packages.

---

## 1. Electron Dashboard (`amr-sim-dashboard`)

### Development Mode
Runs Vite development server and Electron hot-reloading:
```bash
cd /home/phutanate/amr-sim-dashboard
npm run dev
```

### Production Build & Packaging
Bundles React static output and creates unpacked Electron binaries:
```bash
cd /home/phutanate/amr-sim-dashboard
npm run build
npx electron-builder --linux dir
```
- **Build Output**: `release/linux-unpacked/`

---

## 2. ROS 2 Simulation Workspace (`simamr_ws`)

### Development Build & Clean
Builds ROS 2 packages (`amr_2dsim`) using `colcon`:
```bash
cd /home/phutanate/simamr_ws
source /opt/ros/jazzy/setup.bash

# Clean existing build artifacts if rebuilding clean
rm -rf build/ install/ log/

# Recommended build with merge-install layout
colcon build --merge-install
```

### Sourcing Local Workspace Environment
```bash
source /home/phutanate/simamr_ws/install/setup.bash
```

---

## 3. Unified Debian (.deb) Packaging

The repository includes a automated debian packager combining both backend and frontend into a single Ubuntu 24.04 compatible binary package.

### Interactive Debian Build
Run the interactive script located in `simamr_ws`:
```bash
cd /home/phutanate/simamr_ws
./build_deb.sh
```
- **Inputs**: Package version (e.g. `1.0.0`) and architecture (`amd64` or `arm64`).
- **Artifact Output**: `$HOME/irish-amr-sim_<version>_<arch>.deb`

### Installation & Execution Verification
To install and test the generated `.deb` package on Ubuntu 24.04:
```bash
sudo apt install $HOME/irish-amr-sim_1.0.0_amd64.deb
irish-amr-sim
```

---

## 4. Troubleshooting & Best Practices

- **Chrome Sandbox Error (Ubuntu 24.04)**: Ensure `--no-sandbox` flag is passed or permissions `4755` are assigned to `chrome-sandbox`.
- **ROS 2 Dependency Checks**: Ensure `ros-jazzy-rosbridge-suite` and `python3-colcon-common-extensions` are installed before launching simulation bridges.
- **Node Modules / Clean Build**: If frontend assets fail to update, delete `node_modules` and re-install:
  ```bash
  rm -rf node_modules package-lock.json && npm install
  ```
