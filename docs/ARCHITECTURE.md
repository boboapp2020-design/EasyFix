# Easy Fix — สถาปัตยกรรมระบบแจ้งซ่อมบ้านพักพนักงาน

> ระบบแจ้งซ่อมบ้านพักพนักงาน: แอปมือถือ (PWA) + Google Sheets + LINE Bot + Groq AI
> อัปเดต: 2026-08-21

---

## 1. ภาพรวม (ทำไมเลือกสถาปัตยกรรมนี้)

โจทย์ต้องการ: แอปมือถือ, ผูกข้อมูลกับ Google Sheet, LINE bot แจ้งเตือน + ถาม AI (Groq),
ไม่มีทีมดูแลเซิร์ฟเวอร์ และงบต่ำ → เลือกสถาปัตยกรรม **Serverless บน Google**

| ส่วน | เทคโนโลยี | เหตุผล |
|------|-----------|--------|
| Frontend (แอปพนักงาน) | **PWA** = HTML+CSS+JS ล้วน (ติดตั้งลงจอมือถือได้) | ไม่ต้องขึ้น App Store / Play Store, อัปเดตทันที, ทำงานบนทุกมือถือ |
| Frontend (คอนโซล HR) | หน้าเว็บ `hr.html` | HR เปิดบนคอม/มือถือเพื่อจัดการคิวซ่อม |
| Backend / API | **Google Apps Script** (Web App) | ฟรี, ไม่ต้องมีเซิร์ฟเวอร์, เข้าถึง Google Sheets ได้โดยตรง |
| ฐานข้อมูล | **Google Sheets** | ตามโจทย์, HR แก้ไขเองได้, import จาก Excel เดิมได้ทันที |
| ไฟล์รูป | **Google Drive** (ผ่าน Apps Script) | รูปแนบเก็บใน Drive, เก็บลิงก์ใน Sheet |
| ติดตามสถานะ | **ในแอปโดยตรง** | พนักงานเปิดแอปดูสถานะงานซ่อมของตนเองได้ตลอด (ไม่มีการแจ้งเตือนภายนอก) |

**ข้อดีหลัก:** ต้นทุน ~0 บาท/เดือน (อยู่ใน free tier ของ Google), ไม่ต้อง deploy server,
HR ที่ไม่ใช่สาย IT ดูข้อมูลใน Sheet ได้เอง

---

## 2. แผนผังระบบ (System Diagram)

```
        ┌──────────────────────┐          ┌──────────────────────┐
        │   พนักงาน (มือถือ)     │          │       HR (เว็บ)        │
        │   PWA: app/index.html │          │   app/hr.html         │
        └──────────┬───────────┘          └──────────┬───────────┘
                   │ HTTPS (JSON)                     │ HTTPS (JSON)
                   ▼                                  ▼
        ┌───────────────────────────────────────────────────────────┐
        │              Google Apps Script  (Web App /exec)            │
        │   doPost(): login, setPin, submitRepair, myTickets,         │
        │             rateTicket, hrList, hrUpdate                     │
        └─────────────────────┬───────────────────┬──────────────────┘
                              │                   │
                              ▼                   ▼
                       ┌────────────┐      ┌────────────┐
                       │Google Sheet│      │Google Drive│
                       │ (ฐานข้อมูล) │      │  (รูปแนบ)   │
                       └────────────┘      └────────────┘
```

---

## 3. Data Model — โครงสร้าง Google Sheets

ไฟล์ Sheet เดียว มี 4 แท็บ (tabs):

