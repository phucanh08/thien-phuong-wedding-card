// Nhập danh sách khách từ Excel/CSV: đọc file, map cột tiếng Việt, kiểm từng dòng theo C5.
// Không chạm Firestore; guests.js ghi các dòng hợp lệ.

// SheetJS bản chính thức, pin version; chỉ tải khi admin mở màn nhập file.
const SHEETJS_URL = "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";
const MAX_ROWS = 1000;

let sheetjs = null;
export function loadSheetJS() {
  sheetjs ||= import(SHEETJS_URL).catch((error) => {
    sheetjs = null;
    throw error;
  });
  return sheetjs;
}

// Cột của file mẫu, theo thứ tự. `aliases` là tên cột khác vẫn nhận (đã bỏ dấu, viết thường).
export const COLUMNS = [
  { field: "name", header: "Tên", aliases: ["ten", "ho ten", "ho va ten", "ten khach", "name"] },
  { field: "salutation", header: "Xưng hô", aliases: ["xung ho", "danh xung", "salutation"] },
  { field: "side", header: "Bên", aliases: ["ben", "nha", "side"] },
  { field: "group", header: "Nhóm", aliases: ["nhom", "group"] },
  { field: "phone", header: "SĐT", aliases: ["sdt", "so dien thoai", "dien thoai", "phone"] },
  { field: "events", header: "Sự kiện", aliases: ["su kien", "le", "events", "invitedevents"] },
  { field: "expectedCount", header: "Số người", aliases: ["so nguoi", "so luong", "expectedcount"] },
  { field: "note", header: "Ghi chú", aliases: ["ghi chu", "note"] },
];

