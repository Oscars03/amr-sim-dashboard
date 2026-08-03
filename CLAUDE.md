# CLAUDE.md — amr-sim-dashboard

โปรเจกต์นี้ใช้ 2 repo คู่กันเสมอ:

1. **`amr-sim-dashboard`** (repo นี้) — Dashboard แบบ Electron + Vite + React 19
   ใช้ควบคุม/แสดงผล AMR (Autonomous Mobile Robot) simulation
2. **`amr_2dsim`** (`Oscars03/amr_2dsim`) — sim node ฝั่ง backend เป็น ROS 2
   package แบบ `ament_python` ที่รัน physics simulation จริง (ROS 2 distro
   ไหนก็ได้ที่ build ผ่าน — ไม่ fix เป็น Jazzy)

> **สำคัญ**: ต้อง attach repo `amr_2dsim` ทุก session ใหม่ (ผ่าน `add_repo` +
> clone ไปที่ `/workspace/amr_2dsim` + `register_repo_root`) เพราะ session
> เป็นแบบ ephemeral ไม่จำ repo ข้าม session — user ยืนยันว่าต้องการแบบนี้ทุกครั้ง

## Architecture — ทั้งสอง repo เชื่อมกันยังไง

```
Dashboard (Electron)  ──ws://<host>:9090──▶  rosbridge_websocket
       │                                          │
       └──http://<host>:3001 (map-server.cjs)──▶ ros2 launch amr_2dsim
                                                   sim_bringup.launch.py
```

- **rosbridge WebSocket** พอร์ต `9090` — `src/App.jsx` เป็นคน own
  `ROSLIB.Ros` connection เดียวของทั้งแอป (auto-reconnect ทุก 1s)
- **map-server.cjs** (root ของ dashboard repo) พอร์ต `3001` — Express server
  ที่ Electron auto-fork ตอน start (`electron/main.js`) มีหน้าที่:
  - `POST /switch {robot, world}` → spawn `ros2 launch amr_2dsim
    sim_bringup.launch.py urdf_file:=... world_file:=...`
  - `POST /stop` → SIGINT แล้ว SIGKILL, kill orphan process (rosbridge,
    amr_sim_node ฯลฯ)
  - serve map/urdf/robots files ให้ dashboard render

### Topics/contract ที่ต้อง match กันระหว่าง sim node กับ dashboard
- `/cmd_vel` (`geometry_msgs/Twist`) — dashboard publish (keyboard teleop),
  sim node subscribe
- `/odom` (`nav_msgs/Odometry`) — sim node publish, dashboard subscribe
  (วาด robot marker บนแผนที่)
- `/amr_simulator/set_parameters` (`rcl_interfaces/srv/SetParameters`) —
  toggle `enable_watchdog` จาก dashboard
- URDF ของ robot ต้องมี custom `<amr_sim_config>` XML block
  (kinematic_model, wheel_base, robot_radius ฯลฯ) — schema เดียวกันทั้งสองฝั่ง

## วิธี wire dashboard เข้ากับ amr_2dsim checkout (บนเครื่องจริงที่มี ROS 2)

Sandbox/cloud session **ไม่มี ROS 2 / colcon ติดตั้ง** ดังนั้น run sim node
จริงไม่ได้ในนี้ — ต้องทำบนเครื่องที่มี ROS 2 ติดตั้งอยู่ (distro ไหนก็ได้)

1. **Build `amr_2dsim` เข้า ROS 2 workspace** — `map-server.cjs` (บรรทัด
   12-26) auto-detect ROS distro เองจาก `/opt/ros/<distro>/setup.bash`
   (รองรับ `jazzy`, `humble`, `lyrical` เป็นต้น) และ auto-detect workspace
   path (บรรทัด 28-47) เฉพาะ path พวกนี้: `~/simamr_ws/install/setup.bash`,
   `/opt/irish-amr-sim/simamr_ws/setup.bash` ฯลฯ วิธีง่ายสุดคือ symlink/clone
   `amr_2dsim` ไปไว้ที่ path เหล่านี้ แล้ว source ROS distro ที่เครื่องมีจริง:
   ```bash
   mkdir -p ~/simamr_ws/src
   ln -s /path/to/amr_2dsim ~/simamr_ws/src/amr_2dsim
   cd ~/simamr_ws
   source /opt/ros/<your-distro>/setup.bash   # เช่น jazzy, humble
   colcon build --symlink-install
   ```
2. **หรือใช้ path เอง** — ตั้ง env var `AMR_WS_SETUP=/custom/path/install/setup.bash`
   ก่อน `npm run dev` (ต้อง verify ชื่อ env var ที่แน่นอนใน `map-server.cjs`
   อีกที เพราะยังไม่ได้ re-read ล่าสุด)
3. **ติดตั้ง rosbridge dependency**: `sudo apt install ros-<your-distro>-rosbridge-suite`
   (เช่น `ros-jazzy-rosbridge-suite`) ถ้าไม่มี `sim_bringup.launch.py` จะ fail
   แม้ build ผ่าน
4. **Start**:
   ```bash
   cd amr-sim-dashboard && npm install && npm run dev
   ```
   `map-server.cjs` จะถูก Electron fork ให้อัตโนมัติ (พอร์ต 3001) แล้ว
   dashboard จะต่อ rosbridge (พอร์ต 9090) ให้เอง เลือก robot/world แล้วกด
   "switch" ใน UI เพื่อ launch sim

ไม่ต้องแก้ topic name / message type / URDF schema อะไรเพิ่ม — ของเดิม match
กันอยู่แล้ว ปัญหาเดียวคือ workspace path ที่ต้องชี้ให้ถูกในเครื่องที่จะรันจริง

## Agent rules (จาก AI_HANDOVER.md เดิม)
- **Ponytail Rule**: minimal diff, no unnecessary abstraction, ลบดีกว่าเพิ่ม,
  fix root cause ไม่ patch อาการ
- **Concise Thai Communication**: ตอบเป็นภาษาไทยแบบกระชับ ใช้ศัพท์ English
  เฉพาะคำที่สำคัญ/เป็น technical term (เช่น ROS 2, colcon, rosbridge,
  WebSocket, launch file)
