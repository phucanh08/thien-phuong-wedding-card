// Luật dữ liệu của mục "Nội dung thiệp" (C6 trong CLAUDE.md): kiểm data trước khi lưu/xuất bản,
// đọc/ghi theo đường dẫn "a.b.0.c" và mã hoá sang dạng Firestore REST cho bản xem trước.
// Module thuần (không DOM, không Firebase) để chạy được cả trong trình duyệt và `node --test`.

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isText = (v) => typeof v === "string" && v.trim() !== "";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
// Ngày, có thể kèm giờ và múi giờ: 2026-10-24 | 2026-10-24T16:30 | 2026-10-24T16:30:00+07:00
const DATE_TIME = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?)?$/;
const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const DEFAULT_OFFSET = ":00+07:00";

// Cùng luật safeUrl của docs/content-loader.js: thiệp bỏ âm thầm URL sai, ở đây báo lỗi ngay.
// Trả câu lỗi, hoặc null nếu hợp lệ. Chuỗi rỗng = không đặt (hợp lệ).
export function urlProblem(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return "Phải là đường dẫn dạng chữ.";
  if (/["'`<>\\\u0000-\u001f]/.test(value.trim())) {
    return "Đường dẫn không được chứa dấu nháy, \\, < >, hay ký tự điều khiển.";
  }
  let protocol;
  try {
    protocol = new URL(value, "https://relative.invalid/").protocol;
  } catch {
    return "Đường dẫn không hợp lệ.";
  }
  return ["https:", "http:"].includes(protocol) ? null : "Chỉ nhận link http(s) hoặc đường dẫn trong trang.";
}

function isRealDate(value) {
  if (typeof value !== "string" || !DATE_TIME.test(value)) return false;
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// Trả danh sách lỗi [{ path, message }] theo thứ tự các mục trên trang; [] = hợp lệ.
// Bắt buộc theo C6: tên ngắn hai bên, ngày cưới, mỗi sự kiện có key/title/startISO. Mảng được rỗng.
// Thêm (ruling M1): mọi URL theo luật safeUrl, dressCode chỉ #rgb/#rrggbb.
export function validateContent(data) {
  const problems = [];
  const add = (path, message) => problems.push({ path, message });
  const url = (path, value) => {
    const problem = urlProblem(value);
    if (problem) add(path, problem);
  };
  const obj = (v) => (isObject(v) ? v : {});
  const list = (v) => (Array.isArray(v) ? v : []);
  if (!isObject(data)) return [{ path: "", message: "Dữ liệu không hợp lệ." }];

  const meta = obj(data.meta);
  url("meta.previewImage", meta.previewImage);
  url("meta.favicon", meta.favicon);

  for (const side of ["groom", "bride"]) {
    const person = obj(obj(data.couple)[side]);
    if (!isText(person.shortName)) add(`couple.${side}.shortName`, "Cần tên ngắn (hiện trên thiệp).");
    url(`couple.${side}.photo`, person.photo);
    url(`couple.${side}.facebook`, person.facebook);
  }

  const wedding = obj(data.wedding);
  if (typeof wedding.dateISO !== "string" || !DATE_ONLY.test(wedding.dateISO) || !isRealDate(wedding.dateISO)) {
    add("wedding.dateISO", "Cần ngày cưới dạng YYYY-MM-DD.");
  }
  if (wedding.rsvpDeadline != null && wedding.rsvpDeadline !== ""
    && !(DATE_ONLY.test(wedding.rsvpDeadline) && isRealDate(wedding.rsvpDeadline))) {
    add("wedding.rsvpDeadline", "Hạn phản hồi phải là ngày YYYY-MM-DD.");
  }
  url("wedding.mainImage", wedding.mainImage);
  url("wedding.invitationImage", wedding.invitationImage);
  url("wedding.envelopeImage", wedding.envelopeImage);
  list(wedding.coverImages).forEach((u, i) => url(`wedding.coverImages.${i}`, u));

  if (data.events != null && !Array.isArray(data.events)) add("events", "Danh sách sự kiện không hợp lệ.");
  list(data.events).forEach((raw, i) => {
    const e = obj(raw);
    const p = `events.${i}`;
    if (!isText(e.key)) add(`${p}.key`, "Sự kiện thiếu mã (key).");
    if (!isText(e.title)) add(`${p}.title`, "Cần tên sự kiện.");
    if (!isRealDate(e.startISO)) add(`${p}.startISO`, "Cần ngày bắt đầu hợp lệ.");
    if (e.endISO != null && e.endISO !== "" && !isRealDate(e.endISO)) add(`${p}.endISO`, "Ngày kết thúc không hợp lệ.");
    url(`${p}.mapUrl`, e.mapUrl);
    url(`${p}.image`, e.image);
    list(e.dressCode).forEach((c, j) => {
      if (typeof c !== "string" || !COLOR.test(c)) add(`${p}.dressCode.${j}`, "Mã màu phải dạng #rgb hoặc #rrggbb.");
    });
  });

  list(data.story).forEach((s, i) => url(`story.${i}.image`, obj(s).image));

  list(data.gallery).forEach((raw, i) => {
    const g = obj(raw);
    if (!isText(g.small) && !isText(g.large)) add(`gallery.${i}.small`, "Ảnh album chưa có ảnh.");
    url(`gallery.${i}.small`, g.small);
    url(`gallery.${i}.large`, g.large);
  });

  for (const side of ["groom", "bride"]) url(`donate.${side}.qr`, obj(obj(data.donate)[side]).qr);
  url("music.src", obj(data.music).src);
  return problems;
}

function splitPath(path) {
  return path === "" ? [] : String(path).split(".");
}

export function getPath(data, path) {
  let node = data;
  for (const key of splitPath(path)) {
    if (node == null || typeof node !== "object") return undefined;
    node = node[key];
  }
  return node;
}

// Ghi giá trị vào đường dẫn, tạo object trung gian nếu thiếu; value === undefined thì xoá key
// (field tuỳ chọn bỏ trống -> thiệp dùng mặc định). Không đụng tới field khác.
export function setPath(data, path, value) {
  const keys = splitPath(path);
  const last = keys.pop();
  let node = data;
  for (const key of keys) {
    if (node[key] == null || typeof node[key] !== "object") node[key] = {};
    node = node[key];
  }
  if (value === undefined) {
    if (Array.isArray(node)) node.splice(Number(last), 1);
    else delete node[last];
  } else {
    node[last] = value;
  }
}

// JS thường -> giá trị có kiểu của Firestore REST (ngược với decodeValue trong content-loader.js).
export function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (typeof value === "object") {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, toFirestoreValue(v)])) } };
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === "boolean") return { booleanValue: value };
  return { stringValue: String(value) };
}

