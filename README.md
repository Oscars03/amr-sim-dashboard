# AMR Sim Dashboard

Dashboard สำหรับการควบคุมและแสดงผลการจำลองหุ่นยนต์ (Autonomous Mobile Robot) พัฒนาด้วย React, Vite และ Electron

## Getting Started

ทำตามขั้นตอนด้านล่างนี้เพื่อรันโปรเจกต์บนเครื่อง Ubuntu ของคุณ:

### 1. Prerequisites

ตรวจสอบให้แน่ใจว่าคุณได้ติดตั้งซอฟต์แวร์ต่อไปนี้ในเครื่องแล้ว:

* [Node.js](https://nodejs.org/) (แนะนำเวอร์ชัน 24 ขึ้นไป)
* [ROS 2](https://docs.ros.org/) พร้อม `colcon` — distro ไหนก็ได้ที่ build ผ่าน (auto-detect
  รองรับ `humble`, `jazzy`, `lyrical` โดยตรง ถ้าใช้ distro อื่นดูวิธี override ในหัวข้อ
  [Additional Notes](#additional-notes))
* `rosbridge-suite` — ตัวเชื่อม dashboard กับ ROS 2 ผ่าน WebSocket:
  ```bash
  sudo apt install ros-<distro>-rosbridge-suite
  # เช่น: sudo apt install ros-jazzy-rosbridge-suite
  ```

### 2. Clone the Repository

```bash
git clone https://github.com/Oscars03/amr-sim-dashboard.git
cd amr-sim-dashboard
```

> Repo นี้ bundle ROS 2 workspace ของฝั่ง simulation มาให้พร้อมแล้ว
> (`simamr_ws/src`: `amr_2dsim`, `amr_navigation`, `amr_explorer`) ไม่ต้อง clone แยกอีกต่อไป

### 3. Build the ROS 2 Workspace

Dashboard สั่งรัน sim ผ่าน `ros2 launch` โดย `map-server.cjs` จะหา workspace ที่ build แล้ว
ที่ `~/simamr_ws` เป็นค่า default — วิธีที่ง่ายที่สุดคือ symlink โฟลเดอร์ที่ bundle มาไปไว้ที่นั่นแล้ว build:

```bash
ln -s "$(pwd)/simamr_ws" ~/simamr_ws

source /opt/ros/<distro>/setup.bash   # เช่น jazzy, humble

# ติดตั้ง ROS deps ที่ยังขาด เช่น slam_toolbox, nav2_bringup
# (ครั้งแรกอาจต้อง `sudo rosdep init && rosdep update` ก่อน)
rosdep install --from-paths ~/simamr_ws/src --ignore-src -r -y

cd ~/simamr_ws
colcon build --symlink-install
```

> ไม่อยาก symlink เข้า home directory ก็ได้ — build ตรง ๆ ใน `amr-sim-dashboard/simamr_ws`
> แล้วตั้ง env var `AMR_WS_SETUP=/path/to/amr-sim-dashboard/simamr_ws/install/setup.bash`
> ก่อนรัน `npm run dev` แทนได้

### 4. Install Dependencies & Setup Permissions

ติดตั้ง Node.js ผ่าน `nvm`, ติดตั้งแพ็กเกจที่จำเป็น และตั้งค่าสิทธิ์ Sandbox สำหรับ Electron:

```bash
# ติดตั้ง nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.5/install.sh | bash
source ~/.bashrc

# ติดตั้งและใช้งาน Node.js
nvm install 24
nvm use 24

# ติดตั้ง dependencies
npm install

# ตั้งค่าสิทธิ์ Sandbox ให้กับ Electron
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

### 5. Run Development Mode

Source ทั้ง ROS 2 distro และ workspace ใน terminal เดียวกับที่จะรัน `npm run dev`
(map server ใช้หา package `amr_2dsim` ตอนเริ่มทำงาน):

```bash
source /opt/ros/<distro>/setup.bash
source ~/simamr_ws/install/setup.bash

npm run dev
```

Electron จะเปิด dashboard ขึ้นมา เลือก robot/world แล้วกดปุ่มใน UI เพื่อ launch simulation

---

## Additional Notes

* `map-server.cjs` (Electron auto-fork ให้ตอน start, พอร์ต 3001) auto-detect ROS distro จาก
  `/opt/ros/<distro>/setup.bash` (ไล่เช็ค `lyrical` → `jazzy` → `humble`) และ workspace setup
  script จาก `~/simamr_ws/install/setup.bash` เป็นค่า default — override ได้ด้วย env var
  `ROS_DISTRO` และ `AMR_WS_SETUP` ตามลำดับ ก่อนรัน `npm run dev`
* ถ้า log ของ map server ขึ้น `⚠ ROS package not found` แปลว่ายังไม่ได้ source workspace ใน
  terminal ที่รัน `npm run dev` (ขั้นตอนที่ 5) หรือยังไม่ได้ build workspace (ขั้นตอนที่ 3)

## Built With

* [React](https://react.dev/)
* [Vite](https://vitejs.dev/)
* [Electron](https://www.electronjs.org/)

---
