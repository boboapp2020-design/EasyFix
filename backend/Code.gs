/**
 * Easy Fix — ระบบแจ้งซ่อมบ้านพักพนักงาน
 * Google Apps Script backend: REST API (ผูกกับ Google Sheets + Drive)
 *
 * Deploy: Deploy > New deployment > Web app
 *   - Execute as: Me
 *   - Who has access: Anyone
 * นำ URL /exec ไปใส่ใน app/index.html และ app/hr.html (API_URL)
 *
 * หมายเหตุ: พนักงานติดตามสถานะงานซ่อมผ่านแอปโดยตรง (ไม่มีการแจ้งเตือนผ่าน LINE)
 */

// ====================== CONFIG ======================
// อ่านค่าจาก Script Properties ก่อน (ปลอดภัยกว่า) ถ้าไม่มีค่อยอ่านจากแท็บ Config
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
var SALT = 'easyfix-2026-salt';           // เปลี่ยนเป็นค่าลับของคุณ
var HR_KEY = '';                          // อ่านจาก cfg('HR_KEY') ตอนใช้งาน
var TOKEN_TTL_DAYS = 30;
var DEFAULT_PIN = '1234';                 // PIN กลางชั่วคราว — พนักงานที่ยังไม่ตั้ง PIN ใช้ค่านี้เข้าได้

// ====================== ROUTER ======================
function doPost(e) {
  try {
    var body = e.postData ? e.postData.contents : '';
    var req = safeJson(body) || {};
    var res = route(req.action, req);
    return json(res);
  } catch (err) {
    log('doPost-error', String(err));
    return json({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  return json({ ok: true, service: 'EasyFix', time: nowStr() });
}

function route(action, req) {
  switch (action) {
    case 'login':        return apiLogin(req);
    case 'setPin':       return apiSetPin(req);
    case 'submitRepair': return apiSubmitRepair(req);
    case 'myTickets':    return apiMyTickets(req);
    case 'rateTicket':   return apiRateTicket(req);
    case 'hrList':       return apiHrList(req);
    case 'hrUpdate':     return apiHrUpdate(req);
    default:             return { ok: false, error: 'unknown action: ' + action };
  }
}

// ====================== AUTH / EMPLOYEE ======================
function findEmpRow(empCode) {
  var sh = ss().getSheetByName('Employees');
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {              // แถว 0 = header
    if (String(data[i][1]).trim() === String(empCode).trim()) {
      return { rowIndex: i + 1, row: data[i] };        // +1 = เลขแถวจริงใน sheet
    }
  }
  return null;
}
function empProfile(row) {
  return { empCode: String(row[1]), name: row[2], dept: row[3], zone: row[4], room: row[5],
           phone: row[7] || '', hasLine: !!row[8] };
}
function sha256(s) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return raw.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function makeToken(empCode) {
  var exp = Date.now() + TOKEN_TTL_DAYS * 864e5;
  return empCode + '.' + exp + '.' + sha256(empCode + exp + SALT);
}
function checkToken(token) {
  if (!token) return null;
  var p = String(token).split('.');
  if (p.length !== 3) return null;
  var empCode = p[0], exp = Number(p[1]);
  if (Date.now() > exp) return null;
  if (sha256(empCode + exp + SALT) !== p[2]) return null;
  return empCode;
}

function apiLogin(req) {
  var emp = findEmpRow(req.empCode);
  if (!emp) return { ok: false, error: 'ไม่พบรหัสพนักงานนี้' };
  var pinHash = emp.row[6];
  if (!pinHash) {
    // ยังไม่ตั้ง PIN ส่วนตัว → ใช้ PIN กลาง (1234) เข้าได้เลย
    if (String(req.pin) !== DEFAULT_PIN) return { ok: false, error: 'PIN ไม่ถูกต้อง (ค่าเริ่มต้นคือ ' + DEFAULT_PIN + ')' };
    return { ok: true, data: { token: makeToken(String(req.empCode)), profile: empProfile(emp.row) } };
  }
  if (sha256(req.pin + SALT) !== pinHash) return { ok: false, error: 'PIN ไม่ถูกต้อง' };
  return { ok: true, data: { token: makeToken(String(req.empCode)), profile: empProfile(emp.row) } };
}

function apiSetPin(req) {
  var emp = findEmpRow(req.empCode);
  if (!emp) return { ok: false, error: 'ไม่พบรหัสพนักงานนี้' };
  if (!req.pin || String(req.pin).length < 4) return { ok: false, error: 'PIN ต้องมีอย่างน้อย 4 หลัก' };
  ss().getSheetByName('Employees').getRange(emp.rowIndex, 7).setValue(sha256(req.pin + SALT));
  return { ok: true, data: { token: makeToken(String(req.empCode)), profile: empProfile(emp.row) } };
}

// ====================== TICKETS ======================
function assignRound(d) {
  // รอบ 1: อังคาร(2)–พุธ(3)–พฤหัส(4) ; รอบ 2: ศุกร์(5)–เสาร์(6)–จันทร์(1) ; อาทิตย์(0)→รอบ2
  var day = d.getDay();
  return (day >= 2 && day <= 4) ? 'รอบ 1' : 'รอบ 2';
}
function newTicketId() {
  var sh = ss().getSheetByName('Tickets');
  var today = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd');
  var count = 1;
  var data = sh.getDataRange().getValues();
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
      var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], ticketId + '-' + (i + 1) + '.jpg');
      var f = folder.createFile(blob);
      f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      urls.push('https://drive.google.com/uc?id=' + f.getId());
    } catch (err) { log('photo-error', String(err)); }
  }
  return urls.join(' , ');
}

