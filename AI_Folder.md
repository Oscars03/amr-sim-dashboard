# Folder Map (companion to AI_HANDOVER.md)

> อ่าน `AI_HANDOVER.md` ก่อนเสมอ (มี architecture, build workflow, agent rules)
> ไฟล์นี้เสริมแค่ "ไฟล์ไหนอยู่ตรงไหน" เพื่อกัน agent grep ทั้ง repo
> ไม่ทวนซ้ำสิ่งที่ HANDOVER บอกแล้ว (paths, tech stack, build commands, ponytail rule)

---

## `amr-sim-dashboard/`

### Ignore เสมอ (build artifacts)
```
release/  dist/  dist-electron/  out/  coverage/  graphify-out/
```

### `electron/` — main process (2 ไฟล์เท่านั้น)
```
main.js       window mgmt, IPC handlers, ROS process spawn/kill, rosbridge lifecycle
preload.js    contextBridge / IPC exposure ให้ renderer
```

### `src/components/`
```
views/
  CreateRobotView.jsx
  CreateWorldView.jsx / .css
  DashboardView.jsx
  ImportRosMapModal.jsx / .css
  MapEditor.jsx

common/
  SplitButton.jsx / .css

ui/
  Card.jsx / .css
  Header.jsx              (navy blue header)
  Slider.jsx / .css
  UpdateProgressModal.jsx / .css   (firmware modal, radar sweep animation)
  EnvironmentCheckModal.jsx / .css (ROS 2 environment health checker & install guide)
```
> teleop keypad — ยังไม่ยืนยันไฟล์ ต้องดูเพิ่ม (ไม่อยู่ใน ui/ หรือ views/ ที่เห็น)

### `src/` อื่นๆ
```
store/
  useAppStore.js     global state (Zustand-style)

hooks/
  useIsCompact.js    responsive breakpoint hook
  # keyup/keydown teleop logic — ยังไม่ยืนยันตำแหน่ง เช็ค App.jsx ก่อน

services/    ยังไม่สำรวจไฟล์ข้างใน
styles/      ยังไม่สำรวจไฟล์ข้างใน
assets/      hero.png, imagermbg.png, irish-wbg.png, react.svg, vite.svg

App.jsx / App.css    root component
main.jsx             entry point
```

---

## `simamr_ws/src/amr_2dsim/`

### Ignore
```
graphify-out/  __pycache__/  .pytest_cache/
```

### Structure
```
amr_2dsim/     Python node package
  simulator_node.py
    - Ackermann kinematic model: δ = arctan(ω·l_wb / v_x), clamped to max steer (30°)
    - drive-axle alignment validator

urdf/
  rhino.urdf
    - <amr_sim_config>: wheel_base = 0.385m, max_steering_angle = 18° (0.314 rad)
    - base_link origin: Ackermann configuration aligned with physical Rhino robot
  amr.urdf

launch/    rviz/    worlds/    maps/    server/    resource/
```

---

## Known bug locations (ประวัติ ไม่ต้อง grep หาใหม่)
- `App.jsx`: missing keyup handler, zeroCount reset, divide-by-zero (map editor eraser), hardcoded duplicate URL
- `simulator_node.py`: Ackermann branch เคย no-op (fixed แล้ว — เช็คไฟล์นี้ก่อนถ้ามีปัญหา kinematics ใหม่)
- canvas rendering (gradient shading, `drawRobot()`, mecanum wheel visuals) — อยู่ใน component ที่ render robot บน canvas (ยังไม่ยืนยันชื่อไฟล์ชัดเจน — น่าจะอยู่ใน `views/DashboardView.jsx` หรือแยกเป็น component ของตัวเอง)

---

## หมายเหตุ
- ไฟล์นี้ยังมีช่องว่าง (services/, styles/, teleop keypad) — เติมเมื่อสำรวจเพิ่ม