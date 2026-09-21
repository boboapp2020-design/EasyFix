/**
 * Easy Fix — ระบบแจ้งซ่อมบ้านพักพนักงาน
 * Google Apps Script backend: REST API (Google Sheets + Drive)
 *
 * 2 โหมด: พนักงาน (user) / ผู้ดูแลงานซ่อม (admin)
 *
 * Flow:
 *  1. user แจ้งซ่อม                     → สถานะ "รอตรวจสอบ"  (แจ้งเตือน admin)
 *  2. admin รับเรื่อง + ระบุระยะเวลา     → "รับเรื่องแล้ว"     (แจ้งเตือน user)
 *     หรือ admin ปฏิเสธ + เหตุผล        → "ไม่สามารถดำเนินการได้"
 *  3. admin อัปเดต %งาน / รายละเอียด     → "กำลังดำเนินการ"   (บันทึก timeline ทุกครั้ง)
 *  4. admin ปิดงาน                       → "รอตรวจรับ"        (แจ้งเตือน user)
 *  5. user กดรับงาน + ตรวจสอบ            → "ตรวจรับแล้ว"
 *  6. user ให้คะแนนดาว                   → "เสร็จสมบูรณ์"
 *
 * Deploy: Deploy > New deployment > Web app
 *   - Execute as: Me   ·   Who has access: Anyone
 */

// ====================== CONFIG ======================
var SALT = 'easyfix-2026-salt';           // เปลี่ยนเป็นค่าลับของคุณ
var DEFAULT_PIN = '1234';                 // PIN กลาง (ใช้ได้ตราบใดที่ยังไม่ตั้ง PIN ส่วนตัว)
var TOKEN_TTL_DAYS = 30;
var TZ = 'Asia/Bangkok';

/* ====================== สิทธิ์แจ้งซ่อมตามประเภทบ้านพัก ======================
 * เก็บในแท็บ "Rights": แถวแรก = ['category','sub', ชื่อประเภทบ้านพัก...]
 *   - แถวที่ sub ว่าง  = สิทธิ์ระดับหมวด (1=เห็น/แจ้งได้, 0=ซ่อน)
 *   - แถวที่มี sub    = สิทธิ์รายการซ่อมย่อยในหมวดนั้น
 * แอดมินแก้ได้จากในแอป (หน้า "สิทธิ์") มีผลทันที — ถ้ายังไม่มีแท็บ ระบบสร้างให้จาก DEFAULT_RIGHTS
 */
