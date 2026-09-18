# IRiSH AMR Simulator

Dashboard สำหรับจำลองและควบคุม AMR (Autonomous Mobile Robot) แบบ 2D — Electron + React
ต่อกับ ROS 2 ผ่าน rosbridge WebSocket แล้วสั่งรัน sim node (`amr_2dsim`) ให้อัตโนมัติ

[ดาวน์โหลดเวอร์ชันล่าสุด](https://github.com/Oscars03/amr-sim-dashboard/releases/latest) · รองรับ x86_64 และ arm64

---

## Features

### ควบคุม Simulation
* เลือก **robot + world** จากรายการแล้วกด **Launch** — แอปสั่ง `ros2 launch amr_2dsim sim_bringup.launch.py`
  ให้เอง (ยก sim node + rosbridge + rosapi + robot_state_publisher ขึ้นพร้อมกัน) ไม่ต้องพิมพ์คำสั่ง ROS เอง
* **Teleop จาก UI** — D-pad บนจอ หรือคีย์บอร์ด: `I` เดินหน้า, `,` ถอย, `J`/`L` เลี้ยวซ้าย/ขวา,
  `U`/`O` เฉียงหน้า, `M`/`.` เฉียงหลัง, `K` เบรกฉุกเฉิน, กด `Shift` ค้าง = โหมด **holonomic (omni)**
* ปรับความเร็วสด ๆ — `W`/`X` เพิ่ม/ลด linear speed, `E`/`C` เพิ่ม/ลด turn speed
* สลับ **Web control ↔ Terminal** ได้ — โหมด Terminal จะปล่อย `/cmd_vel` ให้ node อื่น
  (เช่น `teleop_twist_keyboard` หรือ Nav2) คุมแทน
* ตั้ง **spawn pose** (x, y, yaw) เอง, ปุ่ม *Use Current* ดึง pose ปัจจุบันของหุ่นมาเป็นจุดเกิด,
  และ Reset หุ่นกลับจุด spawn ได้ทันที
* **Idle watchdog** — ถ้าหุ่นไม่ขยับเกิน 1 ชั่วโมง sim จะถูก stop อัตโนมัติ กัน dashboard
  ที่เปิดค้างข้ามคืนกิน CPU ทิ้ง

### แสดงผลและตรวจสอบ
* แผนที่ 2D สด: robot marker จาก `/odom`, lidar rays, zoom / pan / rotate,
  โหมด **Follow** ให้กล้องเกาะหุ่น และปุ่ม Center
* **Topic Monitor** — ดู topic/service ที่มีอยู่จริงใน ROS graph (ผ่าน `rosapi`)
* **Environment Check** ตอนเปิดแอป — ตรวจ ROS distro, package `amr_2dsim`, `rosapi`
  และ rosbridge ด้วย `ros2 pkg prefix` แล้วบอกตรง ๆ ว่าอะไรขาด
* ตัวบ่งชี้ **collision** และปุ่ม **Trigger Mission Actuator** (`/actuate_effect`)

### สร้าง Robot เอง
* ฟอร์มกรอกค่า identity / geometry / wheels / sensors → generate URDF พร้อมบล็อก `<amr_sim_config>` ให้เลย
* รองรับ kinematic model: `diff_drive`, `ackermann`, `mecanum`, `omni`

### สร้าง World เอง
* วาดแผนที่ 2D ในแอป — zoom, pan, undo/redo ย้อนได้ลึก 100 ขั้น
* **Import แผนที่จาก ROS** ได้ตรง ๆ (`.pgm` + `.yaml` ที่ได้จาก `map_saver`) พร้อม preview และหมุนแผนที่ก่อนบันทึก

### ตัวแอป
* **Auto-update** ผ่าน electron-updater — มีเวอร์ชันใหม่จะแจ้งและโหลดให้ในแอปเลย
* Single-instance lock (กันเปิดซ้ำ), map server (พอร์ต 3001) fork ให้อัตโนมัติ
* **Command Palette** `Ctrl+K`, คู่มือคีย์ลัด `?`, ธีม dark/light

---

## OS Compatibility

แอปนี้ **ไม่ได้ bundle ROS 2 runtime มาให้** — เครื่องปลายทางต้องมี ROS 2 ติดตั้งอยู่แล้ว
(ตัว sim workspace ที่ build แล้วถูก bundle มาในไฟล์ติดตั้งให้เรียบร้อย)

| สภาพแวดล้อม | สถานะ |
| --- | --- |
| **Ubuntu 24.04 + ROS 2 Jazzy** | ✅ ไฟล์ release ใช้ได้เลย (Python 3.12) |
| **Ubuntu 22.04 + ROS 2 Humble** | ✅ ไฟล์ release ตัวเดียวกันใช้ได้เลย (Python 3.10) |
| **ROS 2 Lyrical** | ✅ ไฟล์ release ตัวเดียวกันใช้ได้เลย (Python 3.14) |
| x86_64 / amd64 | ✅ มีไฟล์ release ให้โหลด |
| arm64 | ✅ มีไฟล์ release ให้โหลด ตั้งแต่ v0.4.2 (Raspberry Pi 5, Jetson, Ubuntu บน Apple Silicon) |
| macOS / Windows | ❌ ตรง ๆ ไม่ได้ — แต่รันผ่าน VM ได้ [ดูวิธี](#macos--windows--ต้องผ่าน-vm) |

ไฟล์ release **ไฟล์เดียวใช้ได้ทุก distro ข้างบน** — แยกกันแค่ architecture เท่านั้น เป็นเพราะ
ROS package ทั้งสามตัว (`amr_2dsim`, `amr_navigation`, `amr_explorer`) เป็น `ament_python`
ล้วน ไม่มี compiled extension สักไฟล์ (ตรวจแล้ว: `.so` 0 ไฟล์ในทั้ง workspace) ส่วน ROS
runtime ใช้ของเครื่องปลายทาง ที่ต้องแยก build ตาม architecture คือตัว Electron เท่านั้น

ไม่ใช่การอนุมาน — ทุก release จะถูกทดสอบอัตโนมัติด้วย
[`release-smoke.yml`](.github/workflows/release-smoke.yml) ที่ลง `.deb` จริงลงคอนเทนเนอร์
`ros:<distro>-ros-base` สะอาด ๆ **3 distro × 2 architecture = 6 job** แล้วเช็คว่า sim launch
ขึ้นและ topic (`/odom` `/scan` `/camera/image_raw` `/joint_states`) กับ rosbridge ทำงานครบ
ฝั่ง arm64 รันบน runner ที่เป็น arm64 จริง ไม่ใช่ qemu
([ผลของ v0.4.1](https://github.com/Oscars03/amr-sim-dashboard/actions/runs/35331403642) —
ตอนนั้นยังมีแต่ amd64)

> ชื่อไฟล์ยังมี `_jazzy_` ติดอยู่ด้วยเหตุผลทางประวัติศาสตร์ — เป็นแค่ชื่อ ไม่ได้แปลว่าใช้ได้แค่ Jazzy

### macOS / Windows — ต้องผ่าน VM

map server อ่าน `/opt/ros/<distro>/setup.bash` ตรง ๆ และ rosbridge ติดตั้งผ่าน `apt` —
ทั้งสองอย่างไม่มีบน macOS/Windows จึงรันแบบ native ไม่ได้ ทางออกคือลง **Ubuntu ใน VM**
แล้วทำตามขั้นตอนฝั่ง Linux ทุกอย่างตามปกติ ไม่ต้องตั้งค่าอะไรเพิ่มเป็นพิเศษ

| เครื่องคุณ | ตัวที่ใช้ได้ | ไฟล์ release ที่ต้องโหลด |
| --- | --- | --- |
| Windows (x86) | VirtualBox · VMware Workstation · Hyper-V | `x86_64` (AppImage) / `amd64` (deb) |
| Mac Intel | VirtualBox · VMware Fusion | `x86_64` / `amd64` |
| Mac Apple Silicon (M1–M4) | UTM · VMware Fusion · Parallels | **`arm64`** — Ubuntu บน Apple Silicon เป็น arm64 |

* ให้ VM อย่างน้อย **4 GB RAM / 2 vCPU** และเปิด 3D acceleration — dashboard เป็น Electron
  ที่วาด canvas สดตลอดเวลา
* rosbridge (9090) กับ map server (3001) อยู่ใน VM ทั้งคู่ ไม่ต้อง forward port ออกมา
  นอกจากจะอยากเปิด dashboard จากฝั่ง host
* snapshot ไว้ก่อนลง ROS 2 ช่วยประหยัดเวลาตอนพัง

> **WSL2 บน Windows 11** เป็นอีกทางที่น่าจะใช้ได้ (WSLg รัน GUI app ได้) แต่ **ยังไม่ได้ทดสอบ
> กับแอปนี้** ถ้าจะลอง เตรียมเจอสองจุด: AppImage ต้องการ `libfuse2` (หรือใช้
> `--appimage-extract-and-run`) และ DDS discovery ของ ROS 2 ใน WSL2 เคยมีปัญหาเรื่อง
> multicast — เคสนี้ทุก node อยู่ใน instance เดียวกันจึงไม่น่ากระทบ แต่ยืนยันให้ไม่ได้

---

## Download & Install (ฉบับเต็ม)

### ติดตั้งแบบคำสั่งเดียว (Ubuntu)

มี ROS 2 อยู่แล้ว วางบรรทัดนี้ได้เลย — ลง dependency, ดึง AppImage ตัวล่าสุดจาก Releases,
ให้สิทธิ์รัน แล้วเปิดแอป:

```bash
sudo apt install -y ros-jazzy-rosbridge-suite python3-numpy && \
ARCH=$([ "$(uname -m)" = aarch64 ] && echo arm64 || echo x86_64) && \
curl -fsSL "$(curl -fsSL https://api.github.com/repos/Oscars03/amr-sim-dashboard/releases/latest \
  | grep -oE "https://[^\"]+_${ARCH}\.AppImage")" -o ~/irish-amr-sim.AppImage && \
chmod +x ~/irish-amr-sim.AppImage && ~/irish-amr-sim.AppImage
```

(ใช้ ROS distro อื่นให้เปลี่ยน `ros-jazzy-` เป็น `ros-<distro>-` · เจอ error เรื่อง sandbox
ให้ต่อท้ายด้วย `--no-sandbox`)

> **Ubuntu Server / minimal ที่ไม่มี desktop** จะไม่มีไลบรารีที่ Electron ต้องใช้ติดมาให้
> `.deb` ประกาศ dependency ครบแล้ว (apt ลงให้เอง) แต่ **AppImage ประกาศ dependency ไม่ได้** —
> ต้องลงเองก่อน และ AppImage ยังต้องการ libfuse **2** ด้วย (runtime ของมัน `dlopen` `libfuse.so.2`):
> ```bash
> sudo apt install -y libasound2t64 libgbm1 libfuse2t64   # Ubuntu 24.04
> sudo apt install -y libasound2 libgbm1 libfuse2         # Ubuntu 22.04
> ```
> ไม่อยากลง libfuse2 ก็รันแบบแตกไฟล์แทนได้: `./irish-amr-sim.AppImage --appimage-extract-and-run`

รายละเอียดทีละขั้นอยู่ข้างล่าง

### 1. ติดตั้ง ROS 2 + dependencies

```bash
# ROS 2 (แนะนำ Jazzy บน Ubuntu 24.04) — ดู https://docs.ros.org/
sudo apt install ros-jazzy-rosbridge-suite python3-numpy
```

`rosbridge-suite` จำเป็นเสมอ (dashboard คุยกับ ROS ผ่านมันที่พอร์ต 9090) และมี `rosapi`
ติดมาด้วย ซึ่งเป็นตัวที่ทำให้ Topic Monitor ใช้งานได้

### 2. โหลดตัวแอป

โหลด `.AppImage` จาก [GitHub Releases](https://github.com/Oscars03/amr-sim-dashboard/releases/latest)
โดยเลือกให้ตรง architecture — `uname -m` ตอบ `x86_64` ให้เอาไฟล์ `_x86_64`, ตอบ `aarch64`
ให้เอา `_arm64`

```bash
chmod +x irish-amr-sim_*.AppImage
./irish-amr-sim_*.AppImage
# เจอ error เรื่อง sandbox ให้ใช้ ./irish-amr-sim_*.AppImage --no-sandbox
```

ไฟล์นี้คือ **ฉบับเต็ม** — bundle ROS 2 workspace ที่ build แล้ว (`simamr_ws/install`)
มาให้ในตัวตั้งแต่ v0.2.9 เป็นต้นไป เปิดปุ๊บใช้ได้เลย ไม่ต้อง clone repo หรือ `colcon build` เอง

### 3. เช็คว่าพร้อมใช้

เปิดแอปครั้งแรกจะมีหน้าต่าง **Environment Check** ขึ้นมาบอกสถานะทุกอย่าง (ROS distro, `amr_2dsim`,
`rosapi`, rosbridge) — ถ้าเขียวหมดคือพร้อมกด Launch

### Auto-update ใช้ได้กับแบบไหนบ้าง

| วิธีติดตั้ง | อัปเดตจากในแอป |
| --- | --- |
| **AppImage จาก Releases** | ✅ แอปโหลดตัวใหม่แล้วเขียนทับไฟล์ AppImage เดิมให้ |
| **`.deb` จาก Releases** | ✅ แอปโหลด `.deb` ตัวใหม่แล้วสั่ง `dpkg -i` ให้ — จะมีหน้าต่างขอรหัสผ่าน (pkexec) ตอนติดตั้ง |
| `.deb` ที่ build เองด้วย `build_deb.sh` | ✅ เหมือนกัน — ใช้ชื่อแพ็กเกจ `irish-amr-simulator` เดียวกัน `dpkg` จึง upgrade ทับให้ |

ตั้งแต่ v0.4.0 เป็นต้นไป GitHub Release อัปทั้ง `.AppImage` และ `.deb` พร้อม `latest-linux.yml`
ที่ลิสต์ทั้งสองไฟล์ — electron-updater จะเลือกไฟล์ให้ตรงกับวิธีที่ติดตั้งมาเอง
(`resources/package-type` เป็นตัวบอกว่าเครื่องนี้ลงมาแบบไหน)

ตั้งแต่ v0.4.2 มี `latest-linux-arm64.yml` เพิ่มมาอีกไฟล์ เครื่อง arm64 จะอ่านไฟล์นั้นไฟล์เดียว
จึงอัปเดตแยกกันคนละสายกับ x86_64

> เวอร์ชันก่อน v0.4.0 อัปแค่ `.AppImage` — เครื่องที่ลงด้วย `.deb` รุ่นเก่าจะเห็นว่ามีเวอร์ชันใหม่
> แต่โหลดไม่สำเร็จ ลง `.deb` ของ v0.4.0 ทับหนึ่งรอบแล้วรอบต่อ ๆ ไปจะอัปเดตเองได้

### ทางเลือก: ติดตั้งเป็น `.deb` ทั้งระบบ

`.deb` จาก Releases ลงได้ตรง ๆ อยู่แล้ว (`sudo dpkg -i irish-amr-sim_*_amd64.deb`) — ส่วน
วิธีข้างล่างนี้คือ build เองจากซอร์ส สำหรับเครื่องที่อยากให้ `colcon build` ตอนติดตั้ง:

```bash
git clone https://github.com/Oscars03/amr-sim-dashboard.git
cd amr-sim-dashboard && npm install
./build_deb.sh                    # ถามเวอร์ชัน + architecture (amd64 / arm64)
sudo dpkg -i irish-amr-simulator_*.deb
```

`.deb` ตัวนี้ `colcon build` workspace ให้เองตอนติดตั้ง (`postinst`) จึงใช้ได้กับ ROS distro
ที่เครื่องปลายทางมีจริง ไม่ผูกกับ Jazzy — แต่เครื่องนั้นต้องมี `python3-colcon-common-extensions`

---

## Example Use

**สถานการณ์**: อยากลองขับหุ่น diff-drive ในห้องสี่เหลี่ยม แล้วเอาแผนที่จริงที่ SLAM ไว้มาใช้ต่อ

1. **เปิดแอป** → รอ Environment Check ขึ้นเขียวครบ → ปิดหน้าต่าง
2. **เลือกของที่จะรัน** — dropdown `Robot` เลือก `amr.urdf`, `World` เลือก `Square Room`
   แล้วตั้ง spawn pose เป็น `x=0, y=0, yaw=0°`
3. **กด Launch** — สถานะบนหัวจะไล่จาก `LAUNCHING` → `RUNNING` แล้วหุ่นจะโผล่บนแผนที่
   พร้อม lidar rays รอบตัว
4. **ขับดู** — คลิกพื้นที่แผนที่ให้ focus แล้วกด `I` เดินหน้า, `J`/`L` เลี้ยว, `K` เบรก
   ถ้าอยากเร็วขึ้นกด `W` รัว ๆ · เปิด **Follow** ให้กล้องเกาะหุ่นเวลาขับไกล ๆ
5. **ลอง holonomic** — กด `Shift` ค้างไว้แล้วกด `J`/`L` หุ่นจะสไลด์ข้างแทนการเลี้ยว
   (ใช้ได้เมื่อ robot เป็น `mecanum` / `omni`)
6. **เอาแผนที่จริงมาใช้** — ไปหน้า *Create World* → **Import ROS Map** → อัปโหลด `.pgm` + `.yaml`
   จาก `ros2 run nav2_map_server map_saver_cli` → หมุนให้ถูกทิศใน preview → Save
   แล้วกลับหน้าหลัก เลือก world ที่เพิ่งสร้างแล้ว Launch ใหม่
7. **อยากได้หุ่นทรงอื่น** — หน้า *Create Robot* กรอก wheel base / robot radius / kinematic model
   (เช่น `ackermann` สำหรับรถบังคับเลี้ยวหน้า) → Save ได้ URDF ใหม่โผล่ใน dropdown ทันที
8. **เลิกใช้** — กด **Stop** (หรือปล่อยไว้เฉย ๆ 1 ชั่วโมง watchdog จะ stop ให้เอง)

อยากให้ Nav2 หรือ node อื่นขับแทน: สลับเป็นโหมด **Terminal** แล้ว publish `/cmd_vel` เข้ามาได้เลย
dashboard จะหยุดส่ง twist ของตัวเองแต่ยังวาดผลลัพธ์ให้ดูตามปกติ

---

<sub>นักพัฒนา: ขั้นตอน build จากซอร์ส, dev server และการ cut release อยู่ใน `RELEASE.md`</sub>