### 3.1 แท็บ `Employees` (import จาก Excel เดิม)
| คอลัมน์ | ตัวอย่าง | หมายเหตุ |
|--------|---------|---------|
| A `no` | 1 | ลำดับ |
| B `empCode` | 19474 | รหัสพนักงาน (ใช้ login) |
| C `name` | นาย อภิโชติ ศรัทธาพิทักษ์ | ชื่อ-สกุล |
| D `dept` | ผู้จัดการไร่ชุมชน 2 | สังกัด |
| E `zone` | บ้านพักโนนสัน | จุดบ้านพัก |
| F `room` | NSA2 | เลขที่ห้อง |
| G `pinHash` | (ว่างตอน import) | SHA-256 ของ PIN (ตั้งครั้งแรก) |
| H `phone` | 08x-xxx-xxxx | เบอร์ (กรอกตอนแจ้งครั้งแรก) |
| I `lineUserId` | *(ไม่ใช้แล้ว)* | เว้นว่างไว้ (สงวนไว้เผื่ออนาคต) |

> **สำคัญ:** Excel เดิม *ไม่มี* PIN → พนักงาน "ตั้ง PIN เอง" ตอน login ครั้งแรก (เก็บเป็น hash ไม่เก็บ PIN ดิบ)

### 3.2 แท็บ `Tickets` (งานแจ้งซ่อม)
| คอลัมน์ | ตัวอย่าง |
|--------|---------|
| A `ticketId` | TK-20260821-001 |
| B `createdAt` | 2026-08-21 09:30 |
| C `empCode` | 19474 |
| D `name` / E `dept` / F `zone` / G `room` | (คัดลอกไว้ตอนแจ้ง) |
| H `phone` | 08x-xxx-xxxx |
| I `category` | ไฟฟ้า |
| J `detail` | หลอดไฟห้องน้ำเสีย |
| K `photos` | url1, url2 (ลิงก์ Drive) |
| L `status` | รอดำเนินการ / กำลังดำเนินการ / ดำเนินการแล้วเสร็จ |
| M `appointDate` | 2026-08-23 |
| N `appointTime` | 10:00 |
| O `hrNote` | เปลี่ยนหลอด LED |
| P `assignRound` | รอบ 1 / รอบ 2 |
| Q `doneAt` | 2026-08-23 11:00 |
| R `ratingScore` | 5 |
| S `ratingComment` | ซ่อมเร็วดี |
| T `urgency` | ปกติ / เร่งด่วน / ฉุกเฉิน |
| U `symptoms` | หลอดไฟไม่ติด, ปลั๊กไฟใช้ไม่ได้ (อาการที่กดเลือก) |

### 3.3 แท็บ `Config` (ตั้งค่า key ต่างๆ — ไม่ hardcode ในโค้ด)
| key | value |
|-----|-------|
| HR_KEY | รหัสลับสำหรับ HR login (เช่น hr2026xyz) |
| DRIVE_FOLDER_ID | โฟลเดอร์เก็บรูป (เว้นว่างได้ = เก็บที่ root) |

> เก็บ secret ใน Config sheet **หรือ** Script Properties (ปลอดภัยกว่า) — โค้ดรองรับทั้งสองแบบ

### 3.4 แท็บ `Log` (audit / debug) — บันทึกทุก request

---

## 4. Flow หลัก (ตาม Step ในโจทย์)

### 4.1 Login (Home)
1. เปิดแอป → กรอก **รหัสพนักงาน** + **PIN ส่วนตัว**
2. Backend ตรวจ `empCode` ใน Employees
   - ถ้ายังไม่มี `pinHash` → หน้า "ตั้ง PIN ครั้งแรก" (ยืนยัน 2 ครั้ง) → บันทึก hash
   - ถ้ามีแล้ว → ตรวจ hash ตรง → ออก session token (เก็บใน localStorage)
3. เด้งข้อมูลบ้านพักตนเอง: ชื่อ, สังกัด, จุดบ้านพัก, เลขห้อง

### 4.2 แจ้งซ่อม
1. เลือก **หมวดงานซ่อม** (ไฟฟ้า/ประปา/แอร์/ประตู-หน้าต่าง/หลังคา/ห้องน้ำ/เฟอร์นิเจอร์/เน็ต-WiFi/อื่นๆ)
2. **กดเลือกอาการที่พบ** (chips เลือกได้หลายข้อ ตามหมวด) + **ระดับความเร่งด่วน** (ปกติ/เร่งด่วน/ฉุกเฉิน)
3. กรอก **รายละเอียดเพิ่มเติม (ถ้ามี)** + **เบอร์โทร** + **แนบรูป** (ย่อขนาดฝั่ง client แล้วส่ง base64)
4. กด **ส่ง** → สร้าง ticket, อัปโหลดรูปเข้า Drive, กำหนด `assignRound` อัตโนมัติตามวันในสัปดาห์