var DEFAULT_RIGHTS = {
  zones: ["บ้านพักพนักงานรายวัน","บ้านพักพนักงานรายเดือน","บ้านพักพนักงานหัวหน้าแผนก","บ้านพักโนนสัน"],
  cat: {
    "ไฟฟ้า": { allow:[1,1,1,1], subs: {
      "หลอดไฟไม่ติด": [1,1,1,1],
      "หลอดไฟกะพริบ": [1,1,1,1],
      "ปลั๊กไฟใช้ไม่ได้": [1,1,1,1],
      "สวิตช์ไฟเสีย": [1,1,1,1],
      "เบรกเกอร์ตัดบ่อย": [1,1,1,1],
      "ไฟตก/ไฟกระพริบทั้งห้อง": [1,1,1,1],
      "ไฟรั่ว/ไฟช็อต": [1,1,1,1],
      "สายไฟชำรุด": [0,0,0,0],
      "ไม่มีไฟทั้งห้อง": [0,0,0,0],
      "พัดลมเพดานเสีย": [0,1,1,1],
      "กริ่ง/ออดไม่ดัง": [0,0,0,0],
      "ต้องการติดตั้งปลั๊ก/ไฟเพิ่ม": [0,0,0,0],
    }},
    "ประปา": { allow:[1,1,1,1], subs: {
      "ก๊อกน้ำรั่ว/หยด": [1,1,1,1],
      "น้ำไม่ไหล": [0,0,0,1],
      "น้ำไหลอ่อน": [0,0,0,0],
      "ท่อน้ำรั่ว/แตก": [1,1,1,1],
      "ท่อระบายตัน": [0,1,1,1],
      "น้ำรั่วซึมพื้น/ผนัง": [0,0,0,0],
      "ปั๊มน้ำไม่ทำงาน": [0,0,0,0],
      "น้ำขุ่น/มีกลิ่น": [0,0,0,0],
      "ถังเก็บน้ำรั่ว/ลูกลอยเสีย": [0,0,0,0],
      "มิเตอร์น้ำผิดปกติ": [0,0,0,0],
      "วาล์ว/สต๊อปวาล์วเสีย": [0,0,0,0],
    }},
    "เครื่องปรับอากาศ": { allow:[0,0,1,1], subs: {
      "แอร์ไม่เย็น": [0,0,1,1],
      "แอร์มีน้ำหยด": [0,0,1,1],
      "แอร์เปิดไม่ติด": [0,0,1,1],
      "แอร์มีเสียงดัง": [0,0,1,1],
      "แอร์มีกลิ่นเหม็น": [0,0,0,0],
      "รีโมทเสีย": [0,0,0,0],
      "ถึงรอบล้างแอร์": [0,0,0,0],
      "แอร์เปิด-ปิดเอง": [0,0,0,0],
      "น้ำแข็งเกาะคอยล์": [0,0,0,0],
      "คอมเพรสเซอร์เสียงดัง": [0,0,0,0],
    }},
    "ประตู/หน้าต่าง": { allow:[1,1,1,1], subs: {
      "ประตูปิดไม่สนิท": [1,1,1,1],
      "ลูกบิด/กลอนเสีย": [1,1,1,1],
      "กุญแจเสีย/ค้าง": [0,0,0,0],
      "บานพับหลวม/หลุด": [0,0,0,0],
      "กระจกแตก/ร้าว": [0,0,0,0],
      "มุ้งลวดขาด": [0,0,0,0],
      "หน้าต่างเปิด-ปิดไม่ได้": [0,0,0,0],
      "ประตูบานเลื่อนฝืด": [0,0,0,0],
      "โช้คอัพประตูเสีย": [0,0,0,0],
      "วงกบผุ/ชำรุด": [0,0,0,0],
    }},
    "หลังคา": { allow:[0,0,0,0], subs: {
      "หลังคารั่ว/น้ำหยด": [0,0,0,0],
      "ฝ้าเพดานบวมน้ำ": [0,0,0,0],
      "ฝ้าเพดานหลุด/ทะลุ": [0,0,0,0],
      "กระเบื้องหลังคาแตก": [0,0,0,0],
      "รางน้ำอุดตัน/รั่ว": [0,0,0,0],
      "นก/สัตว์ทำรังบนฝ้า": [0,0,0,0],
      "ฉนวนกันความร้อนหลุด": [0,0,0,0],
    }},
    "ห้องน้ำ": { allow:[0,1,1,1], subs: {
      "ชักโครกตัน/กดไม่ลง": [0,1,1,1],
      "ชักโครกน้ำไหลตลอด": [0,1,1,1],
      "ฝักบัว/สายชำระเสีย": [0,1,1,1],
      "อ่างล้างหน้าตัน": [0,1,1,1],
      "ก๊อกอ่างล้างหน้ารั่ว": [0,1,1,1],
      "พื้น/ผนังกระเบื้องหลุด": [0,1,1,1],
      "น้ำรั่วซึม": [0,1,1,1],
      "กลิ่นเหม็นจากท่อ": [0,1,1,1],
    }},
    "เฟอร์นิเจอร์": { allow:[0,0,0,0], subs: {
      "เตียง/ที่นอนชำรุด": [0,0,0,0],
      "ตู้/ลิ้นชักเสีย": [0,0,0,0],
      "โต๊ะ/เก้าอี้ชำรุด": [0,0,0,0],
      "ชั้นวางหลุด/หัก": [0,0,0,0],
      "บานประตูตู้เสีย": [0,0,0,0],
      "บานพับ/มือจับหลุด": [0,0,0,0],
      "ล้อเลื่อนชำรุด": [0,0,0,0],
      "ต้องการเฟอร์นิเจอร์เพิ่ม": [0,0,0,0],
    }},
    "อินเทอร์เน็ต/WiFi": { allow:[0,0,0,0], subs: {
      "เน็ตใช้ไม่ได้": [0,0,0,0],
      "เชื่อมต่อ WiFi ไม่ได้": [0,0,0,0],
      "เน็ตช้า": [0,0,0,0],
      "สัญญาณอ่อน/หลุดบ่อย": [0,0,0,0],
      "เราเตอร์ไฟไม่ติด": [0,0,0,0],
      "ต้องการตั้งค่า/เปลี่ยนรหัส WiFi": [0,0,0,0],
      "สายแลน/หัวต่อชำรุด": [0,0,0,0],
    }},
    "งานก่อสร้าง": { allow:[0,0,0,0], subs: {
      "ผนังแตกร้าว": [0,0,0,0],
      "ปูน/ฉาบหลุดร่อน": [0,0,0,0],
      "พื้นทรุด/แตก": [0,0,0,0],
      "เพดานรั่ว/ร้าว": [0,0,0,0],
      "บันได/ราวจับชำรุด": [0,0,0,0],
      "ต่อเติม/ซ่อมโครงสร้าง": [0,0,0,0],
    }},
    "งานทาสี": { allow:[0,0,0,0], subs: {
      "สีลอก/ซีดจาง": [0,0,0,0],
      "ผนังมีรอยเปื้อน": [0,0,0,0],
      "ต้องการทาสีใหม่": [0,0,0,0],
      "เชื้อรา/คราบดำบนผนัง": [0,0,0,0],
      "ประตู/วงกบสีลอก": [0,0,0,0],
      "ทำกันซึมผนัง": [0,0,0,0],
    }},
    "งานทำความสะอาด": { allow:[0,0,0,0], subs: {
      "ท่อ/รางระบายอุดตัน": [0,0,0,0],
      "ทำความสะอาดทั่วไป": [0,0,0,0],
      "กำจัดสิ่งอุดตัน": [0,0,0,0],
      "คราบสกปรกฝังแน่น": [0,0,0,0],
      "กำจัดหยากไย่/ฝุ่น": [0,0,0,0],
      "ล้างแอร์/พัดลม": [0,0,0,0],
      "ตัดหญ้า/ดูแลรอบบ้าน": [0,0,0,0],
    }},
    "อื่นๆ": { allow:[1,1,1,1], subs: {
      "ปลวก/แมลง/สัตว์รบกวน": [0,0,0,0],
      "กลิ่นอับ/ความชื้น": [0,0,0,0],
      "เปลี่ยนหลอด/อุปกรณ์ทั่วไป": [0,0,0,0],
      "ติดตั้งอุปกรณ์เพิ่ม": [0,0,0,0],
      "ย้าย/จัดวางเฟอร์นิเจอร์": [0,0,0,0],
      "กุญแจ/ระบบล็อก": [0,0,0,0],
      "งานเบ็ดเตล็ด": [0,0,0,0],
    }},
  }
};
function rightsSheet() {
  var s = ss(), sh = s.getSheetByName('Rights');
  if (!sh) { sh = s.insertSheet('Rights'); writeRights(sh, DEFAULT_RIGHTS); }
  return sh;
}
function normFlags(a, n) { var out = []; for (var i = 0; i < n; i++) out.push((a && Number(a[i])) ? 1 : 0); return out; }
function readRights() {
  try { var c = CacheService.getScriptCache().get('rights'); if (c) return JSON.parse(c); } catch (e) {}
  var sh = rightsSheet(), d = sh.getDataRange().getValues();
  if (d.length < 1 || d[0].length < 3) { writeRights(sh, DEFAULT_RIGHTS); d = sh.getDataRange().getValues(); }
  var zones = d[0].slice(2).map(function (z) { return String(z).trim(); }).filter(Boolean), nz = zones.length;
  var cat = {}, order = [];
  for (var i = 1; i < d.length; i++) {
    var c = String(d[i][0]).trim(); if (!c) continue;
    var sub = String(d[i][1]).trim(), flags = normFlags(d[i].slice(2), nz);
    if (!cat[c]) { cat[c] = { allow: normFlags([], nz), subs: {} }; order.push(c); }
    if (!sub) cat[c].allow = flags; else cat[c].subs[sub] = flags;
  }
  var R = { zones: zones, order: order, cat: cat };
  try { CacheService.getScriptCache().put('rights', JSON.stringify(R), 300); } catch (e) {}
  return R;
}
function writeRights(sh, R) {
  var zones = (R.zones || []).map(function (z) { return String(z).trim(); }).filter(Boolean), nz = zones.length;
  var rows = [['category', 'sub'].concat(zones)];
  (R.order || Object.keys(R.cat || {})).forEach(function (c) {
    var o = (R.cat || {})[c]; if (!o) return;
    rows.push([c, ''].concat(normFlags(o.allow, nz)));
    Object.keys(o.subs || {}).forEach(function (s) { if (String(s).trim()) rows.push([c, s].concat(normFlags(o.subs[s], nz))); });
  });
  sh.clearContents();
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  try { CacheService.getScriptCache().remove('rights'); } catch (e) {}
}
/** ทุกคนอ่านได้ (ใช้ซ่อนหมวด/รายการที่ไม่มีสิทธิ์ในหน้าแจ้งซ่อม) */
function apiGetRights(req) { return { ok: true, data: { rights: readRights() } }; }
/** แอดมิน: บันทึกสิทธิ์ทั้งชุด (เพิ่ม/ลด หมวด, รายการซ่อม, ประเภทบ้านพัก) */
function apiAdminSaveRights(req) {
  var t = requireAdmin(req); if (!t) return { ok: false, error: 'ไม่มีสิทธิ์' };
  var R = req.rights;
  if (!R || !R.zones || !R.zones.length || !R.cat) return { ok: false, error: 'ข้อมูลสิทธิ์ไม่ถูกต้อง' };
  var clean = { zones: [], order: [], cat: {} }, seen = {};
  R.zones.forEach(function (z) { z = String(z || '').trim(); if (z && !seen[z]) { seen[z] = 1; clean.zones.push(z); } });
  if (!clean.zones.length) return { ok: false, error: 'ต้องมีประเภทบ้านพักอย่างน้อย 1 ประเภท' };
  (R.order || Object.keys(R.cat)).forEach(function (c) {
    c = String(c || '').trim(); var o = R.cat[c]; if (!c || !o || clean.cat[c]) return;
    var subs = {};
    Object.keys(o.subs || {}).forEach(function (s) { s = String(s).trim(); if (s) subs[s] = normFlags(o.subs[s], clean.zones.length); });
    clean.cat[c] = { allow: normFlags(o.allow, clean.zones.length), subs: subs }; clean.order.push(c);
  });
  if (!clean.order.length) return { ok: false, error: 'ต้องมีหมวดอย่างน้อย 1 หมวด' };
  writeRights(rightsSheet(), clean);
  log('rights-saved', t.code + ' zones=' + clean.zones.length + ' cats=' + clean.order.length);
  return { ok: true, data: { rights: readRights() } };
}

