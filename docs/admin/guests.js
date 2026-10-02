// Mục Khách mời: thêm/sửa/xoá khách, lọc, copy link thiệp riêng, nhập từ Excel/CSV.
// Doc guests/{code} theo hợp đồng C5 trong CLAUDE.md; rules không validate shape khi admin ghi
// nên mọi kiểm tra shape nằm ở đây.
import {
  doc, setDoc, updateDoc, deleteDoc, deleteField, collection, onSnapshot,
  serverTimestamp, runTransaction,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { fold, validateRow, checkGuestFields, readGuestFile, downloadTemplate } from "./guest-import.js";

// [a-z2-9] bỏ "l" và "o" cho dễ đọc: đúng 32 ký tự nên byte % 32 không lệch.
const CODE_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 8;
const CODE_ATTEMPTS = 5;
const IMPORT_CHUNK = 200;
const NO_GROUP = "__none__";
const SIDE_LABEL = { groom: "Nhà trai", bride: "Nhà gái" };

const EVENTS = (window.WEDDING_DATA && Array.isArray(window.WEDDING_DATA.events))
  ? window.WEDDING_DATA.events.filter((e) => e && e.key)
  : [];

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showMessage(node, text, kind = "danger") {
  node.textContent = text;
  node.className = `${node.className.replace(/\balert-\w+\b/g, "").trim()} alert-${kind}`;
  node.hidden = !text;
}

function errorText(error) {
  if (error && error.code === "permission-denied") return "Không có quyền thực hiện thao tác này.";
  if (error && error.code === "unavailable") return "Không kết nối được. Kiểm tra mạng rồi thử lại.";
  return (error && error.message) || "Có lỗi xảy ra. Vui lòng thử lại.";
}

// "UỐNG NƯỚC, ĂN CỖ NHÀ TRAI" → "Uống nước, ăn cỗ nhà trai"
function eventLabel(event) {
  const text = String(event.title || event.key).toLocaleLowerCase("vi");
  return text.charAt(0).toLocaleUpperCase("vi") + text.slice(1);
}

function eventsSummary(keys) {
  const list = Array.isArray(keys) ? keys : [];
  if (EVENTS.length && EVENTS.every((e) => list.includes(e.key))) return "Tất cả sự kiện";
  return list.map((k) => {
    const event = EVENTS.find((e) => e.key === k);
    return event ? eventLabel(event) : k;
  }).join(", ") || "Chưa chọn sự kiện";
}

function greeting(guest) {
  return [guest.salutation, guest.name].filter(Boolean).join(" ");
}

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

// Link thiệp riêng: gốc site tính từ vị trí trang quản lý (…/admin/ → …/), đổi tên miền không phải sửa code.
export function guestLink(code) {
  const base = new URL("../", location.origin + location.pathname);
  return `${base.href}?code=${code}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Trình duyệt chặn Clipboard API (http, webview): chép bằng ô ẩn.
    const area = Object.assign(document.createElement("textarea"), { value: text, readOnly: true });
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

let toastTimer = null;
function toast(text) {
  const node = $("toast");
  node.textContent = text;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 2500);
}

export function createGuestsSection({ db, getUser }) {
  const guestsRef = collection(db, "guests");
  const state = { guests: [], unsubscribe: null, editing: null, importRows: null };

  // ---------- Danh sách ----------

  function start() {
    if (state.unsubscribe) return;
    state.unsubscribe = onSnapshot(
      guestsRef,
      (snapshot) => {
        showMessage($("guest-error"), "");
        state.guests = snapshot.docs.map((d) => ({ code: d.id, ...d.data() }));
        state.guests.sort((a, b) => (a.name || "").localeCompare(b.name || "", "vi"));
        renderGroupOptions();
        renderList();
      },
      (error) => showMessage($("guest-error"), `Không tải được danh sách khách: ${errorText(error)}`),
    );
  }

  function stop() {
    if (state.unsubscribe) state.unsubscribe();
    state.unsubscribe = null;
    state.guests = [];
    if ($("guest-dialog").open) $("guest-dialog").close();
  }

  function groups() {
    return [...new Set(state.guests.map((g) => g.group).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "vi"));
  }

  function renderGroupOptions() {
    const select = $("guest-filter-group");
    const current = select.value;
    const options = [el("option", "", "Mọi nhóm")];
    options[0].value = "";
    for (const group of groups()) {
      const option = el("option", "", group);
      option.value = group;
      options.push(option);
    }
    if (state.guests.some((g) => !g.group)) {
      const option = el("option", "", "(Chưa có nhóm)");
      option.value = NO_GROUP;
      options.push(option);
    }
    select.replaceChildren(...options);
    select.value = options.some((o) => o.value === current) ? current : "";

    $("group-options").replaceChildren(...groups().map((g) => Object.assign(el("option"), { value: g })));
  }

  function filteredGuests() {
    const query = fold($("guest-search").value);
    const side = $("guest-filter-side").value;
    const group = $("guest-filter-group").value;
    return state.guests.filter((g) =>
      (!side || g.side === side)
      && (!group || (group === NO_GROUP ? !g.group : g.group === group))
      && (!query || fold(`${greeting(g)} ${g.code}`).includes(query)));
  }

  function renderList() {
    const list = $("guest-list");
    const items = filteredGuests();
    const people = items.reduce((sum, g) => sum + (Number.isInteger(g.expectedCount) ? g.expectedCount : 0), 0);
    const filtered = items.length !== state.guests.length;
    $("guest-count").textContent = filtered
      ? `${items.length} / ${state.guests.length} khách`
      : `${state.guests.length} khách`;
    $("guest-people").textContent = items.length ? `dự kiến ${people} người` : "";

    if (!items.length) {
      list.replaceChildren(el("p", "text-secondary small mb-0",
        state.guests.length ? "Không có khách nào khớp bộ lọc." : "Chưa có khách mời. Bấm \"Thêm khách\" hoặc \"Nhập từ file\"."));
      return;
    }

    list.replaceChildren(...items.map((guest) => {
      const row = el("div", "request-item guest-item");
      row.dataset.code = guest.code;

      const info = el("div", "request-info");
      const title = el("div", "name", greeting(guest) || guest.code);
      title.append(" ", el("span", `badge align-middle side-badge side-${guest.side}`, SIDE_LABEL[guest.side] || guest.side));
      info.append(title);
      const meta = [guest.group || "Chưa có nhóm", eventsSummary(guest.invitedEvents), `${guest.expectedCount ?? "?"} người`];
      if (guest.phone) meta.push(guest.phone);
      info.append(el("div", "meta", meta.join(" · ")));
      if (guest.note) info.append(el("div", "meta fst-italic", guest.note));
      info.append(el("div", "meta guest-code", `Mã ${guest.code}`));
      row.append(info);

      const actions = el("div", "request-actions");
      actions.append(
        button("Copy link", "btn-rose", () => copyLink(guest)),
        button("Sửa", "btn-outline-secondary", () => openDialog(guest)),
        button("Xoá", "btn-outline-danger", () => removeGuest(guest)),
      );
      row.append(actions);
      return row;
    }));
  }

  function button(label, className, onClick) {
    const node = el("button", `btn btn-sm ${className}`, label);
    node.type = "button";
    node.addEventListener("click", async () => {
      node.disabled = true;
      try {
        await onClick();
      } catch (error) {
        showMessage($("guest-error"), errorText(error));
      } finally {
        node.disabled = false;
      }
    });
    return node;
  }

  async function copyLink(guest) {
    const link = guestLink(guest.code);
    const ok = await copyText(link);
    if (ok) toast(`Đã copy link thiệp của ${greeting(guest)}`);
    else window.prompt("Không copy tự động được. Chép link dưới đây:", link);
  }

  async function removeGuest(guest) {
    const message = `Xoá khách "${greeting(guest)}"?\n\nLink thiệp riêng của khách sẽ chỉ còn lời chào chung. `
      + "Xác nhận tham dự khách đã gửi (nếu có) vẫn được giữ lại.";
    if (!confirm(message)) return;
    await deleteDoc(doc(db, "guests", guest.code));
    toast(`Đã xoá ${greeting(guest)}`);
  }

  for (const id of ["guest-search", "guest-filter-side", "guest-filter-group"]) {
    $(id).addEventListener("input", renderList);
  }

  // ---------- Thêm / sửa ----------

  function renderEventChoices(selected) {
    $("guest-events").replaceChildren(...EVENTS.map((event) => {
      const wrap = el("div", "form-check");
      const input = el("input", "form-check-input");
      input.type = "checkbox";
      input.id = `guest-event-${event.key}`;
      input.value = event.key;
      input.checked = selected.includes(event.key);
      const label = el("label", "form-check-label", eventLabel(event));
      label.htmlFor = input.id;
      if (event.startISO) label.append(el("span", "text-secondary small", ` · ${event.startISO.slice(0, 10).split("-").reverse().join("/")}`));
      wrap.append(input, label);
      return wrap;
    }));
  }

  function updateGreetingPreview() {
    const text = greeting({ salutation: $("guest-salutation").value.trim(), name: $("guest-name").value.trim() });
    $("guest-greeting-preview").textContent = text ? `Thiệp sẽ chào: "Trân trọng kính mời ${text} …"` : "";
  }
  $("guest-salutation").addEventListener("input", updateGreetingPreview);
  $("guest-name").addEventListener("input", updateGreetingPreview);

  function openDialog(guest = null) {
    state.editing = guest;
    $("form-guest").reset();
    showMessage($("guest-form-error"), "");
    $("guest-dialog-title").textContent = guest ? "Sửa khách" : "Thêm khách";
    $("guest-dialog-code").textContent = guest ? `Mã ${guest.code}` : "";
    $("guest-salutation").value = guest?.salutation || "";
    $("guest-name").value = guest?.name || "";
    $("guest-side").value = guest?.side || $("guest-filter-side").value || "groom";
    $("guest-group").value = guest?.group || "";
    $("guest-count-input").value = guest?.expectedCount ?? 1;
    $("guest-phone").value = guest?.phone || "";
    $("guest-note").value = guest?.note || "";
    renderEventChoices(guest ? guest.invitedEvents || [] : EVENTS.map((e) => e.key));
    updateGreetingPreview();
    $("guest-dialog").showModal();
    $("guest-name").focus();
  }

  for (const node of document.querySelectorAll("[data-dialog-close]")) {
    node.addEventListener("click", () => $("guest-dialog").close());
  }
  $("btn-guest-add").addEventListener("click", () => openDialog());

  // Đọc form thành field C5 do admin nhập; trả { guest } hoặc { error }.
  function readForm() {
    const side = $("guest-side").value;
    const invitedEvents = Array.from($("guest-events").querySelectorAll("input:checked"), (i) => i.value);
    const { values, errors } = checkGuestFields({
      name: $("guest-name").value,
      salutation: $("guest-salutation").value.trim(),
      group: $("guest-group").value.trim(),
      phone: $("guest-phone").value.trim(),
      note: $("guest-note").value.trim(),
      countText: $("guest-count-input").value.trim(),
    });
    if (!SIDE_LABEL[side]) errors.push("Chọn bên nhà trai hoặc nhà gái.");
    if (!invitedEvents.length) errors.push("Chọn ít nhất một sự kiện mời dự.");
    if (errors.length) return { error: errors.join("; ") };
    return { guest: { ...values, side, invitedEvents } };
  }

  // Field tuỳ chọn để trống: khi tạo thì bỏ hẳn, khi sửa thì xoá field (C5: salutation?/phone?/note?).
  function withOptionalFields(guest, forUpdate) {
    const data = { ...guest };
    for (const key of ["salutation", "phone", "note"]) {
      if (!data[key]) {
        if (forUpdate) data[key] = deleteField();
        else delete data[key];
      }
    }
    return data;
  }

  $("form-guest").addEventListener("submit", async (event) => {
    event.preventDefault();
    const { guest, error } = readForm();
    if (error) return showMessage($("guest-form-error"), error);

    const save = $("btn-guest-save");
    save.disabled = true;
    showMessage($("guest-form-error"), "");
    try {
      if (state.editing) {
        await updateDoc(doc(db, "guests", state.editing.code), {
          ...withOptionalFields(guest, true),
          updatedAt: serverTimestamp(),
        });
        toast(`Đã lưu ${greeting(guest)}`);
      } else {
        const entry = { guest: withOptionalFields(guest, false) };
        await createGuests([entry]);
        toast(`Đã thêm ${greeting(guest)} · mã ${entry.code}`);
      }
      $("guest-dialog").close();
    } catch (e) {
      showMessage($("guest-form-error"), errorText(e));
    } finally {
      save.disabled = false;
    }
  });

  // Doc đã có ở code này có đúng là bản ghi của entry không (lần ghi trước đã tới server nhưng mất phản hồi)?
  function isSameGuest(data, guest) {
    return ["name", "side", "group", "expectedCount"].every((key) => data[key] === guest[key])
      && (data.invitedEvents || []).join() === guest.invitedEvents.join();
  }

  // Ghi khách mới với code ngẫu nhiên; mỗi lô một transaction đọc trước để chắc code chưa có.
  // entries: [{ guest }]. Entry nhận `code` ngay khi được cấp và `written = true` khi lô của nó đã ghi xong,
  // nên gọi lại sau lỗi chỉ ghi các entry chưa `written` và giữ nguyên code đã cấp: lô đã tới server mà mất
  // phản hồi được nhận ra (doc cùng code, cùng nội dung) thay vì ghi trùng.
  async function createGuests(entries) {
    const createdBy = getUser()?.email || "";
    const known = new Set(state.guests.map((g) => g.code));
    const pending = entries.filter((e) => !e.written);
    for (const e of entries) if (e.code) known.add(e.code);
    for (let start = 0; start < pending.length; start += IMPORT_CHUNK) {
      const chunk = pending.slice(start, start + IMPORT_CHUNK);
      for (let attempt = 1; ; attempt++) {
        for (const e of chunk) {
          if (e.code) continue;
          do e.code = randomCode(); while (known.has(e.code));
          known.add(e.code);
        }
        const collided = await runTransaction(db, async (tx) => {
          const refs = chunk.map((e) => doc(db, "guests", e.code));
          const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
          const taken = chunk.filter((e, i) => snaps[i].exists() && !isSameGuest(snaps[i].data(), e.guest));
          if (taken.length) return taken;
          chunk.forEach((e, i) => {
            if (snaps[i].exists()) return;
            tx.set(refs[i], {
              ...e.guest,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              createdBy,
            });
          });
          return [];
        });
        if (!collided.length) {
          for (const e of chunk) e.written = true;
          break;
        }
        if (attempt >= CODE_ATTEMPTS) throw new Error("Không tạo được mã khách không trùng. Vui lòng thử lại.");
        for (const e of collided) e.code = null;
      }
    }
  }

  // ---------- Nhập từ file ----------

  function resetImport() {
    state.importRows = null;
    $("import-file").value = "";
    $("import-preview").hidden = true;
    showMessage($("import-message"), "");
  }

  $("btn-import-open").addEventListener("click", () => {
    const panel = $("import-panel");
    panel.hidden = !panel.hidden;
    if (!panel.hidden) panel.scrollIntoView({ block: "nearest" });
  });
  $("btn-import-close").addEventListener("click", () => {
    resetImport();
    $("import-panel").hidden = true;
  });

  for (const node of document.querySelectorAll("[data-template]")) {
    node.addEventListener("click", async () => {
      node.disabled = true;
      try {
        await downloadTemplate(node.dataset.template, EVENTS);
      } catch (error) {
        console.warn("Không tạo được file mẫu", error);
        showMessage($("import-message"), "Không tải được thư viện đọc Excel. Kiểm tra mạng rồi thử lại.");
      } finally {
        node.disabled = false;
      }
    });
  }

  $("import-file").addEventListener("change", async () => {
    const file = $("import-file").files[0];
    state.importRows = null;
    $("import-preview").hidden = true;
    if (!file) return showMessage($("import-message"), "");
    showMessage($("import-message"), `Đang đọc ${file.name}…`, "secondary");
    try {
      const rows = await readGuestFile(file);
      if (!rows.length) return showMessage($("import-message"), "File không có dòng khách nào dưới dòng tiêu đề.");
      state.importRows = rows.map((row) => validateRow(row, EVENTS));
      showMessage($("import-message"), "");
      renderImportPreview();
    } catch (error) {
      console.warn("Không đọc được file khách mời", error);
      const text = error instanceof TypeError
        ? "Không tải được thư viện đọc Excel. Kiểm tra mạng rồi thử lại."
        : errorText(error);
      showMessage($("import-message"), text);
    }
  });

  function renderImportPreview() {
    const rows = state.importRows;
    const valid = rows.filter((r) => !r.errors.length);
    const invalid = rows.filter((r) => r.errors.length);

    // Trùng tên + bên với khách đã có hoặc dòng trước trong file: chỉ cảnh báo, vẫn nhập.
    const seen = new Set(state.guests.map((g) => `${g.side}|${fold(greeting(g))}`));
    const duplicates = new Set();
    for (const row of valid) {
      const key = `${row.guest.side}|${fold(greeting(row.guest))}`;
      if (seen.has(key)) duplicates.add(row);
      seen.add(key);
    }

    $("import-summary").textContent = `${rows.length} dòng: ${valid.length} hợp lệ, ${invalid.length} lỗi`
      + (duplicates.size ? `, ${duplicates.size} trùng tên` : "");
    $("import-errors").replaceChildren(...invalid.map((r) =>
      el("li", "text-danger", `Dòng ${r.rowNumber}: ${r.errors.join("; ")}`)));
    $("import-errors").hidden = !invalid.length;

    $("import-rows").replaceChildren(...rows.map((r) => {
      const tr = el("tr", r.errors.length ? "table-danger" : "");
      tr.dataset.row = r.rowNumber;
      const status = r.errors.length
        ? el("span", "badge text-bg-danger", "Lỗi")
        : duplicates.has(r)
          ? el("span", "badge text-bg-warning", "Trùng tên")
          : el("span", "badge text-bg-success", "OK");
      const statusCell = el("td");
      statusCell.append(status);
      tr.append(
        el("td", "", String(r.rowNumber)),
        statusCell,
        el("td", "", greeting(r.guest) || "—"),
        el("td", "", SIDE_LABEL[r.guest.side] || "—"),
        el("td", "", r.guest.group || ""),
        el("td", "", r.errors.length ? "" : eventsSummary(r.guest.invitedEvents)),
        el("td", "text-end", r.errors.length ? "" : String(r.guest.expectedCount)),
      );
      return tr;
    }));

    const commit = $("btn-import-commit");
    commit.textContent = `Nhập ${valid.length} khách`;
    commit.disabled = !valid.length;
    $("import-preview").hidden = false;
  }

  $("btn-import-commit").addEventListener("click", async () => {
    const valid = (state.importRows || []).filter((r) => !r.errors.length);
    if (!valid.length) return;
    const commit = $("btn-import-commit");
    commit.disabled = true;
    const remaining = () => valid.filter((r) => !r.written).length;
    showMessage($("import-message"), `Đang ghi ${remaining()} khách…`, "secondary");
    try {
      await createGuests(valid);
      const skipped = state.importRows.length - valid.length;
      resetImport();
      showMessage($("import-message"),
        `Đã nhập ${valid.length} khách.` + (skipped ? ` Bỏ qua ${skipped} dòng lỗi.` : ""), "success");
    } catch (error) {
      // Lô đã ghi vẫn nằm trong danh sách; bấm lại chỉ ghi phần còn lại, không ghi trùng.
      const done = valid.length - remaining();
      showMessage($("import-message"),
        `Chưa nhập hết: đã ghi ${done}/${valid.length} khách. ${errorText(error)}`
        + (done ? ` Bấm "Nhập" lại để ghi nốt ${remaining()} khách còn lại, các khách đã ghi sẽ không bị ghi lại.` : ""));
      commit.textContent = done ? `Nhập nốt ${remaining()} khách` : commit.textContent;
      commit.disabled = false;
    }
  });

  return { start, stop };
}
