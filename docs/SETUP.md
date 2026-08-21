# คู่มือติดตั้ง Easy Fix (ทีละขั้น)

ใช้เวลาประมาณ 45–60 นาที · ต้องมี: บัญชี Google, บัญชี LINE Developers, บัญชี Groq (ฟรี)

---

## ขั้นที่ 1 — สร้าง Google Sheet ฐานข้อมูล

ใช้ชีตชื่อ **Easy Fix** ที่มีอยู่แล้ว (หรือสร้างใหม่ก็ได้)

**นำเข้าฐานข้อมูลเจ้าของห้อง 211 คน (พร้อมใช้):** ผมเตรียมไฟล์ [`data/Employees.csv`](../data/Employees.csv) ไว้ให้แล้ว
1. เปิด Google Sheet **Easy Fix** → ดับเบิลคลิกชื่อแท็บ `Sheet1` → เปลี่ยนเป็น **`Employees`**
2. เมนู **ไฟล์ (File) → นำเข้า (Import) → อัปโหลด (Upload)** → เลือกไฟล์ `Employees.csv`
3. Import location: เลือก **"แทนที่ชีตปัจจุบัน (Replace current sheet)"** → Separator: Comma → **Import data**
4. เสร็จ! แท็บ `Employees` จะมีข้อมูลครบ 211 คน พร้อมหัวตาราง `no · empCode · name · dept · zone · room · pinHash · phone · lineUserId`

> คอลัมน์ `pinHash / phone / lineUserId` เว้นว่างไว้ — ระบบจะเติมเองเมื่อพนักงานตั้ง PIN / แจ้งซ่อม / ผูก LINE

---

## ขั้นที่ 2 — ติดตั้ง Apps Script

1. ในสเปรดชีต → เมนู **ส่วนขยาย (Extensions) → Apps Script**
2. ลบโค้ดเดิมทิ้ง → วางเนื้อหาไฟล์ `backend/Code.gs` ทั้งหมด
3. กด 💾 บันทึก
4. ในช่องเลือกฟังก์ชัน เลือก **`setupSheets`** → กด **Run** (ครั้งแรกจะขออนุญาต → Allow)
   → ระบบจะสร้างแท็บ `Employees`, `Tickets`, `Config`, `Log` พร้อมหัวตารางให้อัตโนมัติ

---

## ขั้นที่ 3 — ตรวจข้อมูลพนักงาน

ถ้าทำขั้นที่ 1 แล้ว แท็บ `Employees` จะมีข้อมูลครบ 211 คนอยู่แล้ว — ข้ามไปขั้นที่ 4 ได้เลย
(หัวตารางแถว 1: `no · empCode · name · dept · zone · room · pinHash · phone · lineUserId`)

> พนักงานทุกคนเข้าด้วย **PIN กลาง `1234`** (ตราบใดที่คอลัมน์ pinHash ยังว่าง)
>
> **บทบาท (พนักงาน/ผู้ดูแล) แยกอัตโนมัติจากรหัสล็อกอิน** — ถ้ารหัสอยู่ในแท็บ `Admins` = ผู้ดูแลระบบ, ไม่งั้น = พนักงาน
> ไม่ต้องเลือกโหมดตอน login. เพิ่ม/แก้ผู้ดูแลได้ในแท็บ `Admins` (คอลัมน์: adminCode · name · position · pinHash)
> ค่าเริ่มต้น: `admin01` / PIN `1234`

---

## ขั้นที่ 4 — ใส่ค่า Config

ไปที่แท็บ `Config` กรอกคอลัมน์ value:

| key | value |
|-----|-------|
| HR_KEY | (ตั้งรหัสลับสำหรับ HR login เช่น hr2026xyz) |
| DRIVE_FOLDER_ID | (สร้างโฟลเดอร์ใน Drive เก็บรูป แล้วเอา id จาก URL) — เว้นว่างได้ จะเก็บที่ root |

> 🔒 ปลอดภัยกว่า: เก็บ secret ใน **Project Settings → Script Properties** แทน (โค้ดอ่านจากที่นั่นก่อน)

---

## ขั้นที่ 5 — Deploy Web App

1. Apps Script → **Deploy → New deployment → เลือก Web app**
2. Execute as: **Me (ฉัน)**
3. **Who has access: `Anyone` (ทุกคน)** ⚠️ **สำคัญมาก** — ต้องเลือก "ทุกคน" ไม่ใช่ "ทุกคนที่มีบัญชี Google"
   ไม่งั้นพนักงานจะโดนเด้งไปหน้า login ของ Google และแอปจะใช้ไม่ได้
4. กด Deploy → คัดลอก **Web app URL** (ลงท้าย `/exec`) → ใส่ในไฟล์ `app/index.html` และ `app/hr.html` ที่ตัวแปร `API_URL`

> ⚠️ ทุกครั้งที่แก้ Code.gs ต้อง **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**
> (URL เดิมจะไม่เปลี่ยน)

---

## ขั้นที่ 6 — เผยแพร่แอปมือถือ (PWA)

เลือกวิธีใดวิธีหนึ่ง (ฟรีทั้งหมด):

- **Netlify Drop:** ลากโฟลเดอร์ `app/` ไปวางที่ https://app.netlify.com/drop
- **GitHub Pages:** อัปโหลดโฟลเดอร์ `app/` ขึ้น repo → Settings → Pages → เปิด
- **Cloudflare Pages / Vercel:** อัปโหลดโฟลเดอร์ `app/`

พนักงานเปิดลิงก์บนมือถือ → เมนู "เพิ่มไปยังหน้าจอโฮม (Add to Home Screen)" → ใช้เหมือนแอป

---

## ขั้นที่ 7 — ทดสอบ

1. เปิด PWA → login ด้วยรหัสพนักงานจริง (เช่น 19474) → ตั้ง PIN → เห็นข้อมูลบ้านพัก
2. แจ้งซ่อม + เลือกอาการ + แนบรูป + เลือกความเร่งด่วน → กดส่ง → มีใบงานใน Sheet แท็บ `Tickets`
3. เปิด `hr.html` → login ด้วย HR_KEY → เปลี่ยนสถานะ/ใส่วันนัด/หมายเหตุ → กดบันทึก
4. กลับมาที่แอปพนักงาน → แท็บ "งานซ่อม" → เห็นสถานะอัปเดต → เมื่อ "เสร็จ" กดให้คะแนน ⭐