var ST = {
  NEW:      'รอตรวจสอบ',
  ACCEPTED: 'รับเรื่องแล้ว',
  WORKING:  'กำลังดำเนินการ',
  REVIEW:   'รอตรวจรับ',
  RECEIVED: 'ตรวจรับแล้ว',
  DONE:     'เสร็จสมบูรณ์',
  REJECT:   'ไม่สามารถดำเนินการได้'
};

function cfg(key) {
  var p = PropertiesService.getScriptProperties().getProperty(key);
  if (p) return p;
  var sh = ss().getSheetByName('Config');
  if (!sh) return '';
  var v = sh.getDataRange().getValues();
  for (var i = 0; i < v.length; i++) if (String(v[i][0]).trim() === key) return String(v[i][1]).trim();
  return '';
}
function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }
function setCfg(key, val) {
  var sh = ss().getSheetByName('Config'); if (!sh) return;
  var v = sh.getDataRange().getValues();
  for (var i = 0; i < v.length; i++) if (String(v[i][0]).trim() === key) { sh.getRange(i + 1, 2).setValue(val); return; }
  sh.appendRow([key, val]);
}
var APP_LINK = 'https://boboapp2020-design.github.io/EasyFix/';

// ====================== ROUTER ======================
function doPost(e) {
  try {
    var req = safeJson(e.postData ? e.postData.contents : '') || {};
    if (req.events) { handleLineWebhook(req); return json({ ok: true }); }   // LINE webhook
    return json(route(req.action, req));
  } catch (err) {
    log('doPost-error', String(err));
    return json({ ok: false, error: String(err) });
  }
}

// ====================== LINE แจ้งเตือน ======================
function lineCall(endpoint, payload) {
  var token = cfg('LINE_TOKEN'); if (!token) return;
  UrlFetchApp.fetch('https://api.line.me/v2/bot/' + endpoint, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify(payload)
  });
}
function lineReply(replyToken, text) { lineCall('message/reply', { replyToken: replyToken, messages: [{ type: 'text', text: text }] }); }
function linePush(to, text) { if (to) lineCall('message/push', { to: to, messages: [{ type: 'text', text: text }] }); }

/** webhook: พิมพ์ "รับแจ้งเตือน" ในแชท/กลุ่มที่มีบอท → ลงทะเบียนแชทนั้นเป็นผู้รับแจ้งเตือน */
function handleLineWebhook(req) {
  (req.events || []).forEach(function (ev) {
    try {
      var src = ev.source || {};
      var chatId = src.groupId || src.roomId || src.userId;
      if (ev.type === 'message' && ev.message && ev.message.type === 'text') {
        var txt = String(ev.message.text || '').trim();
        if (txt === 'รับแจ้งเตือน' || txt.toLowerCase() === 'subscribe') {
          setCfg('LINE_TARGET_ID', chatId);
          lineReply(ev.replyToken, '✅ ลงทะเบียนแล้ว! แชทนี้จะได้รับแจ้งเตือนเมื่อมีงานแจ้งซ่อมใหม่');
        }
      } else if (ev.type === 'follow' || ev.type === 'join') {
        lineReply(ev.replyToken, 'สวัสดีครับ 🔧 Easy Fix\nพิมพ์ "รับแจ้งเตือน" เพื่อให้แชทนี้รับแจ้งเตือนงานซ่อมใหม่');
      }
    } catch (err) { log('line-webhook-error', String(err)); }
  });
}

