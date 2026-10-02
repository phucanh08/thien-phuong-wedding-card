// Mục "Nội dung thiệp": sửa toàn bộ window.WEDDING_DATA (C6), xem trước sống, lưu nháp, xuất bản,
// lịch sử và khôi phục. Dữ liệu người dùng chỉ đưa vào DOM bằng textContent / value.
// Sửa trực tiếp trên một bản sao của data nên field không có ô sửa (field lạ, video...) giữ nguyên.
import { createContentStore, UNKNOWN_PUBLISHED } from "./content-store.js";
import { createPreview } from "./content-preview.js";
import {
  validateContent, getPath, setPath, splitISO, joinISO, albumShown, setAlbumShown, galleryCountText, replaceGalleryImage,
} from "./content-model.js";
import { whereOf } from "./content-labels.js";
import { createImagePicker } from "./image-picker.js";
import { uploadToWorker } from "./image-upload.js";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const AUDIO_TYPES = { "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/m4a": "m4a" };
const SITE_ROOT = new URL("../", import.meta.url);

const SIDES = [["groom", "Chú rể"], ["bride", "Cô dâu"]];

// Mô tả từng mục: hiện ở đâu trên thiệp.
const SECTIONS = {
  meta: {
    title: "Thông tin chia sẻ link",
    where: "Không nằm trong thân thiệp: tiêu đề và biểu tượng trên tab trình duyệt. Khung xem trước khi gửi link qua Zalo, Facebook, Messenger, Telegram, X dùng tiêu đề, mô tả và ảnh cố định trong code, không đổi ở đây.",
  },
  couple: {
    title: "Cô dâu & chú rể",
    where: "Tên trên phong bì và ảnh bìa, mục Gia đình hai bên.",
  },
  wedding: {
    title: "Ngày cưới, ảnh bìa & lời ngỏ",
    where: "Phong bì mở thiệp, câu dẫn, đồng hồ đếm ngược và lịch tháng, ba ảnh “With you”, lời cảm ơn cuối thiệp.",
  },
  events: {
    title: "Sự kiện",
    where: "Thiệp mời từng sự kiện, Timeline và Dresscode. Không thêm/xoá sự kiện hay đổi mã sự kiện ở đây vì khách mời đang gắn theo mã.",
  },
  story: {
    title: "Chuyện tình",
    where: "Mục Chuyện tình, mỗi mốc gồm ngày, tiêu đề, đoạn kể và một ảnh dọc. Danh sách được để trống.",
  },
  gallery: {
    title: "Album ảnh",
    where: "Băng ảnh mục Album gồm các ảnh đánh dấu “Hiện ở Album” (ít nhất 1 ảnh), cũng là ảnh “With you” khi chưa đặt ảnh riêng. “Tất cả hình ảnh” / xem ảnh lớn mở cả album.",
  },
  donate: {
    title: "Hộp mừng cưới",
    where: "Mục Hộp mừng cưới gần cuối thiệp: mã QR và số tài khoản.",
  },
  music: {
    title: "Nhạc nền",
    where: "Phát khi khách chạm mở thiệp, bật/tắt bằng nút loa ở góc màn hình. Tải lên MP3 hoặc M4A, tối đa 10 MB.",
  },
};