### 4.3 HR จัดการ
1. HR เปิด `hr.html` (หรือดูใน Sheet โดยตรง) — งานเร่งด่วน/ยังไม่เสร็จเรียงขึ้นก่อน
2. เลือก **สถานะ** (รอ/กำลังทำ/เสร็จ), ระบุ **วันนัด+เวลา**, **หมายเหตุวิธีซ่อม/ระยะเวลา** → บันทึก
3. สถานะที่อัปเดตจะสะท้อนในแอปพนักงานทันทีที่เปิดดู

### 4.4 ติดตามสถานะ + ให้คะแนน
1. พนักงานเปิดแอป → แท็บ "งานซ่อม" → เห็นสถานะล่าสุดของทุกใบงาน
2. เมื่อสถานะเป็น **"ดำเนินการแล้วเสร็จ"** → แตะใบงาน → ให้ดาว 1–5 + คอมเมนต์
3. บันทึกลง Tickets (`ratingScore`, `ratingComment`)

### 4.5 กติกา "รอบซ่อม" (จากไฟล์ Word) — ใช้ตั้ง `assignRound` อัตโนมัติ
- **รอบ 1:** แจ้ง อังคาร–พุธ–พฤหัส → ส่งช่าง, กำหนดซ่อมภายในศุกร์
- **รอบ 2:** แจ้ง ศุกร์–เสาร์–จันทร์ → ส่งช่าง, กำหนดซ่อมอังคาร

---

## 5. API Contract (Frontend ↔ Apps Script)

ทุก request เป็น `POST` ไป `…/exec` body JSON `{ action, ...payload }` ตอบ `{ ok, data|error }`

| action | payload | ตอบกลับ |
|--------|---------|--------|
| `login` | empCode, pin | {needSetPin} หรือ {token, profile} |
| `setPin` | empCode, pin | {token, profile} |
| `submitRepair` | token, category, urgency, symptoms[], detail, phone, photos[] (base64) | {ticketId} |
| `myTickets` | token | {tickets[]} |
| `rateTicket` | token, ticketId, score, comment | {ok} |
| `hrList` | hrKey, filter | {tickets[]} |
| `hrUpdate` | hrKey, ticketId, status, appointDate, appointTime, hrNote | {ok} |

---

## 6. ความปลอดภัย

- PIN เก็บเป็น **SHA-256 hash + salt** ไม่เก็บ PIN ดิบ
- Token = hash(empCode + secret + วันหมดอายุ) เก็บ localStorage, มีวันหมดอายุ
- HR API ป้องกันด้วย `hrKey` แยกต่างหาก
- Secret ทั้งหมดอยู่ใน Script Properties / Config sheet — ไม่ commit ลงโค้ด
- Apps Script deploy แบบ "Anyone" แต่ทุก action ตรวจ token/สิทธิ์เอง

---

## 7. โครงไฟล์โปรเจกต์

```
Easy Fix/
├─ docs/
│  ├─ ARCHITECTURE.md      ← ไฟล์นี้
│  └─ SETUP.md             ← คู่มือติดตั้งทีละขั้น
├─ backend/
│  ├─ Code.gs              ← Google Apps Script (REST API)
│  └─ appsscript.json      ← manifest
├─ app/
│  ├─ index.html           ← แอปพนักงาน (PWA)
│  ├─ hr.html              ← คอนโซล HR
│  ├─ manifest.webmanifest ← ให้ติดตั้งลงจอมือถือได้
│  └─ sw.js                ← service worker (ออฟไลน์/ติดตั้ง)
└─ (ไฟล์ Excel/Word เดิม)
```
