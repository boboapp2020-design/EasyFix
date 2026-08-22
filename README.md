# 🔧 Easy Fix — ระบบแจ้งซ่อมบ้านพักพนักงาน

แอปมือถือแจ้งซ่อมบ้านพักพนักงาน ผูกข้อมูลกับ Google Sheets · ติดตามสถานะผ่านแอป

## ฟีเจอร์
- 📱 **แอปพนักงาน (PWA)** — login ด้วยรหัสพนักงาน + PIN ส่วนตัว → เห็นข้อมูลบ้านพักตนเอง
- ➕ **แจ้งซ่อม** — เลือกหมวดงาน → กดเลือกอาการที่พบ → ระดับความเร่งด่วน → แนบรูป (สูงสุด 5) → กดส่ง
- 📊 **ติดตามสถานะในแอป** — ดูงานซ่อมทั้งหมดของตนเอง + สถานะล่าสุด (รอ/กำลังทำ/เสร็จ)
- 🛠️ **คอนโซล HR** — ดูคิว, ตั้งสถานะ/วันนัด/หมายเหตุ, เรียงงานเร่งด่วนขึ้นก่อน, กำหนดรอบซ่อมอัตโนมัติ
- ✅ **ให้คะแนน ⭐** — เมื่องานเสร็จ พนักงานให้คะแนนความพึงพอใจในแอป

## สถาปัตยกรรม
```
พนักงาน(PWA) ─┐
              ├─→ Google Apps Script ─→ Google Sheets (ฐานข้อมูล)
HR(เว็บ) ─────┘                        └→ Google Drive (รูปแนบ)
```
รายละเอียด: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## เริ่มใช้งาน
1. ทดลองก่อน (โหมด DEMO ไม่ต้องตั้งค่าอะไร): เปิด `app/index.html` — login ด้วย **19474** หรือ **19452** (PIN อะไรก็ได้)
2. ใช้งานจริง: ทำตาม [docs/SETUP.md](docs/SETUP.md) — ตั้ง Google Sheets + Apps Script + LINE + Groq

## โครงไฟล์
```
Easy Fix/
├─ app/           แอปมือถือ + คอนโซล HR (deploy โฟลเดอร์นี้)
│  ├─ index.html  แอปพนักงาน (PWA)
│  ├─ manifest.webmanifest · sw.js
├─ backend/
│  ├─ Code.gs     Google Apps Script (คัดลอกไปวางใน Apps Script)
│  └─ appsscript.json
└─ docs/          ARCHITECTURE.md · SETUP.md
```

## ต้นทุน
~0 บาท/เดือน — อยู่ใน free tier ของ Google Apps Script + Google Sheets/Drive