/** push แจ้งงานใหม่เข้าแชทที่ลงทะเบียนไว้ */
function notifyLineNewTicket(t) {
  try {
    var target = cfg('LINE_TARGET_ID'); if (!target || !cfg('LINE_TOKEN')) return;
    var ugIc = { 'ปกติ': '🟢', 'เร่งด่วน': '🟡', 'ด่วนมาก': '🔴' }[t.urgency] || '';
    var head = (t.urgency === 'ด่วนมาก') ? '🚨 แจ้งซ่อมด่วนมาก!' : '🔔 มีแจ้งซ่อมใหม่';
    linePush(target,
      head + ' ' + t.ticketId +
      '\n👤 ' + t.name + '\n🏠 ' + t.zone + ' ห้อง ' + t.room +
      '\n🔧 ' + t.category + ' ' + ugIc + ' ' + t.urgency +
      '\n📝 ' + t.detail +
      (t.phone ? '\n📞 ' + t.phone : '') +
      '\n\nเปิดแอป: ' + APP_LINK);
  } catch (err) { log('line-push-error', String(err)); }
}
function doGet(e) { return json({ ok: true, service: 'EasyFix', time: nowStr() }); }

function route(action, req) {
  switch (action) {
    // --- ทั่วไป ---
    case 'login':        return apiLogin(req);
    // --- พนักงาน ---
    case 'submitRepair': return apiSubmitRepair(req);
    case 'myTickets':    return apiMyTickets(req);
    case 'ticketDetail': return apiTicketDetail(req);
    case 'userAccept':   return apiUserAccept(req);
    case 'rateTicket':   return apiRateTicket(req);
    case 'changePin':    return apiChangePin(req);
    // --- แอดมิน ---
    case 'adminList':    return apiAdminList(req);
    case 'adminAccept':  return apiAdminAccept(req);
    case 'adminReject':  return apiAdminReject(req);
    case 'adminUpdate':  return apiAdminUpdate(req);
    case 'adminClose':   return apiAdminClose(req);
    case 'adminSearchEmp': return apiAdminSearchEmp(req);
    case 'adminUpdateEmp': return apiAdminUpdateEmp(req);
    case 'adminResetPin':  return apiAdminResetPin(req);
    case 'adminAddEmp':    return apiAdminAddEmp(req);
    case 'adminDeleteEmp': return apiAdminDeleteEmp(req);
    // --- สิทธิ์แผนก ---
    case 'getRights':       return apiGetRights(req);
    case 'adminSaveRights': return apiAdminSaveRights(req);
    default:             return { ok: false, error: 'unknown action: ' + action };
  }
}

// ====================== AUTH ======================
function sha256(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function makeToken(code, role) {
  var exp = Date.now() + TOKEN_TTL_DAYS * 864e5;
  return code + '|' + role + '|' + exp + '|' + sha256(code + role + exp + SALT);
}
/** คืน {code, role} หรือ null */
function checkToken(token) {
  if (!token) return null;
  var p = String(token).split('|');
  if (p.length !== 4) return null;
  var code = p[0], role = p[1], exp = Number(p[2]);
  if (Date.now() > exp) return null;
  if (sha256(code + role + exp + SALT) !== p[3]) return null;
  return { code: code, role: role };
}
function requireUser(req) { var t = checkToken(req.token); return (t && t.role === 'user') ? t : null; }
function requireAdmin(req) { var t = checkToken(req.token); return (t && t.role === 'admin') ? t : null; }

/** แท็บข้อมูลพนักงาน — หาเองไม่ว่าจะชื่อ Employees หรือ Sheet1 (กรณียังไม่เปลี่ยนชื่อ) */
function empSheet() {
  var s = ss();
  var e = s.getSheetByName('Employees');
  if (e && e.getLastRow() > 1) return e;
  var skip = ['Tickets','TicketLog','Config','Log','Admins','Rights'];
  var sheets = s.getSheets();
  for (var i = 0; i < sheets.length; i++)
    if (skip.indexOf(sheets[i].getName()) < 0 && sheets[i].getLastRow() > 1) return sheets[i];
  return e || sheets[0];
}
/** หาแถวพนักงานจากรหัส (คอลัมน์ B) */
function findEmpRow(empCode) {
  var data = empSheet().getDataRange().getValues();
  for (var i = 1; i < data.length; i++)
    if (String(data[i][1]).trim() === String(empCode).trim()) return { rowIndex: i + 1, row: data[i] };
  return null;
}
/** หาแถวแอดมินจากรหัส */
function findAdminRow(code) {
  var sh = ss().getSheetByName('Admins');
  if (!sh) return null;
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++)
    if (String(data[i][0]).trim() === String(code).trim()) return { rowIndex: i + 1, row: data[i] };
  return null;
}
function empProfile(row) {
  return { empCode: String(row[1]), name: row[2], dept: row[3], zone: row[4], room: row[5], phone: row[7] || '',
           blockedCats: String(row[9] || ''), role: 'user' };   // J = หมวดที่ห้ามแจ้ง (คั่นด้วย ,)
}

function apiLogin(req) {
  var pin = String(req.pin || '');

  // แยกบทบาทอัตโนมัติจากรหัส: ถ้ารหัสอยู่ในแท็บ Admins = ผู้ดูแล, ไม่งั้น = พนักงาน
  var ad = findAdminRow(req.empCode);              // Admins: A code, B name, C position, D pinHash
  if (ad) {
    var aHash = ad.row[3];
    if (!aHash) { if (pin !== DEFAULT_PIN) return { ok: false, error: 'PIN ไม่ถูกต้อง' }; }
    else if (sha256(pin + SALT) !== aHash) return { ok: false, error: 'PIN ไม่ถูกต้อง' };
    return { ok: true, data: { token: makeToken(String(req.empCode), 'admin'),
      profile: { empCode: String(ad.row[0]), name: ad.row[1], position: ad.row[2] || 'ผู้ดูแลงานซ่อม', role: 'admin' }, rights: readRights() } };
  }

  var emp = findEmpRow(req.empCode);
  if (!emp) return { ok: false, error: 'ไม่พบรหัสนี้ในระบบ' };
  var pinHash = emp.row[6];
  if (!pinHash) { if (pin !== DEFAULT_PIN) return { ok: false, error: 'PIN ไม่ถูกต้อง' }; }
  else if (sha256(pin + SALT) !== pinHash) return { ok: false, error: 'PIN ไม่ถูกต้อง' };
  return { ok: true, data: { token: makeToken(String(req.empCode), 'user'), profile: empProfile(emp.row), rights: readRights() } };
}

