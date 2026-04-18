# NoteUp

โปรเจค NoteUp เป็นเว็บแอปขนาดเล็กสำหรับอัปโหลด แชร์ และดูเอกสาร/โน้ต (PDF) โดยออกแบบให้แบ่งเป็นส่วน Backend (Node.js/Express) และ Frontend (static HTML/CSS/JS)

## คุณสมบัติหลัก
- อัปโหลดไฟล์ PDF และจัดเก็บในเซิร์ฟเวอร์
- แสดงรายการโน้ตพร้อมหน้าดูตัวอย่าง
- แก้ไขโปรไฟล์ผู้ใช้ (หน้าโปรไฟล์)
- ส่วนจัดการเส้นทาง API เรียบง่ายสำหรับการเชื่อมต่อกับฐานข้อมูล

## สถาปัตยกรรม
- Backend: Node.js, Express
- Frontend: ไฟล์ HTML/CSS/JS ในโฟลเดอร์ `frontend/`
- Database: การตั้งค่าการเชื่อมต่อใน `backend/config/database.js`

## ติดตั้ง (Development)
ต้องติดตั้ง Node.js และ npm ก่อน

1. ติดตั้ง dependencies ของ backend

```bash
cd backend
npm install
```

2. รันเซิร์ฟเวอร์ (development)

```bash
# จากโฟลเดอร์ backend
npm start
```

3. เปิดหน้า Frontend
- เปิดไฟล์ `frontend/main.html` โดยตรงในเบราว์เซอร์ หรือรัน static server เพื่อทดสอบการเชื่อมต่อกับ backend

## โครงสร้างโปรเจค (สำคัญ)
- `backend/` — โค้ดเซิร์ฟเวอร์ (Express)
	- `server.js` — entry point ของเซิร์ฟเวอร์
	- `routes/` — เส้นทาง API (เช่น `noteRoutes.js`, `userRoutes.js`)
	- `config/database.js` — การตั้งค่าฐานข้อมูล
- `frontend/` — หน้าเว็บ client แบบ static
	- `main.html`, `upload.html`, `view-note.html`, `profile.html`, `edit-profile.html`
	- `assets/`, `css/`, `js/`
- `public/` — ไฟล์สาธารณะของเซิร์ฟเวอร์ (เช่นไฟล์ที่อัปโหลด)

## การพัฒนาเพิ่มเติม
- ปรับแต่งการเชื่อมต่อฐานข้อมูลใน `backend/config/database.js`
- เพิ่มการตรวจสอบสิทธิ์ผู้ใช้ (authentication) หากต้องการระบบล็อกอินจริง