const ORIGIN_LABEL = {
  draft: "Đang sửa bản nháp đã lưu",
  published: "Đang sửa từ bản khách đang thấy",
  file: "Lần đầu: nội dung lấy từ wedding-data.js, chưa lưu lên máy chủ",
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, className, onClick) {
  const b = el("button", `btn ${className}`, label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function formatTime(ts) {
  if (!ts || typeof ts.toDate !== "function") return "";
  return ts.toDate().toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

function shortEmail(email) {
  return (email || "").replace(/@thien-phuong-wedding\.local$/, "");
}

// Ảnh trong data là URL tuyệt đối hoặc đường dẫn tính từ gốc site (assets/...).
function resolveUrl(value) {
  try {
    return new URL(value, SITE_ROOT).href;
  } catch {
    return "";
  }
}

let uid = 0;
const nextId = (prefix) => `content-${prefix}-${++uid}`;

export function createContentSection({ db, getUser, getIdToken }) {
  const $ = (id) => document.getElementById(id);
  const store = createContentStore({ db, getUser });
  const state = {
    data: null,
    loaded: false,
    loading: false,
    dirty: false,
    busy: false,
    meta: { draft: null, published: null },
    // updatedAt của bản published mà nội dung đang sửa dựa trên: chỉ đặt khi nạp và sau khi chính
    // trình sửa này xuất bản/khôi phục. Làm mới trạng thái (sau Lưu nháp...) không được đổi mốc này,
    // nếu không bản admin khác vừa xuất bản sẽ bị đè mà không cảnh báo.
    basePublished: null,
    origin: null,
    viewingHistory: null,
  };
  // path -> { inputs: [], feedback, wrap } để gắn lỗi validate vào đúng ô.
  const fields = new Map();
  let preview = null;
  let pickerDialog = null;
  let activePicker = null;

  // ---------- Trạng thái chung ----------

  function setStatus() {
    const parts = [];
    if (state.origin) parts.push(ORIGIN_LABEL[state.origin]);
    if (state.meta.draft) {
      parts.push(`nháp lưu ${formatTime(state.meta.draft.updatedAt)} bởi ${shortEmail(state.meta.draft.updatedBy)}`);
    }
    $("content-status").textContent = parts.join(" · ");
    $("content-published").textContent = state.meta.published
      ? `Khách đang thấy: bản xuất bản ${formatTime(state.meta.published.updatedAt)} bởi ${shortEmail(state.meta.published.updatedBy)}.`
      : "Khách đang thấy: nội dung mặc định trong wedding-data.js (chưa xuất bản lần nào).";
    $("content-dirty").hidden = !state.dirty;
  }

  function showAlert(text, kind = "danger", items = []) {
    const box = $("content-alert");
    box.className = `alert alert-${kind} py-2 small`;
    box.replaceChildren(el("div", "", text));
    if (items.length) {
      const list = el("ul", "mb-0 mt-1 ps-3");
      for (const problem of items) {
        const li = el("li");
        const link = el("a", "", `${labelOf(problem.path)}: ${problem.message}`);
        link.href = "#noi-dung";
        link.addEventListener("click", (event) => {
          event.preventDefault();
          focusField(problem.path);
        });
        li.append(link);
        list.append(li);
      }
      box.append(list);
    }
    box.hidden = !text;
    if (text) box.scrollIntoView({ block: "nearest" });
  }

  function hideAlert() {
    $("content-alert").hidden = true;
  }

  function labelOf(path) {
    const field = fieldFor(path);
    return field ? field.label : path;
  }

  function fieldFor(path) {
    let p = path;
    while (p) {
      if (fields.has(p)) return fields.get(p);
      p = p.includes(".") ? p.slice(0, p.lastIndexOf(".")) : "";
    }
    return null;
  }

  function focusField(path) {
    const field = fieldFor(path);
    if (!field) return;
    field.wrap.closest("details")?.setAttribute("open", "");
    field.wrap.scrollIntoView({ behavior: "smooth", block: "center" });
    field.inputs[0]?.focus({ preventScroll: true });
  }

  // Validate lại sau mỗi lần sửa: báo lỗi ngay ở ô, không chờ tới lúc lưu.
  function refreshValidation() {
    const problems = validateContent(state.data);
    for (const field of fields.values()) {
      field.inputs.forEach((input) => input.classList.remove("is-invalid"));
      field.feedback.textContent = "";
      field.feedback.hidden = true;
    }
    for (const problem of problems) {
      const field = fieldFor(problem.path);
      if (!field) continue;
      field.inputs.forEach((input) => input.classList.add("is-invalid"));
      field.feedback.textContent = field.feedback.textContent
        ? `${field.feedback.textContent} ${problem.message}` : problem.message;
      field.feedback.hidden = false;
    }
    $("content-error-count").textContent = problems.length ? `${problems.length} lỗi cần sửa` : "";
    $("content-error-count").hidden = !problems.length;
    return problems;
  }

  function changed() {
    state.dirty = true;
    state.viewingHistory = null;
    $("content-history-view").hidden = true;
    refreshValidation();
    setStatus();
    preview?.update(state.data);
  }

  // ---------- Ô nhập ----------

  function register(path, label, wrap, inputs, feedback) {
    fields.set(path, { label, wrap, inputs, feedback });
  }

  function unregisterPrefix(prefix) {
    for (const path of [...fields.keys()]) {
      if (path === prefix || path.startsWith(`${prefix}.`)) fields.delete(path);
    }
  }

  // Nhãn nhỏ cạnh tên ô: dùng làm gì nếu ô không hiện thành chữ trên thiệp, và ghi chú nếu có.
  function whereBadge(path) {
    const { tag, note } = whereOf(path);
    const parts = [];
    if (tag) {
      const badge = el("span", "content-where-badge", tag);
      badge.dataset.where = tag;
      parts.push(badge);
    }
    if (note) parts.push(el("span", "content-where-note", note));
    return parts;
  }

  function fieldShell(parent, label, hint, id, path) {
    const wrap = el("div", "content-field");
    const labelEl = el("label", "form-label", label);
    if (id) labelEl.htmlFor = id;
    const head = el("div", "content-field-head");
    head.append(labelEl, ...whereBadge(path));
    wrap.append(head);
    const body = el("div", "content-field-body");
    wrap.append(body);
    if (hint) wrap.append(el("div", "form-text", hint));
    const feedback = el("div", "invalid-feedback d-block");
    feedback.hidden = true;
    wrap.append(feedback);
    parent.append(wrap);
    return { wrap, body, feedback };
  }

  // Ô chữ. optional: bỏ trống -> xoá key (thiệp dùng mặc định); emptyValue: giá trị khi bỏ trống.
  function textField(parent, { path, label, hint, multiline = false, optional = false, emptyValue, rows = 3, placeholder }) {
    const id = nextId("f");
    const { wrap, body, feedback } = fieldShell(parent, label, hint, id, path);
    const input = multiline ? el("textarea", "form-control") : el("input", "form-control");
    if (multiline) input.rows = rows;
    else input.type = "text";
    input.id = id;
    input.dataset.path = path;
    if (placeholder) input.placeholder = placeholder;
    const value = getPath(state.data, path);
    input.value = typeof value === "string" ? value : "";
    input.addEventListener("input", () => {
      const v = input.value;
      if (v.trim() === "" && emptyValue !== undefined) setPath(state.data, path, emptyValue);
      else if (v.trim() === "" && optional) setPath(state.data, path, undefined);
      else setPath(state.data, path, v);
      changed();
    });
    body.append(input);
    register(path, label, wrap, [input], feedback);
    return input;
  }

  // Mảng chữ, mỗi dòng một phần tử (lời ngỏ).
  function linesField(parent, { path, label, hint }) {
    const id = nextId("f");
    const { wrap, body, feedback } = fieldShell(parent, label, hint, id, path);
    const input = el("textarea", "form-control");
    input.id = id;
    input.rows = 4;
    input.dataset.path = path;
    const value = getPath(state.data, path);
    input.value = Array.isArray(value) ? value.join("\n") : "";
    input.addEventListener("input", () => {
      setPath(state.data, path, input.value === "" ? [] : input.value.split("\n"));
      changed();
    });
    body.append(input);
    register(path, label, wrap, [input], feedback);
  }

  function dateField(parent, { path, label, hint, optional = false }) {
    const id = nextId("f");
    const { wrap, body, feedback } = fieldShell(parent, label, hint, id, path);
    const input = el("input", "form-control content-date");
    input.type = "date";
    input.id = id;
    input.dataset.path = path;
    const value = getPath(state.data, path);
    input.value = typeof value === "string" ? value.slice(0, 10) : "";
    input.addEventListener("input", () => {
      setPath(state.data, path, input.value === "" && optional ? undefined : input.value);
      changed();
    });
    body.append(input);
    register(path, label, wrap, [input], feedback);
  }

  // Ngày + giờ (giờ bỏ trống = cả ngày). Giây/múi giờ gốc được giữ, mặc định +07:00.
  function dateTimeField(parent, { path, label, hint, optional = false }) {
    const id = nextId("f");
    const { wrap, body, feedback } = fieldShell(parent, label, hint, id, path);
    const original = splitISO(getPath(state.data, path));
    const date = el("input", "form-control content-date");
    date.type = "date";
    date.id = id;
    date.dataset.path = path;
    date.value = original.date;
    const time = el("input", "form-control content-time");
    time.type = "time";
    time.value = original.time;
    time.setAttribute("aria-label", `${label} (giờ)`);
    const update = () => {
      const value = joinISO(date.value, time.value, original.rest);
      setPath(state.data, path, value === "" && optional ? undefined : value);
      changed();
    };
    date.addEventListener("input", update);
    time.addEventListener("input", update);
    const row = el("div", "content-datetime");
    row.append(date, time);
    body.append(row);
    register(path, label, wrap, [date, time], feedback);
  }

  function selectField(parent, { path, label, options }) {
    const id = nextId("f");
    const { wrap, body, feedback } = fieldShell(parent, label, "", id, path);
    const select = el("select", "form-select");
    select.id = id;
    select.dataset.path = path;
    for (const [value, text] of options) {
      const option = el("option", "", text);
      option.value = value;
      select.append(option);
    }
    select.value = getPath(state.data, path) ?? options[0][0];
    select.addEventListener("change", () => {
      setPath(state.data, path, select.value);
      changed();
    });
    body.append(select);
    register(path, label, wrap, [select], feedback);
  }

  // Danh sách màu trang phục: ô chọn màu + ô mã (#rgb / #rrggbb).
  function colorsField(parent, { path, label, hint }) {
    const { wrap, body, feedback } = fieldShell(parent, label, hint, undefined, path);
    register(path, label, wrap, [], feedback);
    const list = el("div", "content-colors");
    body.append(list);

    function colors() {
      const value = getPath(state.data, path);
      return Array.isArray(value) ? value : [];
    }
    function render() {
      unregisterPrefix(`${path}.`);
      list.replaceChildren();
      colors().forEach((color, i) => {
        const row = el("div", "content-color");
        const picker = el("input", "form-control form-control-color");
        picker.type = "color";
        picker.setAttribute("aria-label", `Màu ${i + 1}`);
        const text = el("input", "form-control form-control-sm content-color-code");
        text.type = "text";
        text.value = typeof color === "string" ? color : "";
        text.dataset.path = `${path}.${i}`;
        text.setAttribute("aria-label", `Mã màu ${i + 1}`);
        const syncPicker = () => {
          const v = text.value.trim();
          if (/^#[0-9a-f]{6}$/i.test(v)) picker.value = v;
          else if (/^#[0-9a-f]{3}$/i.test(v)) picker.value = `#${[...v.slice(1)].map((c) => c + c).join("")}`;
        };
        syncPicker();
        picker.addEventListener("input", () => {
          text.value = picker.value;
          colors()[i] = picker.value;
          changed();
        });
        text.addEventListener("input", () => {
          colors()[i] = text.value.trim();
          syncPicker();
          changed();
        });
        const remove = button("×", "btn-sm btn-outline-secondary", () => {
          colors().splice(i, 1);
          render();
          changed();
        });
        remove.setAttribute("aria-label", `Xoá màu ${i + 1}`);
        row.append(picker, text, remove);
        list.append(row);
        fields.set(`${path}.${i}`, { label: `${label} ${i + 1}`, wrap, inputs: [text], feedback });
      });
      list.append(button("+ Thêm màu", "btn-sm btn-outline-secondary", () => {
        if (!Array.isArray(getPath(state.data, path))) setPath(state.data, path, []);
        colors().push("#ffffff");
        render();
        changed();
      }));
    }
    render();
  }

  // Ô ảnh: hình thu nhỏ + đường dẫn (sửa tay được) + nút tải ảnh mới qua image-picker (cắt, thu nhỏ,
  // WebP, tải lên R2). variant: bản ảnh ghi vào ô ("small" hoặc "large").
  // set(value): ghi giá trị; mặc định setPath, bỏ trống thì xoá key nếu optional.
  function imageField(parent, { path, label, hint, kind, variant = "small", optional = false, set }) {
    const id = nextId("f");
    const { wrap, body, feedback } = fieldShell(parent, label, hint, id, path);
    const row = el("div", "content-image");
    const thumb = el("img", "content-thumb");
    thumb.alt = "";
    thumb.loading = "lazy";
    const side = el("div", "content-image-side");
    const input = el("input", "form-control form-control-sm");
    input.type = "text";
    input.id = id;
    input.dataset.path = path;
    input.placeholder = "Đường dẫn ảnh (https://… hoặc assets/…)";
    input.spellcheck = false;
    const value = getPath(state.data, path);
    input.value = typeof value === "string" ? value : "";

    const write = set || ((v) => setPath(state.data, path, v === "" && optional ? undefined : v));
    const showThumb = () => {
      const v = input.value.trim();
      thumb.hidden = !v;
      if (v) thumb.src = resolveUrl(v);
    };
    thumb.addEventListener("error", () => { thumb.hidden = true; });
    showThumb();
    input.addEventListener("input", () => {
      write(input.value.trim());
      showThumb();
      changed();
    });
    const pick = button("Tải ảnh mới…", "btn-sm btn-outline-secondary", () => openPicker({
      title: label,
      hint,
      kind,
      onUploaded: (result) => {
        input.value = result[variant];
        write(input.value);
        showThumb();
        changed();
      },
    }));
    pick.dataset.pickFor = path;
    side.append(input, pick);
    row.append(thumb, side);
    body.append(row);
    register(path, label, wrap, [input], feedback);
  }

  function urlField(parent, { path, label, hint, optional = false, emptyValue }) {
    const input = textField(parent, { path, label, hint, optional, emptyValue, placeholder: "https://…" });
    input.spellcheck = false;
    input.inputMode = "url";
    return input;
  }

  // ---------- Hộp chọn ảnh ----------

  function openPicker({ title, hint, kind, onUploaded }) {
    if (!pickerDialog) {
      pickerDialog = $("content-picker-dialog");
      pickerDialog.addEventListener("close", () => {
        activePicker?.destroy();
        activePicker = null;
      });
      pickerDialog.querySelector("[data-dialog-close]").addEventListener("click", () => pickerDialog.close());
    }
    $("content-picker-title").textContent = title;
    $("content-picker-hint").textContent = [hint, "Ảnh được cắt theo khung, thu nhỏ và đổi sang WebP ngay trên máy trước khi tải lên."]
      .filter(Boolean).join(" ");
    const body = $("content-picker-body");
    body.replaceChildren();
    activePicker = createImagePicker({
      container: body,
      getIdToken,
      kind,
      onUploaded: (result) => {
        onUploaded(result);
        pickerDialog.close();
      },
    });
    pickerDialog.showModal();
  }

  // ---------- Các mục ----------

  function sectionCard(parent, key, { open = false } = {}) {
    const info = SECTIONS[key];
    const card = el("details", "content-section");
    card.dataset.section = key;
    if (open) card.open = true;
    const summary = el("summary", "content-section-head");
    summary.append(el("span", "content-section-title", info.title));
    card.append(summary);
    const where = el("div", "content-where");
    where.append(el("span", "content-where-text", info.where));
    const look = button("Xem phần này", "btn-sm btn-link p-0 content-look", () => showInPreview(key));
    where.append(look);
    card.append(where);
    const body = el("div", "content-section-body");
    card.append(body);
    card.addEventListener("toggle", () => {
      if (card.open) followSection(key);
    });
    // Sửa ô nào thì bản xem trước cuộn tới phần đó trên thiệp.
    card.addEventListener("focusin", () => followSection(key));
    parent.append(card);
    return body;
  }

  function group(parent, title) {
    const box = el("div", "content-group");
    if (title) box.append(el("h4", "content-group-title", title));
    parent.append(box);
    return box;
  }

  function renderMeta(parent) {
    const body = sectionCard(parent, "meta");
    textField(body, { path: "meta.title", label: "Tiêu đề", hint: "Chỉ đổi tên tab trình duyệt. Tiêu đề khi gửi link qua Zalo, Facebook, Messenger, Telegram, X là chữ cố định trong code." });
    textField(body, { path: "meta.description", label: "Mô tả", multiline: true, rows: 2, hint: "Không hiện ở đâu cả. Mô tả khi gửi link qua Zalo, Facebook, Messenger, Telegram, X là chữ cố định trong code." });
    imageField(body, { path: "meta.previewImage", label: "Ảnh khi gửi link", kind: "album", variant: "large", hint: "Không đổi khung xem trước khi gửi link: Zalo, Facebook, Messenger, Telegram, X dùng ảnh cố định trong code. Ô này chỉ là ảnh dự phòng của thiệp." });
    imageField(body, { path: "meta.favicon", label: "Biểu tượng tab", kind: "qr", variant: "small", hint: "Hình vuông nhỏ cạnh tiêu đề trên tab trình duyệt." });
  }

  function renderCouple(parent) {
    const body = sectionCard(parent, "couple");
    for (const [side, name] of SIDES) {
      const box = group(body, name);
      const p = `couple.${side}`;
      textField(box, { path: `${p}.shortName`, label: `Tên ngắn ${name.toLowerCase()} *`, hint: "Bắt buộc. Tên lớn trên ảnh bìa và phong bì." });
      textField(box, { path: `${p}.fullName`, label: "Họ và tên", hint: "Bỏ trống thì dùng tên ngắn." });
      textField(box, { path: `${p}.father`, label: "Bố" });
      textField(box, { path: `${p}.mother`, label: "Mẹ" });
      textField(box, { path: `${p}.address`, label: "Địa chỉ gia đình", optional: true });
    }
  }

  // coverImages là mảng 3 URL (ô trống = lấy từ ảnh “Hiện ở Album”); cả 3 trống thì bỏ field.
  function setCover(index, value) {
    const current = Array.isArray(state.data.wedding.coverImages) ? [...state.data.wedding.coverImages] : [];
    while (current.length < 3) current.push("");
    current[index] = value;
    while (current.length && !current[current.length - 1]) current.pop();
    setPath(state.data, "wedding.coverImages", current.length ? current : undefined);
  }

  function renderWedding(parent) {
    const body = sectionCard(parent, "wedding");
    if (!state.data.wedding || typeof state.data.wedding !== "object") state.data.wedding = {};
    const date = group(body, "Ngày cưới");
    dateField(date, { path: "wedding.dateISO", label: "Ngày cưới *", hint: "Bắt buộc. Lịch tháng và đồng hồ đếm ngược tính theo ngày này." });
    dateField(date, { path: "wedding.rsvpDeadline", label: "Hạn xác nhận tham dự", optional: true, hint: "Tuỳ chọn: câu “Vui lòng phản hồi trước…”. Bỏ trống để ẩn." });

    const images = group(body, "Ảnh");
    imageField(images, { path: "wedding.mainImage", label: "Ảnh bìa", kind: "cover", variant: "large", hint: "Ảnh bìa trên cùng sau khi mở phong bì. Khung dọc 2:3." });
    imageField(images, { path: "wedding.invitationImage", label: "Ảnh lời ngỏ", kind: "cover", variant: "large", hint: "Ảnh polaroid ở phần đếm ngược. Khung dọc 2:3." });
    imageField(images, { path: "wedding.envelopeImage", label: "Ảnh trong phong bì", kind: "cover", variant: "large", optional: true, hint: "Tuỳ chọn: ảnh lộ ra khi mở phong bì. Bỏ trống thì dùng ảnh bìa." });
    ["Ảnh lớn", "Ảnh nhỏ trái", "Ảnh nhỏ phải"].forEach((name, i) => imageField(images, coverSpec(name, i)));

    const texts = group(body, "Lời ngỏ & lời cảm ơn");
    linesField(texts, { path: "wedding.invitationText", label: "Lời ngỏ", hint: "Mỗi dòng là một đoạn." });
    textField(texts, { path: "wedding.introText", label: "Câu dẫn", multiline: true, rows: 2, optional: true, hint: "Tuỳ chọn: câu ngay trên đồng hồ đếm ngược. Bỏ trống thì hiện lời ngỏ (mục Lời ngỏ); không có lời ngỏ thì dùng câu mặc định." });
    textField(texts, { path: "wedding.thanksText", label: "Lời cảm ơn", multiline: true, rows: 2, optional: true, hint: "Tuỳ chọn: câu dưới chữ “Thank you” cuối thiệp. Bỏ trống thì dùng câu mặc định." });
  }

  function coverSpec(name, i) {
    return {
      path: `wedding.coverImages.${i}`,
      label: `“With you”: ${name.toLowerCase()}`,
      kind: "album",
      variant: i === 0 ? "large" : "small",
      hint: i === 0 ? "Tuỳ chọn: ba ảnh mục “With you”. Bỏ trống thì lấy từ ảnh “Hiện ở Album” của album." : "",
      set: (v) => setCover(i, v),
    };
  }

  function renderEvents(parent) {
    const body = sectionCard(parent, "events");
    const events = Array.isArray(state.data.events) ? state.data.events : [];
    if (!events.length) body.append(el("p", "small text-secondary mb-0", "Chưa có sự kiện nào."));
    events.forEach((event, i) => {
      const p = `events.${i}`;
      const box = group(body, `${event.title || "Sự kiện"} · mã ${event.key || "?"}`);
      textField(box, { path: `${p}.title`, label: "Tên sự kiện *" });
      selectField(box, { path: `${p}.side`, label: "Nhà", options: [["groom", "Nhà trai"], ["bride", "Nhà gái"]] });
      dateTimeField(box, { path: `${p}.startISO`, label: "Bắt đầu *", hint: "Bỏ trống giờ nếu chưa có giờ (lịch thành cả ngày)." });
      dateTimeField(box, { path: `${p}.endISO`, label: "Kết thúc", optional: true });
      textField(box, { path: `${p}.lunarText`, label: "Ngày âm lịch" });
      textField(box, { path: `${p}.venue`, label: "Địa điểm" });
      textField(box, { path: `${p}.address`, label: "Địa chỉ" });
      urlField(box, { path: `${p}.mapUrl`, label: "Link bản đồ", hint: "Nút “Chỉ đường” mở link này (Google Maps…)." });
      textField(box, { path: `${p}.note`, label: "Ghi chú", optional: true, hint: "Tuỳ chọn: dòng nhỏ dưới sự kiện." });
      colorsField(box, { path: `${p}.dressCode`, label: "Màu trang phục", hint: "Chấm màu gợi ý trang phục (Dresscode). Mã dạng #rgb hoặc #rrggbb." });
    });
  }

  // Danh sách có thêm/xoá/đổi thứ tự (chuyện tình, album): vẽ lại cả danh sách khi đổi cấu trúc.
  function listControls(items, index, rerender) {
    const bar = el("div", "content-item-actions");
    const up = button("↑", "btn-sm btn-outline-secondary", () => {
      [items[index - 1], items[index]] = [items[index], items[index - 1]];
      rerender();
      changed();
    });
    up.disabled = index === 0;
    up.setAttribute("aria-label", "Lên trên");
    const down = button("↓", "btn-sm btn-outline-secondary", () => {
      [items[index + 1], items[index]] = [items[index], items[index + 1]];
      rerender();
      changed();
    });
    down.disabled = index === items.length - 1;
    down.setAttribute("aria-label", "Xuống dưới");
    const remove = button("Xoá", "btn-sm btn-outline-danger", () => {
      if (!confirm("Xoá mục này khỏi thiệp?")) return;
      items.splice(index, 1);
      rerender();
      changed();
    });
    bar.append(up, down, remove);
    return bar;
  }

  function renderStory(parent) {
    const body = sectionCard(parent, "story");
    const list = el("div", "content-list");
    body.append(list);
    const rerender = () => {
      unregisterPrefix("story");
      list.replaceChildren();
      if (!Array.isArray(state.data.story)) state.data.story = [];
      const items = state.data.story;
      items.forEach((item, i) => {
        const p = `story.${i}`;
        const box = group(list, `Mốc ${i + 1}`);
        box.append(listControls(items, i, rerender));
        textField(box, { path: `${p}.date`, label: "Ngày" });
        textField(box, { path: `${p}.title`, label: "Tiêu đề" });
        textField(box, { path: `${p}.text`, label: "Đoạn kể", multiline: true });
        imageField(box, { path: `${p}.image`, label: "Ảnh", kind: "story", variant: "small", hint: "Khung dọc 2:3." });
      });
      list.append(button("+ Thêm mốc", "btn-sm btn-outline-secondary", () => {
        items.push({ date: "", title: "", text: "", image: "" });
        rerender();
        changed();
      }));
      refreshValidation();
    };
    rerender();
  }

  function renderGallery(parent) {
    const body = sectionCard(parent, "gallery");
    const list = el("div", "content-gallery");
    const add = button("+ Thêm ảnh vào album…", "btn-sm btn-rose", () => openPicker({
      title: "Thêm ảnh album",
      hint: "Ảnh mới thêm vào cuối album; đánh dấu “Hiện ở Album” để ảnh lên băng ảnh mục Album.",
      kind: "album",
      onUploaded: (result) => {
        state.data.gallery.push({ small: result.small, large: result.large });
        rerender();
        changed();
      },
    }));
    body.append(el("p", "small text-secondary", "Ảnh album giữ nguyên tỉ lệ gốc; máy tự tạo bản nhỏ (băng ảnh Album) và bản lớn (khi mở ảnh)."), list, add);
    // Ô "Hiện ở Album" tick đúng ảnh băng Album đang hiện (albumShown); tick/bỏ tick ghi featuredV2 qua
    // setAlbumShown rồi vẽ lại mọi ô và dòng đếm. Bỏ tick ảnh cuối cùng bị chặn, báo lý do ngay dưới dòng đếm.
    const syncAlbum = (message = "") => {
      const shown = new Set(albumShown(state.data.gallery));
      for (const input of list.querySelectorAll("input[data-album-index]")) {
        input.checked = shown.has(Number(input.dataset.albumIndex));
      }
      const count = $("content-gallery-count");
      if (count) count.textContent = galleryCountText(state.data.gallery);
      const note = $("content-gallery-note");
      if (note) {
        note.textContent = message;
        note.hidden = !message;
      }
    };
    list.addEventListener("change", (event) => {
      const input = event.target.closest("input[data-album-index]");
      if (!input) return;
      if (!setAlbumShown(state.data.gallery, Number(input.dataset.albumIndex), input.checked)) {
        syncAlbum("Băng ảnh Album cần ít nhất 1 ảnh: tick ảnh khác trước rồi mới bỏ ảnh này.");
        return;
      }
      syncAlbum();
      changed();
    });
    const rerender = () => {
      unregisterPrefix("gallery");
      list.replaceChildren();
      if (!Array.isArray(state.data.gallery)) state.data.gallery = [];
      const items = state.data.gallery;
      $("content-gallery-count")?.remove();
      $("content-gallery-note")?.remove();
      const count = el("div", "small text-secondary mb-2", galleryCountText(items));
      count.id = "content-gallery-count";
      const note = el("div", "small text-warning-emphasis mb-2");
      note.id = "content-gallery-note";
      note.setAttribute("role", "status");
      note.hidden = true;
      list.before(count, note);
      const shown = new Set(albumShown(items));
      items.forEach((item, i) => {
        const p = `gallery.${i}`;
        const box = el("div", "content-gallery-item");
        box.dataset.index = String(i);
        const img = el("img", "content-gallery-thumb");
        img.alt = `Ảnh ${i + 1}`;
        img.loading = "lazy";
        img.src = resolveUrl(item.small || item.large || "");
        box.append(img);
        const fieldsBox = el("div", "content-gallery-fields");
        const check = el("div", "form-check");
        const input = el("input", "form-check-input");
        input.type = "checkbox";
        input.id = nextId("c");
        input.dataset.albumIndex = String(i);
        input.checked = shown.has(i);
        const checkLabel = el("label", "form-check-label", "Hiện ở Album");
        checkLabel.htmlFor = input.id;
        check.append(input, checkLabel);
        fieldsBox.append(check);
        textField(fieldsBox, { path: `${p}.caption`, label: "Chú thích", optional: true });
        const details = el("details", "content-gallery-urls");
        details.append(el("summary", "small", "Đường dẫn ảnh"));
        textField(details, { path: `${p}.small`, label: "Bản nhỏ" });
        textField(details, { path: `${p}.large`, label: "Bản lớn" });
        // Thay ảnh tại chỗ: cùng hộp chọn/cắt/tải như "Thêm ảnh vào album…"; huỷ hay tải lỗi thì ảnh cũ giữ nguyên.
        const replace = button("Thay ảnh…", "btn-sm btn-outline-secondary", () => openPicker({
          title: `Thay ảnh ${i + 1} của album`,
          hint: "Ảnh mới thay đúng vị trí này; ô “Hiện ở Album” và chú thích giữ nguyên.",
          kind: "album",
          onUploaded: (result) => {
            if (!replaceGalleryImage(state.data.gallery, item, result)) return;
            rerender();
            changed();
          },
        }));
        replace.dataset.replaceFor = p;
        fieldsBox.append(replace, details, listControls(items, i, rerender));
        box.append(fieldsBox);
        list.append(box);
      });
      refreshValidation();
    };
    rerender();
  }

  function renderDonate(parent) {
    const body = sectionCard(parent, "donate");
    for (const [side, name] of SIDES) {
      const box = group(body, `Mừng cưới ${name.toLowerCase()}`);
      const p = `donate.${side}`;
      textField(box, { path: `${p}.bank`, label: "Ngân hàng" });
      textField(box, { path: `${p}.accountName`, label: "Tên tài khoản" });
      textField(box, { path: `${p}.accountNumber`, label: "Số tài khoản" });
      textField(box, { path: `${p}.branch`, label: "Chi nhánh", optional: true });
      imageField(box, { path: `${p}.qr`, label: "Mã QR", kind: "qr", variant: "large", hint: "Ảnh vuông, nén nhẹ để vẫn quét được." });
    }
  }

  function renderMusic(parent) {
    const body = sectionCard(parent, "music");
    textField(body, { path: "music.title", label: "Tên bài hát" });
    const input = urlField(body, { path: "music.src", label: "File nhạc", hint: "Đường dẫn file nhạc, hoặc tải file lên bên dưới." });
    const player = el("audio", "content-audio");
    player.controls = true;
    player.preload = "none";
    const setPlayer = () => {
      const v = input.value.trim();
      player.hidden = !v;
      if (v) player.src = resolveUrl(v);
    };
    setPlayer();
    input.addEventListener("input", setPlayer);

    const upload = el("div", "content-audio-upload");
    const file = el("input", "form-control form-control-sm");
    file.type = "file";
    file.accept = "audio/mpeg,audio/mp4,audio/x-m4a,.mp3,.m4a";
    file.setAttribute("aria-label", "Chọn file nhạc");
    const status = el("div", "small text-secondary");
    status.setAttribute("aria-live", "polite");
    file.addEventListener("change", async () => {
      const chosen = file.files[0];
      if (!chosen) return;
      const ext = AUDIO_TYPES[chosen.type] || (/\.mp3$/i.test(chosen.name) ? "mp3" : /\.m4a$/i.test(chosen.name) ? "m4a" : "");
      if (!ext) {
        status.textContent = "Chỉ nhận file MP3 hoặc M4A.";
        file.value = "";
        return;
      }
      if (chosen.size > MAX_AUDIO_BYTES) {
        status.textContent = "File nhạc tối đa 10 MB.";
        file.value = "";
        return;
      }
      file.disabled = true;
      status.textContent = "Đang tải nhạc lên…";
      try {
        const blob = new Blob([chosen], { type: ext === "mp3" ? "audio/mpeg" : "audio/mp4" });
        const url = await uploadToWorker(blob, `content/${crypto.randomUUID()}.${ext}`, { getIdToken });
        input.value = url;
        setPath(state.data, "music.src", url);
        setPlayer();
        changed();
        status.textContent = "Đã tải nhạc lên.";
      } catch (error) {
        status.textContent = `Không tải được nhạc: ${error.message}`;
      } finally {
        file.disabled = false;
        file.value = "";
      }
    });
    upload.append(file, status);
    body.append(player, upload);
  }

  function renderForm() {
    fields.clear();
    const form = $("content-form");
    form.replaceChildren();
    for (const key of ["meta", "couple", "wedding", "events", "story", "gallery", "donate", "music"]) {
      if (state.data[key] == null || typeof state.data[key] !== "object") {
        state.data[key] = ["events", "story", "gallery"].includes(key) ? [] : {};
      }
    }
    renderCouple(form);
    renderWedding(form);
    renderEvents(form);
    renderStory(form);
    renderGallery(form);
    renderDonate(form);
    renderMusic(form);
    renderMeta(form);
    form.querySelector("details.content-section")?.setAttribute("open", "");
    refreshValidation();
  }

  // ---------- Xem trước ----------

  function showInPreview(key) {
    if (!preview) return;
    $("content-preview-pane").classList.add("is-open");
    if (preview.canScroll) lastFollowed = key;
    preview.scrollTo(key);
  }

  // Khung xem trước chưa cuộn được (chưa vẽ xong lần đầu, hoặc lớp xem trước trên điện thoại đang đóng)
  // thì chỉ nhớ mục đang sửa, chưa ghi nhận đã cuộn: lần focus sau trong cùng mục, hay lúc mở lớp xem
  // trước, vẫn cuộn tới mục đó (mục mở sẵn khi vào trang báo toggle lúc khung còn trống).
  let editingSection = null;
  let lastFollowed = null;
  function followSection(key) {
    editingSection = key;
    if (!preview || !preview.canScroll || key === lastFollowed) return;
    lastFollowed = key;
    preview.scrollTo(key);
  }

  function previewState({ state: s, source, message }) {
    const label = $("content-preview-state");
    if (s === "loading") label.textContent = "Đang vẽ lại…";
    else if (s === "error") label.textContent = message;
    else if (source === "fallback") label.textContent = "Nội dung còn lỗi bắt buộc: thiệp sẽ hiện nội dung dự phòng.";
    else label.textContent = s === "slow" ? "Thiệp tải chậm." : "Đã cập nhật.";
    label.dataset.state = s;
    label.dataset.source = source || "";
  }

  // ---------- Lưu / xuất bản / lịch sử ----------

  function blockIfInvalid(action) {
    const problems = refreshValidation();
    if (!problems.length) return false;
    showAlert(`Chưa ${action}: còn ${problems.length} lỗi cần sửa.`, "danger", problems);
    return true;
  }

  // action: "save" | "publish" | "restore" | "open", để báo đúng thao tác nào bị chặn khi bản xuất bản đã đổi.
  async function withBusy(run, action) {
    if (state.busy) return;
    state.busy = true;
    for (const b of document.querySelectorAll("[data-content-action]")) b.disabled = true;
    try {
      await run();
    } catch (error) {
      console.warn("Nội dung thiệp: thao tác thất bại", error);
      if (error && error.code === "content/stale-published") {
        // Dòng "Khách đang thấy" phải nói đúng bản mới; không đụng state.basePublished.
        await refreshMeta();
        setStatus();
        showConflict(action, error.published);
      } else {
        showAlert(error && error.code === "permission-denied"
          ? "Không có quyền thực hiện thao tác này."
          : `Có lỗi xảy ra: ${error.message || error}`);
      }
    } finally {
      state.busy = false;
      for (const b of document.querySelectorAll("[data-content-action]")) b.disabled = false;
    }
  }

  // ---------- Bản xuất bản đã đổi: không ghi đè im lặng, người dùng tự chọn ----------
  // Nội dung đang sửa dựa trên một bản xuất bản cũ hơn bản khách đang thấy (published). Lưu nháp /
  // xuất bản / khôi phục đều bị chặn (state.basePublished khác bản trên máy chủ) cho tới khi chọn:
  //   - Mở bản đang xuất bản: bỏ nội dung đang sửa, sửa tiếp trên bản mới (an toàn, không ghi gì);
  //   - Giữ bản của tôi: hỏi lại, rồi lấy bản mới làm mốc, lần Lưu nháp / Xuất bản sau sẽ thay nó.
  const BLOCKED_ACTION = { save: "Chưa lưu nháp", publish: "Chưa xuất bản", restore: "Chưa khôi phục" };

  function describePublished(published) {
    return published
      ? `${shortEmail(published.updatedBy) || "?"} xuất bản lúc ${formatTime(published.updatedAt) || "?"}`
      : "bản xuất bản không đọc được";
  }

  function showConflict(action, published, draft) {
    const text = action === "load"
      ? `Bản nháp này (lưu ${formatTime(draft?.updatedAt)} bởi ${shortEmail(draft?.updatedBy)}) cũ hơn bản khách đang thấy (${describePublished(published)}): nháp được soạn trên một bản xuất bản cũ. Lưu hay xuất bản nháp này sẽ xoá các thay đổi trong bản mới.`
      : `${BLOCKED_ACTION[action] || "Chưa ghi"}: bản khách đang thấy vừa bị người khác thay đổi (${describePublished(published)}). Nội dung bạn đang sửa được soạn trên bản cũ hơn; ghi nó lên sẽ xoá các thay đổi đó.`;
    showAlert(text, "warning");
    const box = $("content-alert");
    const actions = el("div", "content-conflict-actions");
    actions.append(button("Mở bản đang xuất bản", "btn-sm btn-rose", () => openPublished()));
    if (published && preview) {
      actions.append(button("Xem bản đang xuất bản", "btn-sm btn-outline-secondary", () => {
        state.viewingHistory = published;
        $("content-history-view-text").textContent = `Đang xem bản khách đang thấy (${describePublished(published)}). Thay đổi trong ô nhập sẽ quay lại bản đang sửa.`;
        $("content-history-view").hidden = false;
        $("content-preview-pane").classList.add("is-open");
        preview.update(published.data, { immediate: true });
      }));
    }
    actions.append(button("Giữ bản của tôi", "btn-sm btn-outline-danger", () => keepMine(published)));
    box.append(actions, el("div", "content-conflict-hint",
      "Mở bản đang xuất bản: bỏ nội dung đang có trong trình sửa, sửa tiếp trên bản mới. "
      + "Giữ bản của tôi: lần Lưu nháp / Xuất bản sau sẽ thay bản kia (khi xuất bản, bản kia vẫn còn trong Lịch sử)."));
  }

  function openPublished() {
    if (!confirm("Mở bản khách đang thấy để sửa tiếp? Nội dung đang có trong trình sửa sẽ bị bỏ (nháp trên máy chủ chỉ bị thay khi bạn Lưu nháp hoặc Xuất bản).")) return;
    hideAlert();
    return withBusy(async () => {
      const loaded = await store.load({ fromPublished: true });
      state.data = loaded.data;
      state.origin = loaded.origin;
      state.meta = { draft: loaded.draft, published: loaded.published };
      state.basePublished = loaded.published ? loaded.published.updatedAt ?? null : null;
      state.dirty = false;
      state.viewingHistory = null;
      $("content-history-view").hidden = true;
      renderForm();
      setStatus();
      preview?.update(state.data, { immediate: true });
      showAlert(loaded.published
        ? `Đã mở bản khách đang thấy (${describePublished(loaded.published)}). Nháp trên máy chủ chỉ bị thay khi bạn Lưu nháp hoặc Xuất bản.`
        : "Chưa có bản xuất bản nào: đang sửa bản nháp trên máy chủ.", "success");
    }, "open");
  }

  function keepMine(published) {
    if (!confirm(`Giữ nội dung bạn đang sửa? Lần Lưu nháp / Xuất bản sau sẽ thay bản ${describePublished(published)}. Khi xuất bản, bản đó vẫn còn trong Lịch sử.`)) return;
    state.basePublished = published ? published.updatedAt ?? null : null;
    showAlert(`Đã giữ bản của bạn. Bấm Lưu nháp hoặc Xuất bản để ghi; bản ${describePublished(published)} sẽ bị thay.`, "warning");
  }

  // Làm mới dòng trạng thái (nháp/bản khách đang thấy). Không đụng state.basePublished.
  // Thao tác chính đã thành công thì lỗi ở bước này chỉ ghi chú thêm, không báo như thao tác hỏng.
  async function refreshMeta() {
    try {
      const loaded = await store.load();
      state.meta = { draft: loaded.draft, published: loaded.published };
      return true;
    } catch (error) {
      console.warn("Không làm mới được trạng thái nội dung", error);
      return false;
    }
  }

  const REFRESH_NOTE = " (Chưa làm mới được dòng trạng thái; tải lại trang để xem.)";

  function saveDraft() {
    hideAlert();
    if (blockIfInvalid("lưu nháp")) return;
    return withBusy(async () => {
      await store.saveDraft(state.data, state.basePublished);
      state.dirty = false;
      state.origin = "draft";
      const refreshed = await refreshMeta();
      setStatus();
      showAlert(`Đã lưu nháp. Khách chưa thấy thay đổi cho tới khi xuất bản.${refreshed ? "" : REFRESH_NOTE}`, "success");
    }, "save");
  }

  function publish() {
    hideAlert();
    if (blockIfInvalid("xuất bản")) return;
    if (!confirm("Xuất bản nội dung này? Khách mở thiệp sẽ thấy ngay. Bản đang xuất bản được giữ trong Lịch sử.")) return;
    return withBusy(async () => {
      state.basePublished = await store.publish(state.data, state.basePublished);
      state.dirty = false;
      state.origin = "draft";
      const refreshed = await refreshMeta();
      setStatus();
      showAlert(`Đã xuất bản. Khách mở thiệp sẽ thấy nội dung mới.${refreshed ? "" : REFRESH_NOTE}`, "success");
    }, "publish");
  }

  async function openHistory() {
    const dialog = $("content-history-dialog");
    const list = $("content-history-list");
    list.replaceChildren(el("p", "small text-secondary mb-0", "Đang tải…"));
    if (!dialog.open) dialog.showModal();
    try {
      const items = await store.listHistory();
      list.replaceChildren();
      if (!items.length) {
        list.append(el("p", "small text-secondary mb-0", "Chưa có bản cũ nào. Mỗi lần xuất bản, bản khách đang thấy được lưu vào đây."));
        return;
      }
      for (const item of items) {
        const row = el("div", "request-item content-history-item");
        row.dataset.id = item.id;
        const info = el("div", "request-info");
        const data = item.data || {};
        const names = [data.couple?.groom?.shortName, data.couple?.bride?.shortName].filter(Boolean).join(" & ");
        info.append(el("div", "name", `Bản xuất bản ${formatTime(item.publishedAt) || "?"}`));
        info.append(el("div", "meta", `${names || "?"} · thay bởi ${shortEmail(item.publishedBy)}`));
        const actions = el("div", "request-actions");
        actions.append(
          button("Xem trước", "btn-sm btn-outline-secondary", () => {
            dialog.close();
            state.viewingHistory = item;
            $("content-history-view-text").textContent = `Đang xem bản ${formatTime(item.publishedAt)}. Thay đổi trong ô nhập sẽ quay lại bản đang sửa.`;
            $("content-history-view").hidden = false;
            $("content-preview-pane").classList.add("is-open");
            preview.update(item.data, { immediate: true });
          }),
          button("Khôi phục", "btn-sm btn-rose", () => restore(item, dialog)),
        );
        row.append(info, actions);
        list.append(row);
      }
    } catch (error) {
      list.replaceChildren(el("p", "small text-danger mb-0", `Không tải được lịch sử: ${error.message}`));
    }
  }

  function restore(item, dialog) {
    if (state.dirty && !confirm("Bản đang sửa có thay đổi chưa lưu, khôi phục sẽ bỏ các thay đổi đó. Tiếp tục?")) return;
    if (!confirm(`Khôi phục và xuất bản lại bản ${formatTime(item.publishedAt)}? Bản khách đang thấy được giữ trong Lịch sử.`)) return;
    dialog.close();
    return withBusy(async () => {
      const restored = await store.restore(item.id, state.basePublished);
      state.data = restored.data;
      state.basePublished = restored.publishedStamp;
      state.dirty = false;
      state.origin = "draft";
      state.viewingHistory = null;
      $("content-history-view").hidden = true;
      const refreshed = await refreshMeta();
      renderForm();
      setStatus();
      preview.update(state.data, { immediate: true });
      showAlert(`Đã khôi phục bản ${formatTime(item.publishedAt)} và xuất bản lại.${refreshed ? "" : REFRESH_NOTE}`, "success");
    }, "restore");
  }

  // ---------- Vòng đời mục ----------

  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    $("btn-content-save").addEventListener("click", saveDraft);
    $("btn-content-publish").addEventListener("click", publish);
    $("btn-content-history").addEventListener("click", openHistory);
    $("btn-content-preview").addEventListener("click", () => {
      $("content-preview-pane").classList.add("is-open");
      lastFollowed = null;
      if (editingSection) followSection(editingSection);
    });
    $("btn-content-preview-close").addEventListener("click", () => $("content-preview-pane").classList.remove("is-open"));
    $("btn-content-history-back").addEventListener("click", () => {
      state.viewingHistory = null;
      $("content-history-view").hidden = true;
      preview.update(state.data, { immediate: true });
    });
    // Khung xem trước dính ngay dưới thanh công cụ (cao thay đổi theo số dòng trạng thái).
    const toolbar = $("content-toolbar");
    new ResizeObserver(() => {
      toolbar.parentElement.style.setProperty("--content-toolbar-h", `${toolbar.offsetHeight}px`);
    }).observe(toolbar);
    const historyDialog = $("content-history-dialog");
    historyDialog.querySelector("[data-dialog-close]").addEventListener("click", () => historyDialog.close());
    window.addEventListener("beforeunload", (event) => {
      if (state.dirty) event.preventDefault();
    });
  }

  async function load() {
    if (state.loaded || state.loading) return;
    state.loading = true;
    wire();
    $("content-form").replaceChildren(el("p", "text-secondary", "Đang tải nội dung…"));
    try {
      const loaded = await store.load();
      state.data = loaded.data;
      state.origin = loaded.origin;
      state.meta = { draft: loaded.draft, published: loaded.published };
      // Nháp soạn trên bản xuất bản cũ: chưa có mốc nào đúng, mọi lần ghi bị chặn tới khi người dùng chọn.
      state.basePublished = loaded.draftBehind
        ? UNKNOWN_PUBLISHED
        : loaded.published ? loaded.published.updatedAt ?? null : null;
      state.dirty = false;
      state.loaded = true;
      renderForm();
      setStatus();
      preview = preview || createPreview({ container: $("content-preview-frames"), onState: previewState });
      preview.update(state.data, { immediate: true });
      if (loaded.draftBehind) showConflict("load", loaded.published, loaded.draft);
    } catch (error) {
      console.warn("Không tải được nội dung thiệp", error);
      $("content-form").replaceChildren();
      showAlert(error && error.code === "permission-denied"
        ? "Tài khoản này không có quyền sửa nội dung thiệp."
        : `Không tải được nội dung thiệp: ${error.message}`);
    } finally {
      state.loading = false;
    }
  }

  return {
    // Gọi khi mở mục: tải nội dung và vẽ xem trước lần đầu.
    activate: load,
    stop() {
      preview?.clear();
      preview = null;
      lastFollowed = null;
      fields.clear();
      Object.assign(state, { data: null, loaded: false, dirty: false, origin: null, viewingHistory: null, basePublished: null });
      if (document.getElementById("content-form")) $("content-form").replaceChildren();
    },
  };
}