/** เปลี่ยน PIN (พนักงานหรือแอดมิน) */
function apiChangePin(req) {
  var t = checkToken(req.token);
  if (!t) return { ok: false, error: 'session หมดอายุ' };
  if (!req.newPin || String(req.newPin).length < 4) return { ok: false, error: 'PIN ใหม่ต้องมีอย่างน้อย 4 หลัก' };
  var oldPin = String(req.oldPin || '');
  if (t.role === 'admin') {
    var ad = findAdminRow(t.code); if (!ad) return { ok: false, error: 'ไม่พบผู้ใช้' };
    var h = ad.row[3];
    var ok = h ? (sha256(oldPin + SALT) === h) : (oldPin === DEFAULT_PIN);
    if (!ok) return { ok: false, error: 'PIN เดิมไม่ถูกต้อง' };
    ss().getSheetByName('Admins').getRange(ad.rowIndex, 4).setValue(sha256(req.newPin + SALT));
    return { ok: true, data: { ok: true } };
  }
  var emp = findEmpRow(t.code); if (!emp) return { ok: false, error: 'ไม่พบผู้ใช้' };
  var eh = emp.row[6];
  var ok2 = eh ? (sha256(oldPin + SALT) === eh) : (oldPin === DEFAULT_PIN);
  if (!ok2) return { ok: false, error: 'PIN เดิมไม่ถูกต้อง' };
  empSheet().getRange(emp.rowIndex, 7).setValue(sha256(req.newPin + SALT));
  return { ok: true, data: { ok: true } };
}

/** แอดมิน: ค้นหาพนักงาน (รหัส/ชื่อ) */
function apiAdminSearchEmp(req) {
  var t = requireAdmin(req); if (!t) return { ok: false, error: 'ไม่มีสิทธิ์' };
  var q = String(req.q || '').trim().toLowerCase();
  var data = empSheet().getDataRange().getValues(); var out = [];
  for (var i = 1; i < data.length && out.length < 40; i++) {
    var code = String(data[i][1]), name = String(data[i][2]);
    if (!code) continue;
    if (!q || code.toLowerCase().indexOf(q) >= 0 || name.toLowerCase().indexOf(q) >= 0)
      out.push({ empCode: code, name: name, dept: data[i][3], zone: data[i][4], room: data[i][5], phone: data[i][7] || '', hasPin: !!data[i][6], blockedCats: String(data[i][9] || '') });
  }
  return { ok: true, data: { employees: out } };
}

/** แอดมิน: แก้ไขข้อมูลพนักงาน (มีผลทันที) */
function apiAdminUpdateEmp(req) {
  var t = requireAdmin(req); if (!t) return { ok: false, error: 'ไม่มีสิทธิ์' };
  var emp = findEmpRow(req.empCode); if (!emp) return { ok: false, error: 'ไม่พบพนักงาน' };
  var sh = empSheet(), r = emp.rowIndex;
  if (req.name  !== undefined) sh.getRange(r, 3).setValue(req.name);
  if (req.dept  !== undefined) sh.getRange(r, 4).setValue(req.dept);
  if (req.zone  !== undefined) sh.getRange(r, 5).setValue(req.zone);
  if (req.room  !== undefined) sh.getRange(r, 6).setValue(req.room);
  if (req.phone !== undefined) sh.getRange(r, 8).setValue(req.phone);
  if (req.blockedCats !== undefined) sh.getRange(r, 10).setValue(req.blockedCats);   // J = หมวดที่ห้ามแจ้ง
  return { ok: true, data: { ok: true } };
}

/** แอดมิน: รีเซ็ต PIN พนักงานกลับเป็นค่าเริ่มต้น (1234) */
function apiAdminResetPin(req) {
  var t = requireAdmin(req); if (!t) return { ok: false, error: 'ไม่มีสิทธิ์' };
  var emp = findEmpRow(req.empCode); if (!emp) return { ok: false, error: 'ไม่พบพนักงาน' };
  empSheet().getRange(emp.rowIndex, 7).setValue('');
  return { ok: true, data: { ok: true } };
}

/** แอดมิน: เพิ่มพนักงานใหม่ */
function apiAdminAddEmp(req) {
  var t = requireAdmin(req); if (!t) return { ok: false, error: 'ไม่มีสิทธิ์' };
  var code = String(req.empCode || '').trim();
  if (!code) return { ok: false, error: 'กรุณากรอกรหัสพนักงาน' };
  if (findEmpRow(code)) return { ok: false, error: 'มีรหัสพนักงานนี้อยู่แล้ว' };
  if (findAdminRow(code)) return { ok: false, error: 'รหัสนี้ถูกใช้เป็นรหัสผู้ดูแลแล้ว' };
  var sh = empSheet();
  var no = sh.getLastRow();  // แถวถัดไป
  sh.appendRow([no, code, req.name || '', req.dept || '', req.zone || '', req.room || '', '', req.phone || '', '']);
  return { ok: true, data: { ok: true } };
}

/** แอดมิน: ลบพนักงาน */
function apiAdminDeleteEmp(req) {
  var t = requireAdmin(req); if (!t) return { ok: false, error: 'ไม่มีสิทธิ์' };
  var emp = findEmpRow(req.empCode); if (!emp) return { ok: false, error: 'ไม่พบพนักงาน' };
  empSheet().deleteRow(emp.rowIndex);
  return { ok: true, data: { ok: true } };
}