// So hai bản data bất kể thứ tự key (Firestore trả map theo thứ tự riêng).
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  }
  return value;
}
export const sameContent = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

// Ô "Hiện ở Album" của mỗi ảnh album: chỉ số các ảnh băng ảnh Album của thiệp đang hiện, theo thứ tự
// album. Cùng luật gridItems của docs/v2/gallery-grid.js: ảnh featuredV2 === true; chưa ảnh nào thì ảnh
// featured; không có thì 6 ảnh đầu.
export function albumShown(gallery) {
  const items = (Array.isArray(gallery) ? gallery : []).map((g) => g || {});
  const indexes = (pick) => items.flatMap((g, i) => (pick(g) ? [i] : []));
  const chosen = indexes((g) => g.featuredV2 === true);
  if (chosen.length) return chosen;
  const featured = indexes((g) => g.featured);
  return featured.length ? featured : items.slice(0, 6).map((_, i) => i);
}

// Tick/bỏ tick ô "Hiện ở Album" của ảnh `index`: ghi featuredV2 = true cho đúng các ảnh được tick (ảnh
// đang hiện nhờ luật dự phòng cũng được ghi), xoá featuredV2 === true ở ảnh bỏ tick, để băng Album =
// đúng tập tick. featured không bao giờ bị đổi. Bỏ tick ảnh cuối cùng -> không đổi gì, trả false
// (không ảnh nào thì thiệp rơi về luật dự phòng).
export function setAlbumShown(gallery, index, shown) {
  const next = new Set(albumShown(gallery));
  if (shown) next.add(index);
  else next.delete(index);
  if (!next.size) return false;
  gallery.forEach((item, i) => {
    if (!item || typeof item !== "object") return;
    if (next.has(i)) item.featuredV2 = true;
    else if (item.featuredV2 === true) delete item.featuredV2;
  });
  return true;
}

// Dòng đếm ở mục Album của trình sửa.
export function galleryCountText(gallery) {
  const count = Array.isArray(gallery) ? gallery.length : 0;
  if (!count) return "0 ảnh";
  return `${count} ảnh · Hiện ở Album: ${albumShown(gallery).length} ảnh`;
}

// Nút "Thay ảnh…" của một ảnh album (G2): ảnh vừa tải lên ({ small, large } từ Worker) thay đúng ảnh
// `item` (so theo tham chiếu, không theo chỉ số), giữ cờ lưới, chú thích, field lạ và thứ tự album.
// `item` không còn trong album (album đã bị thay trong lúc chọn ảnh) -> không đổi gì, trả false.
export function replaceGalleryImage(gallery, item, { small, large }) {
  if (!Array.isArray(gallery) || !gallery.includes(item)) return false;
  item.small = small;
  item.large = large;
  return true;
}

// draft/published: { data, updatedAt (Timestamp: có toMillis), updatedBy } hoặc null.
// Xuất bản luôn ghi nháp cùng mốc với published, nên nháp có mốc trước published là nháp soạn trên một
// bản xuất bản cũ (vd published đổi bằng công cụ khác): lưu/xuất bản nó sẽ xoá thay đổi của bản mới.
// Nội dung trùng thì vô hại.
export function isDraftBehind(draft, published) {
  if (!draft || !published || !draft.updatedAt || !published.updatedAt) return false;
  return draft.updatedAt.toMillis() < published.updatedAt.toMillis() && !sameContent(draft.data, published.data);
}

// "2026-10-24T16:30:00+07:00" -> { date: "2026-10-24", time: "16:30", rest: ":00+07:00" } cho ô ngày + ô giờ.
// rest giữ giây/múi giờ gốc để ghi lại không đổi.
export function splitISO(value) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(.*))?$/.exec(typeof value === "string" ? value : "");
  if (!m) return { date: "", time: "", rest: "" };
  return { date: m[1], time: m[2] || "", rest: m[2] ? m[3] : "" };
}

export function joinISO(date, time, rest) {
  if (!date) return "";
  if (!time) return date;
  return `${date}T${time}${rest || DEFAULT_OFFSET}`;
}