function apiSubmitRepair(req) {
  var empCode = checkToken(req.token);
  if (!empCode) return { ok: false, error: 'session หมดอายุ กรุณาเข้าสู่ระบบใหม่' };
  var emp = findEmpRow(empCode);
  if (!emp) return { ok: false, error: 'ไม่พบพนักงาน' };
  if (!req.detail) return { ok: false, error: 'กรุณากรอกรายละเอียด' };

  var now = new Date();
  var ticketId = newTicketId();
  var photoUrls = savePhotos(req.photos, ticketId);
  var p = empProfile(emp.row);

  // อัปเดตเบอร์โทรถ้ากรอกมา
  if (req.phone) ss().getSheetByName('Employees').getRange(emp.rowIndex, 8).setValue(req.phone);

  var symptomStr = (req.symptoms && req.symptoms.length) ? req.symptoms.join(', ') : '';
  ss().getSheetByName('Tickets').appendRow([
    ticketId, nowStr(), p.empCode, p.name, p.dept, p.zone, p.room,
    req.phone || p.phone, req.category || 'อื่นๆ', req.detail, photoUrls,
    'รอดำเนินการ', '', '', '', assignRound(now), '', '', '', req.urgency || 'ปกติ', symptomStr
  ]);
  return { ok: true, data: { ticketId: ticketId } };
}

function apiMyTickets(req) {
  var empCode = checkToken(req.token);
  if (!empCode) return { ok: false, error: 'session หมดอายุ' };
  var data = ss().getSheetByName('Tickets').getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][2]) === String(empCode)) out.push(rowToTicket(data[i]));
  }
  out.reverse();
  return { ok: true, data: { tickets: out } };
}

function apiRateTicket(req) {
  var empCode = checkToken(req.token);
  if (!empCode) return { ok: false, error: 'session หมดอายุ' };
  var sh = ss().getSheetByName('Tickets');
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === req.ticketId && String(data[i][2]) === String(empCode)) {
      sh.getRange(i + 1, 18).setValue(req.score);          // R = ratingScore
      sh.getRange(i + 1, 19).setValue(req.comment || '');  // S = ratingComment
      return { ok: true, data: { ok: true } };
    }
  }
  return { ok: false, error: 'ไม่พบงานซ่อมนี้' };
}

// ====================== HR ======================
function apiHrList(req) {
  if (req.hrKey !== cfg('HR_KEY')) return { ok: false, error: 'ไม่มีสิทธิ์' };
  var data = ss().getSheetByName('Tickets').getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var t = rowToTicket(data[i]);
    if (req.filter && req.filter !== 'ทั้งหมด' && t.status !== req.filter) continue;
    out.push(t);
  }
  out.reverse();
  return { ok: true, data: { tickets: out } };
}

function apiHrUpdate(req) {
  if (req.hrKey !== cfg('HR_KEY')) return { ok: false, error: 'ไม่มีสิทธิ์' };
  var sh = ss().getSheetByName('Tickets');
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === req.ticketId) {
      var r = i + 1;
      if (req.status !== undefined)      sh.getRange(r, 12).setValue(req.status);
      if (req.appointDate !== undefined) sh.getRange(r, 13).setValue(req.appointDate);
      if (req.appointTime !== undefined) sh.getRange(r, 14).setValue(req.appointTime);
      if (req.hrNote !== undefined)      sh.getRange(r, 15).setValue(req.hrNote);
      if (req.status === 'ดำเนินการแล้วเสร็จ' && !data[i][16]) {
        sh.getRange(r, 17).setValue(nowStr());             // Q = doneAt (พนักงานเห็นสถานะในแอป)
      }
      return { ok: true, data: { ok: true } };
    }
  }
  return { ok: false, error: 'ไม่พบงานซ่อมนี้' };
}

function rowToTicket(r) {
  return {
    ticketId: r[0], createdAt: r[1], empCode: String(r[2]), name: r[3], dept: r[4],
    zone: r[5], room: r[6], phone: r[7], category: r[8], detail: r[9], photos: r[10],
    status: r[11], appointDate: r[12], appointTime: r[13], hrNote: r[14],
    round: r[15], doneAt: r[16], ratingScore: r[17], ratingComment: r[18], urgency: r[19] || 'ปกติ', symptoms: r[20] || ''
  };
}

// ====================== UTIL ======================
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function safeJson(s) { try { return JSON.parse(s); } catch (e) { return null; } }
function nowStr() { return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm'); }
function log(tag, msg) {
  try { var sh = ss().getSheetByName('Log'); if (sh) sh.appendRow([nowStr(), tag, msg]); } catch (e) {}
}

// ====================== SETUP HELPER (รันครั้งเดียว) ======================
function setupSheets() {
  var s = ss();
  ['Employees', 'Tickets', 'Config', 'Log'].forEach(function (n) { if (!s.getSheetByName(n)) s.insertSheet(n); });
  var emp = s.getSheetByName('Employees');
  if (emp.getLastRow() === 0)
    emp.appendRow(['no', 'empCode', 'name', 'dept', 'zone', 'room', 'pinHash', 'phone', 'lineUserId']);
  var tk = s.getSheetByName('Tickets');
  if (tk.getLastRow() === 0)
    tk.appendRow(['ticketId','createdAt','empCode','name','dept','zone','room','phone','category',
      'detail','photos','status','appointDate','appointTime','hrNote','round','doneAt','ratingScore','ratingComment','urgency','symptoms']);
  var cf = s.getSheetByName('Config');
  if (cf.getLastRow() === 0) {
    cf.appendRow(['key', 'value']);
    ['DRIVE_FOLDER_ID','HR_KEY'].forEach(function (k) { cf.appendRow([k, '']); });
  }
  var lg = s.getSheetByName('Log');
  if (lg.getLastRow() === 0) lg.appendRow(['time', 'tag', 'msg']);
}