// Bỏ dấu tiếng Việt, gộp khoảng trắng, viết thường — dùng để so tên cột, giá trị "Bên", tìm kiếm.
export function fold(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const SIDE_BY_TEXT = {
  "trai": "groom", "nha trai": "groom", "ben trai": "groom", "groom": "groom",
  "gai": "bride", "nha gai": "bride", "ben gai": "bride", "bride": "bride",
};

export function parseSide(value) {
  return SIDE_BY_TEXT[fold(value)] || null;
}

// "Sự kiện": key hoặc tên lễ trong wedding-data.js, ngăn cách bằng dấu phẩy / chấm phẩy / xuống dòng.
// Để trống = mời tất cả. Trả { keys } hoặc { unknown: [...] }.
// Tên lễ có thể chứa dấu phẩy ("Uống nước, ăn cỗ nhà trai") nên ghép các mảnh liền nhau, ưu tiên khớp dài nhất.
export function parseEvents(value, events) {
  const allKeys = events.map((e) => e.key);
  const tokens = String(value ?? "").split(/[,;\n]+/).map((t) => t.trim()).filter(Boolean);
  if (!tokens.length) return { keys: allKeys };
  const findEvent = (text) => {
    const folded = fold(text);
    return events.find((e) => fold(e.key) === folded || fold(e.title) === folded);
  };
  const keys = new Set();
  const unknown = [];
  for (let i = 0; i < tokens.length;) {
    let matched = false;
    for (let j = tokens.length; j > i; j--) {
      const match = findEvent(tokens.slice(i, j).join(", "));
      if (match) {
        keys.add(match.key);
        i = j;
        matched = true;
        break;
      }
    }
    if (!matched) unknown.push(tokens[i++]);
  }
  if (unknown.length) return { unknown };
  return { keys: allKeys.filter((k) => keys.has(k)) };
}

// Giới hạn field guests theo C5 trong CLAUDE.md (rules không kiểm, nên kiểm ở đây — form và nhập file dùng chung).
export const LIMITS = { name: 60, salutation: 30, group: 60, phone: 20, note: 500, countMax: 20 };

const charCount = (text) => Array.from(text).length;

// Tên khách: gộp khoảng trắng, bỏ ký tự vô hình (zero-width, điều khiển, ô trống Hangul…) rồi cắt hai đầu.
export function cleanName(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .replace(/[\p{Cf}\p{Cc}\u115F\u1160\u3164\uFFA0]/gu, "")
    .trim();
}

// Kiểm các field chữ và Số người theo C5. Nhận chuỗi đã trim (countText "" = chưa nhập).
// Trả { values: { name, salutation, group, phone, note, expectedCount }, errors: [] }.
export function checkGuestFields({ name, salutation, group, phone, note, countText }) {
  const errors = [];
  const cleanedName = cleanName(name);
  if (!cleanedName) errors.push("thiếu Tên");
  else if (charCount(cleanedName) > LIMITS.name) errors.push(`Tên dài ${charCount(cleanedName)} ký tự, tối đa ${LIMITS.name}`);
  for (const [field, label] of [["salutation", "Xưng hô"], ["group", "Nhóm"], ["phone", "SĐT"], ["note", "Ghi chú"]]) {
    const length = charCount({ salutation, group, phone, note }[field]);
    if (length > LIMITS[field]) errors.push(`${label} dài ${length} ký tự, tối đa ${LIMITS[field]}`);
  }
  // Chỉ chữ số thập phân: "1e3", "0x10", "2.5", "-1" bị loại; số ngoài 1–20 (kể cả quá lớn) bị loại.
  const expectedCount = /^\d+$/.test(countText) ? Number(countText) : NaN;
  if (!(expectedCount >= 1 && expectedCount <= LIMITS.countMax)) {
    errors.push(`Số người "${countText}" phải là số nguyên từ 1 đến ${LIMITS.countMax}`);
  }
  return { values: { name: cleanedName, salutation, group, phone, note, expectedCount }, errors };
}

function cellText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

// Excel hay lưu SĐT dạng số và làm rơi số 0 đầu: 912345678 → "0912345678".
function phoneText(value) {
  const text = cellText(value);
  return typeof value === "number" && /^\d{9}$/.test(text) ? `0${text}` : text;
}

// CSV chỉ nhận UTF-8 (có/không BOM) hoặc UTF-16 có BOM. Byte lạ (vd Windows-1258 của Excel "CSV (Comma delimited)"
// trên Windows tiếng Việt) mà cứ đọc như UTF-8 thì tên vỡ dấu hoặc báo sai là thiếu cột, nên báo thẳng.
function decodeCsv(buffer) {
  const bytes = new Uint8Array(buffer);
  const utf16 = bytes[0] === 0xFF && bytes[1] === 0xFE ? "utf-16le" : bytes[0] === 0xFE && bytes[1] === 0xFF ? "utf-16be" : null;
  try {
    return new TextDecoder(utf16 || "utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw Object.assign(
      new Error("File CSV không phải mã hoá UTF-8 (có thể là Windows-1258/ANSI nên tên bị vỡ dấu). "
        + "Hãy lưu lại bằng \"CSV UTF-8 (Comma delimited)\" hoặc dùng file .xlsx."),
      { csvEncoding: true });
  }
}

// Đọc file người dùng chọn thành mảng dòng thô { rowNumber, values: { field: cell } }.
// Ném Error với message tiếng Việt khi file không đọc được hoặc thiếu cột bắt buộc.
export async function readGuestFile(file) {
  const XLSX = await loadSheetJS();
  const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv";
  let workbook;
  try {
    workbook = isCsv
      ? XLSX.read(decodeCsv(await file.arrayBuffer()), { type: "string", raw: true })
      : XLSX.read(await file.arrayBuffer(), { type: "array" });
  } catch (error) {
    if (error.csvEncoding) throw error;
    throw new Error("Không đọc được file. Hãy dùng file .xlsx hoặc .csv theo file mẫu.");
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("File không có trang tính nào.");

  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: true, raw: true });
  const headerIndex = grid.findIndex((row) => row.some((cell) => cellText(cell)));
  if (headerIndex < 0) throw new Error("File trống.");

  const fieldByColumn = grid[headerIndex].map((cell) => {
    const folded = fold(cell);
    const column = COLUMNS.find((c) => fold(c.header) === folded || c.aliases.includes(folded));
    return column ? column.field : null;
  });
  const missing = ["name", "side"].filter((f) => !fieldByColumn.includes(f));
  if (missing.length) {
    const names = missing.map((f) => `"${COLUMNS.find((c) => c.field === f).header}"`).join(", ");
    throw new Error(`Thiếu cột ${names} ở dòng tiêu đề. Hãy dùng đúng tên cột như file mẫu.`);
  }

  const rows = [];
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const cells = grid[i];
    if (!cells.some((cell) => cellText(cell))) continue;
    const values = {};
    fieldByColumn.forEach((field, c) => {
      if (field && !(field in values)) values[field] = cells[c];
    });
    rows.push({ rowNumber: i + 1, values });
  }
  if (rows.length > MAX_ROWS) throw new Error(`File có ${rows.length} dòng; mỗi lần nhập tối đa ${MAX_ROWS} dòng.`);
  return rows;
}