// ====================== TICKETS: helper ======================
/** คอลัมน์ Tickets (1-indexed) */
var C = {
  ticketId:1, createdAt:2, empCode:3, name:4, dept:5, zone:6, room:7, phone:8, category:9,
  detail:10, photos:11, status:12, appointDate:13, appointTime:14, hrNote:15, round:16,
  doneAt:17, ratingScore:18, ratingComment:19, urgency:20, symptoms:21,
  progress:22, adminNote:23, etaText:24, acceptedAt:25, closedAt:26, userAcceptedAt:27,
  unreadUser:28, unreadAdmin:29, adminName:30
};
/** แปลงค่า Date จากชีตเป็นข้อความอ่านง่าย */
function fdt(v) { return (v instanceof Date) ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm') : (v || ''); }   // วันที่+เวลา
function fdo(v) { return (v instanceof Date) ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : (v || ''); }         // วันที่อย่างเดียว
function fto(v) { return (v instanceof Date) ? Utilities.formatDate(v, TZ, 'HH:mm') : (v || ''); }              // เวลาอย่างเดียว
function rowToTicket(r) {
  return {
    ticketId:r[0], createdAt:fdt(r[1]), empCode:String(r[2]), name:r[3], dept:r[4], zone:r[5], room:r[6],
    phone:r[7], category:r[8], detail:r[9], photos:r[10], status:r[11]||ST.NEW,
    appointDate:fdo(r[12]), appointTime:fto(r[13]), hrNote:r[14], round:r[15], doneAt:fdt(r[16]),
    ratingScore:r[17], ratingComment:r[18], urgency:r[19]||'ปกติ', symptoms:r[20]||'',
    progress:Number(r[21]||0), adminNote:r[22]||'', etaText:r[23]||'',
    acceptedAt:fdt(r[24]), closedAt:fdt(r[25]), userAcceptedAt:fdt(r[26]),
    unreadUser:!!r[27], unreadAdmin:!!r[28], adminName:r[29]||''
  };
}
function ticketsSheet() { return ss().getSheetByName('Tickets'); }
function findTicket(ticketId) {
  var sh = ticketsSheet(), data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++)
    if (String(data[i][0]) === String(ticketId)) return { rowIndex: i + 1, row: data[i], sheet: sh };
  return null;
}
function setCell(rowIndex, col, val) { ticketsSheet().getRange(rowIndex, col).setValue(val); }

/** บันทึก timeline ทุกการเปลี่ยนแปลง */
function addLog(ticketId, by, byName, action, detail, progress, status) {
  var sh = ss().getSheetByName('TicketLog');
  if (!sh) return;
  sh.appendRow([nowStr(), ticketId, by, byName || '', action, detail || '', progress === '' ? '' : progress, status || '']);
}
function getLogs(ticketId) {
  var sh = ss().getSheetByName('TicketLog');
  if (!sh) return [];
  var d = sh.getDataRange().getValues(), out = [];
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][1]) === String(ticketId))
      out.push({ time:fdt(d[i][0]), by:d[i][2], byName:d[i][3], action:d[i][4], detail:d[i][5], progress:d[i][6], status:d[i][7] });
  }
  return out;
}

function assignRound(d) { var day = d.getDay(); return (day >= 2 && day <= 4) ? 'รอบ 1' : 'รอบ 2'; }
function newTicketId() {
  var today = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd'), count = 1;
  var data = ticketsSheet().getDataRange().getValues();
  for (var i = 1; i < data.length; i++) if (String(data[i][0]).indexOf('TK-' + today) === 0) count++;
  return 'TK-' + today + '-' + ('00' + count).slice(-3);
}
function savePhotos(photos, ticketId) {
  if (!photos || !photos.length) return '';
  var folderId = cfg('DRIVE_FOLDER_ID');
  var folder = folderId ? DriveApp.getFolderById(folderId) : DriveApp.getRootFolder();
  var urls = [];
  for (var i = 0; i < photos.length && i < 5; i++) {
    try {
      var m = String(photos[i]).match(/^data:(.+?);base64,(.*)$/);
      if (!m) continue;
      var f = folder.createFile(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], ticketId + '-' + (i + 1) + '.jpg'));
      f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      urls.push('https://drive.google.com/thumbnail?id=' + f.getId() + '&sz=w1200');   // แสดงใน <img> ได้เสมอ
    } catch (err) { log('photo-error', String(err)); }
  }
  return urls.join(' , ');
}

// ====================== พนักงาน (user) ======================
function apiSubmitRepair(req) {
  var t = requireUser(req);
  if (!t) return { ok: false, error: 'session หมดอายุ กรุณาเข้าสู่ระบบใหม่' };
  var emp = findEmpRow(t.code);
  if (!emp) return { ok: false, error: 'ไม่พบพนักงาน' };
  if (!req.detail) return { ok: false, error: 'กรุณากรอกรายละเอียด' };
  var blocked = String(emp.row[9] || '').split(',').map(function(s){return s.trim();}).filter(Boolean);
  if (blocked.indexOf(req.category) >= 0) return { ok: false, error: 'หมวด "' + req.category + '" ไม่เปิดให้แจ้งตามสิทธิ์ของคุณ' };
  var R = readRights(), zi = R.zones.indexOf(String(emp.row[4] || '').trim()), rc = R.cat[req.category];
  if (zi >= 0 && rc && req.category !== 'อื่นๆ' && !rc.allow[zi])
    return { ok: false, error: 'หมวด "' + req.category + '" ไม่เปิดให้แจ้งสำหรับ' + R.zones[zi] };

  var now = new Date(), ticketId = newTicketId(), p = empProfile(emp.row);
  var photoUrls = savePhotos(req.photos, ticketId);
  if (req.phone) empSheet().getRange(emp.rowIndex, 8).setValue(req.phone);

  ticketsSheet().appendRow([
    ticketId, nowStr(), p.empCode, p.name, p.dept, p.zone, p.room,
    req.phone || p.phone, req.category || 'อื่นๆ', req.detail, photoUrls,
    ST.NEW, '', '', '', assignRound(now), '', '', '',
    req.urgency || 'ปกติ', (req.symptoms || []).join(', '),
    0, '', '', '', '', '', '', true, ''      // progress..unreadAdmin=true
  ]);
  addLog(ticketId, 'user', p.name, 'แจ้งซ่อม', req.detail, 0, ST.NEW);
  notifyLineNewTicket({ ticketId: ticketId, name: p.name, zone: p.zone, room: p.room,
    category: req.category || 'อื่นๆ', urgency: req.urgency || 'ปกติ', detail: req.detail, phone: req.phone || p.phone });
  return { ok: true, data: { ticketId: ticketId } };
}

function apiMyTickets(req) {
  var t = requireUser(req);
  if (!t) return { ok: false, error: 'session หมดอายุ' };
  var data = ticketsSheet().getDataRange().getValues(), out = [];
  for (var i = 1; i < data.length; i++)
    if (String(data[i][2]) === String(t.code)) out.push(rowToTicket(data[i]));
  out.reverse();
  return { ok: true, data: { tickets: out, unread: out.filter(function (x) { return x.unreadUser; }).length } };
}

