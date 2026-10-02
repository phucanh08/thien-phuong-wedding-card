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

function cellText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

// Excel hay lưu SĐT dạng số và làm rơi số 0 đầu: 912345678 → "0912345678".
function phoneText(value) {
  const text = cellText(value);
  return typeof value === "number" && /^\d{9}$/.test(text) ? `0${text}` : text;
}

// Đọc file người dùng chọn thành mảng dòng thô { rowNumber, values: { field: cell } }.
// Ném Error với message tiếng Việt khi file không đọc được hoặc thiếu cột bắt buộc.
export async function readGuestFile(file) {
  const XLSX = await loadSheetJS();
  const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv";
  let workbook;
  try {
    workbook = isCsv
      ? XLSX.read((await file.text()).replace(/^﻿/, ""), { type: "string", raw: true })
      : XLSX.read(await file.arrayBuffer(), { type: "array" });
  } catch {
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
  const errors = [];
  const name = cellText(values.name);
  if (!name) errors.push("thiếu Tên");

  const sideText = cellText(values.side);
  const side = parseSide(sideText);
  if (!sideText) errors.push("thiếu Bên (trai/gái)");
  else if (!side) errors.push(`Bên "${sideText}" không hợp lệ (chỉ nhận trai/gái)`);

  const parsedEvents = parseEvents(values.events, events);
  if (parsedEvents.unknown) errors.push(`không có sự kiện "${parsedEvents.unknown.join('", "')}"`);

  let expectedCount = 1;
  const countText = cellText(values.expectedCount);
  if (countText) {
    expectedCount = Number(countText);
    if (!Number.isInteger(expectedCount) || expectedCount < 1) {
      errors.push(`Số người "${countText}" phải là số nguyên từ 1 trở lên`);
    }
  }

  const guest = {
    name,
    side,
    group: cellText(values.group),
    invitedEvents: parsedEvents.keys || [],
    expectedCount,
  };
  const salutation = cellText(values.salutation);
  const phone = phoneText(values.phone);
  const note = cellText(values.note);
  if (salutation) guest.salutation = salutation;
  if (phone) guest.phone = phone;
  if (note) guest.note = note;
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
    ["Tên", "Bắt buộc. Tên hiện trên thiệp."],
    ["Xưng hô", "Không bắt buộc, vd: Anh, Chị, Cô chú. Thiệp chào \"Xưng hô Tên\"."],
    ["Bên", "Bắt buộc: trai hoặc gái."],
    ["Nhóm", "Không bắt buộc, vd: Bạn đại học, Đồng nghiệp, Họ hàng."],
    ["SĐT", "Không bắt buộc. Ai có link thiệp riêng của khách đều xem được SĐT và Ghi chú."],
    ["Sự kiện", "Để trống = mời tất cả. Nhiều sự kiện cách nhau bằng dấu phẩy; ghi mã hoặc tên lễ ở bảng dưới."],
    ["Số người", "Số người dự kiến đi cùng thiệp này, số nguyên ≥ 1. Để trống = 1."],
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