// Kiểm một dòng thô theo C5. Trả { rowNumber, guest, errors: [] }; guest chỉ có field C5 do admin nhập
// (code, createdAt/updatedAt/createdBy do guests.js thêm lúc ghi).
export function validateRow({ rowNumber, values }, events) {
  const sideText = cellText(values.side);
  const side = parseSide(sideText);
  const parsedEvents = parseEvents(values.events, events);
  const { values: fields, errors } = checkGuestFields({
    name: cellText(values.name),
    salutation: cellText(values.salutation),
    group: cellText(values.group),
    phone: phoneText(values.phone),
    note: cellText(values.note),
    countText: cellText(values.expectedCount) || "1",
  });

  if (!sideText) errors.push("thiếu Bên (trai/gái)");
  else if (!side) errors.push(`Bên "${sideText}" không hợp lệ (chỉ nhận trai/gái)`);
  if (parsedEvents.unknown) errors.push(`không có sự kiện "${parsedEvents.unknown.join('", "')}"`);

  const guest = {
    name: fields.name,
    side,
    group: fields.group,
    invitedEvents: parsedEvents.keys || [],
    expectedCount: fields.expectedCount,
  };
  for (const key of ["salutation", "phone", "note"]) if (fields[key]) guest[key] = fields[key];
  return { rowNumber, guest, errors };
}

// File mẫu: trang "Khách mời" (tiêu đề + 2 dòng ví dụ) và trang "Hướng dẫn" liệt kê sự kiện.
export async function downloadTemplate(format, events) {
  const XLSX = await loadSheetJS();
  const header = COLUMNS.map((c) => c.header);
  const examples = [
    ["Nguyễn Văn An", "Anh", "trai", "Bạn đại học", "0912345678", "", 2, "Đi cùng vợ"],
    ["Trần Thị Bình", "Cô", "gái", "Họ hàng", "", events.slice(-1).map((e) => e.key).join(", "), 1, ""],
  ];
  const sheet = XLSX.utils.aoa_to_sheet([header, ...examples]);
  sheet["!cols"] = [22, 10, 8, 16, 14, 34, 10, 24].map((wch) => ({ wch }));
  // Cột SĐT để dạng chữ cho Excel không làm rơi số 0 đầu.
  for (let r = 1; r <= examples.length; r++) {
    const cell = sheet[XLSX.utils.encode_cell({ r, c: 4 })];
    if (cell) { cell.t = "s"; cell.z = "@"; }
  }

  if (format === "csv") {
    const csv = "﻿" + XLSX.utils.sheet_to_csv(sheet);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: "mau-khach-moi.csv" });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }

  const guide = XLSX.utils.aoa_to_sheet([
    ["Cột", "Cách điền"],
    ["Tên", "Bắt buộc, tối đa 60 ký tự. Tên hiện trên thiệp."],
    ["Xưng hô", "Không bắt buộc, vd: Anh, Chị, Cô chú. Thiệp chào \"Xưng hô Tên\"."],
    ["Bên", "Bắt buộc: trai hoặc gái."],
    ["Nhóm", "Không bắt buộc, vd: Bạn đại học, Đồng nghiệp, Họ hàng."],
    ["SĐT", "Không bắt buộc. Ai có link thiệp riêng của khách đều xem được SĐT và Ghi chú."],
    ["Sự kiện", "Để trống = mời tất cả. Nhiều sự kiện cách nhau bằng dấu phẩy; ghi mã hoặc tên lễ ở bảng dưới."],
    ["Số người", "Số người dự kiến đi cùng thiệp này, số nguyên từ 1 đến 20. Để trống = 1."],
    ["Ghi chú", "Không bắt buộc."],
    [],
    ["Mã sự kiện", "Tên lễ"],
    ...events.map((e) => [e.key, e.title]),
  ]);
  guide["!cols"] = [{ wch: 18 }, { wch: 90 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Khách mời");
  XLSX.utils.book_append_sheet(workbook, guide, "Hướng dẫn");
  XLSX.writeFile(workbook, "mau-khach-moi.xlsx");
}
