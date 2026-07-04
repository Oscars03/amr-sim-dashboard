# AMR Sim Dashboard

Dashboard สำหรับการควบคุมและแสดงผลการจำลองหุ่นยนต์ (Autonomous Mobile Robot) พัฒนาด้วย React, Vite และ Electron

## Getting Started

ทำตามขั้นตอนด้านล่างนี้เพื่อรันโปรเจกต์บนเครื่อง Ubuntu ของคุณ:

### 1. Prerequisites

ตรวจสอบให้แน่ใจว่าคุณได้ติดตั้งซอฟต์แวร์ต่อไปนี้ในเครื่องแล้ว:

* [Node.js](https://nodejs.org/) (แนะนำเวอร์ชัน 18 ขึ้นไป)
* [ROS 2](https://docs.ros.org/) (สำหรับสื่อสารกับหุ่นยนต์)

### 2. Clone the Repository

```bash
git clone https://github.com/Oscars03/amr-sim-dashboard.git
cd amr-sim-dashboard

```

### 3. Install Dependencies

ติดตั้งแพ็กเกจที่จำเป็นสำหรับโปรเจกต์:

```bash
sudo apt install npm
npm install

```

### 4. Run Development Mode

เริ่มต้นการใช้งาน Dashboard ในโหมดพัฒนา:

```bash
npm run dev

```

หลังจากรันคำสั่ง ระบบจะเปิดหน้าต่างแอปพลิเคชันขึ้นมา หรือสามารถเข้าถึงผ่าน Browser ที่ `http://localhost:5173` (ตามที่ Vite กำหนด)

## Built With

* [React](https://react.dev/)
* [Vite](https://vitejs.dev/)
* [Electron](https://www.electronjs.org/)

---

### คำแนะนำเพิ่มเติม:

* หากคุณพบปัญหาการเชื่อมต่อ ROS 2 ในระหว่างใช้งาน ให้ตรวจสอบให้แน่ใจว่าได้ `source` สภาพแวดล้อม ROS 2 ของคุณ (`source ~/robot_ws/install/setup.bash`) ใน Terminal ก่อนรัน `npm run dev` ครับ
# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