function apiTicketDetail(req) {
  var t = checkToken(req.token);
  if (!t) return { ok: false, error: 'session หมดอายุ' };
  var f = findTicket(req.ticketId);
  if (!f) return { ok: false, error: 'ไม่พบงานซ่อมนี้' };
  var tk = rowToTicket(f.row);
  if (t.role === 'user') {
    if (tk.empCode !== String(t.code)) return { ok: false, error: 'ไม่มีสิทธิ์' };
    if (tk.unreadUser) { setCell(f.rowIndex, C.unreadUser, false); tk.unreadUser = false; }   // อ่านแล้ว
  } else if (tk.unreadAdmin) { setCell(f.rowIndex, C.unreadAdmin, false); tk.unreadAdmin = false; }
  tk.logs = getLogs(req.ticketId);
  return { ok: true, data: { ticket: tk } };
}

/** user กดรับงาน (หลังแอดมินปิดงาน) */
function apiUserAccept(req) {
  var t = requireUser(req);
  if (!t) return { ok: false, error: 'session หมดอายุ' };
  var f = findTicket(req.ticketId);
  if (!f) return { ok: false, error: 'ไม่พบงานซ่อมนี้' };
  if (String(f.row[2]) !== String(t.code)) return { ok: false, error: 'ไม่มีสิทธิ์' };
  if (f.row[11] !== ST.REVIEW) return { ok: false, error: 'งานนี้ยังไม่พร้อมให้ตรวจรับ' };
  setCell(f.rowIndex, C.status, ST.RECEIVED);
  setCell(f.rowIndex, C.userAcceptedAt, nowStr());
  setCell(f.rowIndex, C.unreadUser, false);
  addLog(req.ticketId, 'user', f.row[3], 'ตรวจรับงาน', req.note || '', 100, ST.RECEIVED);
  return { ok: true, data: { ok: true } };
}

/** user ให้คะแนน → ปิดงานสมบูรณ์ */
function apiRateTicket(req) {
  var t = requireUser(req);
  if (!t) return { ok: false, error: 'session หมดอายุ' };
  var f = findTicket(req.ticketId);
  if (!f) return { ok: false, error: 'ไม่พบงานซ่อมนี้' };
  if (String(f.row[2]) !== String(t.code)) return { ok: false, error: 'ไม่มีสิทธิ์' };
  setCell(f.rowIndex, C.ratingScore, req.score);
  setCell(f.rowIndex, C.ratingComment, req.comment || '');
  setCell(f.rowIndex, C.status, ST.DONE);
  setCell(f.rowIndex, C.unreadAdmin, true);
  addLog(req.ticketId, 'user', f.row[3], 'ให้คะแนน', (req.score + ' ดาว ' + (req.comment || '')).trim(), 100, ST.DONE);
  return { ok: true, data: { ok: true } };
}

// ====================== แอดมิน ======================
function adminName(code) { var a = findAdminRow(code); return a ? a.row[1] : 'ผู้ดูแล'; }

function apiAdminList(req) {
  var t = requireAdmin(req);
  if (!t) return { ok: false, error: 'session หมดอายุ กรุณาเข้าสู่ระบบใหม่' };
  var data = ticketsSheet().getDataRange().getValues(), all = [];
  for (var i = 1; i < data.length; i++) all.push(rowToTicket(data[i]));
  all.reverse();
  var stats = { total: all.length, neu: 0, working: 0, review: 0, done: 0, rating: 0, rated: 0 };
  all.forEach(function (x) {
    if (x.status === ST.NEW) stats.neu++;
    else if (x.status === ST.ACCEPTED || x.status === ST.WORKING) stats.working++;
    else if (x.status === ST.REVIEW) stats.review++;
    else if (x.status === ST.DONE || x.status === ST.RECEIVED) stats.done++;
    if (x.ratingScore) { stats.rating += Number(x.ratingScore); stats.rated++; }
  });
  stats.avgRating = stats.rated ? Math.round(stats.rating / stats.rated * 10) / 10 : 0;
  var list = (req.filter && req.filter !== 'ทั้งหมด') ? all.filter(function (x) { return x.status === req.filter; }) : all;
  return { ok: true, data: { tickets: list, stats: stats } };
}

/** รับเรื่อง + ระบุระยะเวลา/รายละเอียด */
function apiAdminAccept(req) {
  var t = requireAdmin(req);
  if (!t) return { ok: false, error: 'session หมดอายุ' };
  var f = findTicket(req.ticketId);
  if (!f) return { ok: false, error: 'ไม่พบงานซ่อมนี้' };
  var an = adminName(t.code);
  setCell(f.rowIndex, C.status, ST.ACCEPTED);
  setCell(f.rowIndex, C.progress, 10);                 // รับเรื่องแล้ว = เริ่ม 10%
  setCell(f.rowIndex, C.etaText, req.etaText || '');
  setCell(f.rowIndex, C.adminNote, req.adminNote || '');
  setCell(f.rowIndex, C.acceptedAt, nowStr());
  setCell(f.rowIndex, C.adminName, an);
  if (req.appointDate !== undefined) setCell(f.rowIndex, C.appointDate, req.appointDate);
  if (req.appointTime !== undefined) setCell(f.rowIndex, C.appointTime, req.appointTime);
  setCell(f.rowIndex, C.unreadUser, true);
  setCell(f.rowIndex, C.unreadAdmin, false);
  addLog(req.ticketId, 'admin', an, 'รับเรื่อง',
    (req.etaText ? 'ระยะเวลา: ' + req.etaText + '. ' : '') + (req.adminNote || ''), 10, ST.ACCEPTED);
  return { ok: true, data: { ok: true } };
}

