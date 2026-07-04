# AMR Sim Dashboard

Dashboard สำหรับการควบคุมและแสดงผลการจำลองหุ่นยนต์ (Autonomous Mobile Robot) พัฒนาด้วย React, Vite และ Electron

## Getting Started

ทำตามขั้นตอนด้านล่างนี้เพื่อรันโปรเจกต์บนเครื่อง Ubuntu ของคุณ:

### 1. Prerequisites

ตรวจสอบให้แน่ใจว่าคุณได้ติดตั้งซอฟต์แวร์ต่อไปนี้ในเครื่องแล้ว:

* [Node.js](https://nodejs.org/) (แนะนำเวอร์ชัน 24 ขึ้นไป)
* [ROS 2](https://docs.ros.org/) (สำหรับสื่อสารกับหุ่นยนต์)

### 2. Clone the Repository

```bash
git clone https://github.com/Oscars03/amr-sim-dashboard.git
cd amr-sim-dashboard

```

### 3. Install Dependencies & Setup Permissions

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

### 4. Run Development Mode

เริ่มต้นการใช้งาน Dashboard ในโหมดพัฒนา:

```bash
npm run dev

```

---

## Additional Notes

* หากคุณพบปัญหาการเชื่อมต่อ ROS 2 ในระหว่างใช้งาน ให้ตรวจสอบให้แน่ใจว่าได้ `source` สภาพแวดล้อม ROS 2 ของคุณ (`source ~/robot_ws/install/setup.bash`) ใน Terminal ก่อนรัน `npm run dev` ครับ

## Built With

* [React](https://react.dev/)
* [Vite](https://vitejs.dev/)
* [Electron](https://www.electronjs.org/)

---

*หมายเหตุ: ข้อมูลนี้ถูกปรับปรุงเพื่อให้การตั้งค่า Electron บน Ubuntu ราบรื่นที่สุด*