/** ปฏิเสธ / ทำไม่ได้ + เหตุผล */
function apiAdminReject(req) {
  var t = requireAdmin(req);
  if (!t) return { ok: false, error: 'session หมดอายุ' };
  var f = findTicket(req.ticketId);
  if (!f) return { ok: false, error: 'ไม่พบงานซ่อมนี้' };
  var an = adminName(t.code);
  setCell(f.rowIndex, C.status, ST.REJECT);
  setCell(f.rowIndex, C.adminNote, req.reason || '');
  setCell(f.rowIndex, C.adminName, an);
  setCell(f.rowIndex, C.unreadUser, true);
  setCell(f.rowIndex, C.unreadAdmin, false);
  addLog(req.ticketId, 'admin', an, 'แจ้งไม่สามารถดำเนินการได้', req.reason || '', '', ST.REJECT);
  return { ok: true, data: { ok: true } };
}

/** อัปเดตความคืบหน้า / รายละเอียด (ทำได้ตลอดเวลา) */
function apiAdminUpdate(req) {
  var t = requireAdmin(req);
  if (!t) return { ok: false, error: 'session หมดอายุ' };
  var f = findTicket(req.ticketId);
  if (!f) return { ok: false, error: 'ไม่พบงานซ่อมนี้' };
  var an = adminName(t.code);
  var prog = (req.progress === undefined || req.progress === '') ? Number(f.row[21] || 0) : Number(req.progress);
  setCell(f.rowIndex, C.progress, prog);
  if (req.note) setCell(f.rowIndex, C.adminNote, req.note);
  if (req.etaText !== undefined && req.etaText !== '') setCell(f.rowIndex, C.etaText, req.etaText);
  if (req.appointDate !== undefined && req.appointDate !== '') setCell(f.rowIndex, C.appointDate, req.appointDate);
  if (req.appointTime !== undefined && req.appointTime !== '') setCell(f.rowIndex, C.appointTime, req.appointTime);
  var cur = f.row[11];
  if (cur === ST.NEW || cur === ST.ACCEPTED) setCell(f.rowIndex, C.status, ST.WORKING);
  setCell(f.rowIndex, C.adminName, an);
  setCell(f.rowIndex, C.unreadUser, true);
  addLog(req.ticketId, 'admin', an, 'อัปเดตความคืบหน้า', req.note || '', prog, ST.WORKING);
  return { ok: true, data: { ok: true } };
}

/** ปิดงาน → รอผู้แจ้งตรวจรับ */
function apiAdminClose(req) {
  var t = requireAdmin(req);
  if (!t) return { ok: false, error: 'session หมดอายุ' };
  var f = findTicket(req.ticketId);
  if (!f) return { ok: false, error: 'ไม่พบงานซ่อมนี้' };
  var an = adminName(t.code);
  setCell(f.rowIndex, C.status, ST.REVIEW);
  setCell(f.rowIndex, C.progress, 100);
  if (req.note) setCell(f.rowIndex, C.adminNote, req.note);
  setCell(f.rowIndex, C.closedAt, nowStr());
  setCell(f.rowIndex, C.doneAt, nowStr());
  setCell(f.rowIndex, C.adminName, an);
  setCell(f.rowIndex, C.unreadUser, true);
  setCell(f.rowIndex, C.unreadAdmin, false);
  addLog(req.ticketId, 'admin', an, 'ปิดงาน — รอผู้แจ้งตรวจรับ', req.note || '', 100, ST.REVIEW);
  return { ok: true, data: { ok: true } };
}

// ====================== UTIL ======================
function json(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function safeJson(s) { try { return JSON.parse(s); } catch (e) { return null; } }
function nowStr() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'); }
function log(tag, msg) { try { var sh = ss().getSheetByName('Log'); if (sh) sh.appendRow([nowStr(), tag, msg]); } catch (e) {} }

// ====================== SETUP (รันครั้งเดียว) ======================
function setupSheets() {
  var s = ss();
  ['Employees','Admins','Tickets','TicketLog','Config','Log'].forEach(function (n) { if (!s.getSheetByName(n)) s.insertSheet(n); });

  var emp = s.getSheetByName('Employees');
  if (emp.getLastRow() === 0)
    emp.appendRow(['no','empCode','name','dept','zone','room','pinHash','phone','lineUserId']);

  var ad = s.getSheetByName('Admins');
  if (ad.getLastRow() === 0) {
    ad.appendRow(['adminCode','name','position','pinHash']);
    ad.appendRow(['admin01','ผู้ดูแลงานซ่อม','ฝ่ายซ่อมบำรุง','']);   // PIN = 1234
  }

  var tk = s.getSheetByName('Tickets');
  if (tk.getLastRow() === 0)
    tk.appendRow(['ticketId','createdAt','empCode','name','dept','zone','room','phone','category',
      'detail','photos','status','appointDate','appointTime','hrNote','round','doneAt','ratingScore',
      'ratingComment','urgency','symptoms','progress','adminNote','etaText','acceptedAt','closedAt',
      'userAcceptedAt','unreadUser','unreadAdmin','adminName']);

  var tl = s.getSheetByName('TicketLog');
  if (tl.getLastRow() === 0) tl.appendRow(['time','ticketId','by','byName','action','detail','progress','status']);

  var cf = s.getSheetByName('Config');
  if (cf.getLastRow() === 0) cf.appendRow(['key','value']);
  ['DRIVE_FOLDER_ID','LINE_TOKEN','LINE_TARGET_ID'].forEach(function (k) {
    var v = cf.getDataRange().getValues(), found = false;
    for (var i = 0; i < v.length; i++) if (String(v[i][0]).trim() === k) found = true;
    if (!found) cf.appendRow([k, '']);
  });

  var lg = s.getSheetByName('Log');
  if (lg.getLastRow() === 0) lg.appendRow(['time','tag','msg']);
  rightsSheet();   // สร้างแท็บ Rights จากค่าเริ่มต้นถ้ายังไม่มี
}

/** อัปเกรดชีต Tickets เดิมให้มีคอลัมน์ใหม่ (รันครั้งเดียวถ้าเคยใช้เวอร์ชันก่อน) */
function upgradeTickets() {
  setupSheets();
  var tk = ss().getSheetByName('Tickets');
  var head = ['ticketId','createdAt','empCode','name','dept','zone','room','phone','category',
    'detail','photos','status','appointDate','appointTime','hrNote','round','doneAt','ratingScore',
    'ratingComment','urgency','symptoms','progress','adminNote','etaText','acceptedAt','closedAt',
    'userAcceptedAt','unreadUser','unreadAdmin','adminName'];
  tk.getRange(1, 1, 1, head.length).setValues([head]);
}
