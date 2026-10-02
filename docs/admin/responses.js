// Mục "Xác nhận & lời chúc" và "Thống kê": nghe trực tiếp guests / rsvp / wishes (C5 trong CLAUDE.md),
// tổng hợp bằng stats.js. Dữ liệu khách nhập luôn hiển thị bằng textContent.
import {
  doc, deleteDoc, collection, onSnapshot,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { fold } from "./guest-import.js";
import { computeStats, TABLE_SIZE } from "./stats.js";

const EVENTS = (window.WEDDING_DATA && Array.isArray(window.WEDDING_DATA.events))
  ? window.WEDDING_DATA.events.filter((e) => e && e.key)
  : [];

const ATTENDING_LABEL = {
  yes: ["Đi", "text-bg-success"],
  no: ["Không đi", "text-bg-secondary"],
  maybe: ["Chưa chắc", "text-bg-warning"],
};
const SOURCE_LABEL = {
  guest: ["Có mã", "source-guest"],
  public: ["Link chung", "source-public"],
  deleted: ["Khách đã xoá", "source-deleted"],
};
const WEEKDAYS = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

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

// "LỄ THÀNH HÔN" → "Lễ thành hôn"
function eventLabel(key) {
  const event = EVENTS.find((e) => e.key === key);
  const text = String(event ? event.title || key : key).toLocaleLowerCase("vi");
  return text.charAt(0).toLocaleUpperCase("vi") + text.slice(1);
}

function dayLabel(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso || "Chưa có ngày";
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${weekday} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

function formatTime(ms) {
  if (ms == null) return "";
  return new Date(ms).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

function millis(ts) {
  return ts && typeof ts.toMillis === "function" ? ts.toMillis() : null;
}

function greeting(guest) {
  return [guest.salutation, guest.name].filter(Boolean).join(" ");
}

let toastTimer = null;
function toast(text) {
  const node = $("toast");
  node.textContent = text;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 2500);
}

export function createResponsesSection({ db }) {
  const state = {
    guests: [], rsvps: [], wishes: [], loaded: new Set(), unsubscribes: [], stats: null,
    // Hai kênh lỗi tách nhau để snapshot kế tiếp không xoá lỗi của thao tác xoá: lỗi nghe dữ liệu theo từng
    // collection (hết khi collection đó về lại) và lỗi thao tác (hết khi bấm thao tác mới, rời mục, hoặc stop()).
    loadErrors: new Map(), actionError: "",
  };

  // Khung báo lỗi nằm ngoài panel trong index.html nên hiện trên mọi tab: đưa vào panel "xac-nhan" để chỉ
  // hiện ở mục này (admin.js ẩn/hiện panel). Đã nằm trong một panel thì giữ nguyên.
  const errorNode = $("responses-error");
  const panel = document.querySelector('[data-panel="xac-nhan"]');
  if (panel && !errorNode.closest("[data-panel]")) {
    const heading = panel.querySelector("h2");
    if (heading) heading.after(errorNode);
    else panel.prepend(errorNode);
  }

  function renderError() {
    showMessage(errorNode, [...state.loadErrors.values(), state.actionError].filter(Boolean).join(" · "));
  }

  function setActionError(text) {
    state.actionError = text;
    renderError();
  }

  window.addEventListener("hashchange", () => {
    if (state.actionError && location.hash !== "#xac-nhan") setActionError("");
  });

  // ---------- Nghe dữ liệu ----------

  // serverTimestamps "estimate": doc vừa ghi chưa có giờ server vẫn có thời gian để sắp xếp.
  const read = (d) => d.data({ serverTimestamps: "estimate" });

  function listen(name, map) {
    return onSnapshot(
      collection(db, name),
      (snapshot) => {
        state.loadErrors.delete(name);
        renderError();
        state[name === "rsvp" ? "rsvps" : name] = snapshot.docs.map(map);
        state.loaded.add(name);
        render();
      },
      (error) => {
        state.loadErrors.set(name, `Không tải được dữ liệu (${name}): ${errorText(error)}`);
        renderError();
      },
    );
  }

  function start() {
    if (state.unsubscribes.length) return;
    state.unsubscribes = [
      listen("guests", (d) => ({ code: d.id, ...read(d) })),
      listen("rsvp", (d) => {
        const data = read(d);
        return { ...data, id: d.id, updatedAt: millis(data.updatedAt) };
      }),
      listen("wishes", (d) => {
        const data = read(d);
        return { ...data, id: d.id, createdAt: millis(data.createdAt) };
      }),
    ];
  }

  function stop() {
    for (const unsubscribe of state.unsubscribes) unsubscribe();
    state.unsubscribes = [];
    state.guests = [];
    state.rsvps = [];
    state.wishes = [];
    state.loaded.clear();
    state.stats = null;
    state.loadErrors.clear();
    setActionError("");
    // Xoá phần đã vẽ: đăng xuất rồi vào lại bằng tài khoản khác không được thấy dữ liệu của phiên trước.
    for (const id of ["rsvp-list", "wish-list", "stats-days"]) $(id).replaceChildren();
    for (const id of ["rsvp-count", "wish-count", "stats-summary"]) $(id).textContent = "";
  }

  function render() {
    // Chưa đủ guests + rsvp thì chưa tính: tránh nháy "khách đã xoá" khi rsvp về trước guests.
    if (state.loaded.has("guests") && state.loaded.has("rsvp")) {
      state.stats = computeStats({ guests: state.guests, rsvps: state.rsvps, events: EVENTS });
      renderRsvpList();
      renderStats();
    }
    if (state.loaded.has("wishes")) renderWishes();
  }

  function button(label, className, onClick) {
    const node = el("button", `btn btn-sm ${className}`, label);
    node.type = "button";
    node.addEventListener("click", async () => {
      node.disabled = true;
      setActionError("");
      try {
        await onClick();
      } catch (error) {
        setActionError(errorText(error));
      } finally {
        node.disabled = false;
      }
    });
    return node;
  }

  // ---------- Xác nhận tham dự ----------

  function displayName(entry) {
    return entry.guest ? greeting(entry.guest) || entry.guest.name : entry.name || entry.code || entry.id;
  }

  function filteredEntries() {
    const query = fold($("rsvp-search").value);
    const filter = $("rsvp-filter").value;
    return state.stats.entries.filter((e) => {
      if (query && !fold(`${displayName(e)} ${e.name || ""} ${e.code || ""}`).includes(query)) return false;
      if (!filter) return true;
      if (filter === "duplicate") return Boolean(e.duplicateOf);
      if (filter in SOURCE_LABEL) return e.source === filter;
      return e.attending === filter;
    }).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.id.localeCompare(b.id));
  }

  function renderRsvpList() {
    const { entries, totals } = state.stats;
    const items = filteredEntries();
    const parts = [`${totals.responses} xác nhận`, `${totals.byAttending.yes} đi (${totals.yesPeople} người)`,
      `${totals.byAttending.no} không đi`, `${totals.byAttending.maybe} chưa chắc`];
    if (totals.duplicates) parts.push(`${totals.duplicates} trùng`);
    $("rsvp-count").textContent = items.length !== entries.length
      ? `${items.length} / ${entries.length} xác nhận`
      : parts.join(" · ");

    const list = $("rsvp-list");
    if (!items.length) {
      list.replaceChildren(el("p", "text-secondary small mb-0",
        entries.length ? "Không có xác nhận nào khớp bộ lọc." : "Chưa có khách nào xác nhận tham dự."));
      return;
    }
    list.replaceChildren(...items.map(renderRsvpItem));
  }

  function renderRsvpItem(entry) {
    const row = el("div", "request-item rsvp-item");
    row.dataset.id = entry.id;
    row.dataset.source = entry.source;
    if (entry.duplicateOf) row.classList.add("is-duplicate");

    const info = el("div", "request-info");
    const title = el("div", "name", displayName(entry));
    const [label, badge] = ATTENDING_LABEL[entry.attending] || [String(entry.attending ?? "?"), "text-bg-light"];
    const [sourceLabel, sourceClass] = SOURCE_LABEL[entry.source];
    title.append(" ", el("span", `badge align-middle ${badge}`, label),
      " ", el("span", `badge align-middle source-badge ${sourceClass}`, sourceLabel));
    if (entry.duplicateOf) title.append(" ", el("span", "badge align-middle text-bg-danger", "Trùng"));
    info.append(title);

    const meta = [];
    if (entry.attending === "yes") meta.push(`${entry.people} người`);
    if (entry.attending !== "no") {
      meta.push(entry.countedEvents.length
        ? entry.countedEvents.map(eventLabel).join(", ")
        : "Chưa chọn lễ nào");
    }
    if (entry.updatedAt != null) meta.push(formatTime(entry.updatedAt));
    info.append(el("div", "meta", meta.join(" · ")));

    if (entry.guest && fold(entry.name) && fold(entry.name) !== fold(entry.guest.name)) {
      info.append(el("div", "meta", `Tên khách nhập: ${entry.name}`));
    }
    if (entry.outsideEvents.length) {
      info.append(el("div", "meta text-danger",
        `Chọn thêm lễ không được mời (không tính): ${entry.outsideEvents.map(eventLabel).join(", ")}`));
    }
    if (entry.source === "deleted") {
      info.append(el("div", "meta text-danger",
        `Khách mã ${entry.code} đã bị xoá khỏi danh sách: không tính vào số khách mời, vẫn tính người đi.`));
    }
    if (entry.duplicateOf) {
      info.append(el("div", "meta text-danger",
        "Trùng tên với một xác nhận mới hơn qua link chung: không tính vào thống kê. Có thể xoá."));
    }
    if (entry.note) info.append(el("div", "meta fst-italic note-text", entry.note));
    if (entry.code) info.append(el("div", "meta guest-code", `Mã ${entry.code}`));
    row.append(info);

    const actions = el("div", "request-actions");
    actions.append(button("Xoá", "btn-outline-danger", () => removeRsvp(entry)));
    row.append(actions);
    return row;
  }

  async function removeRsvp(entry) {
    const name = displayName(entry);
    const message = entry.source === "guest"
      ? `Xoá xác nhận tham dự của "${name}"?\n\nKhách sẽ trở về "chưa trả lời" và có thể gửi lại từ link thiệp riêng.`
      : `Xoá xác nhận tham dự của "${name}"?\n\nKhông khôi phục được.`;
    if (!confirm(message)) return;
    await deleteDoc(doc(db, "rsvp", entry.id));
    toast(`Đã xoá xác nhận của ${name}`);
  }

  for (const id of ["rsvp-search", "rsvp-filter"]) {
    $(id).addEventListener("input", () => { if (state.stats) renderRsvpList(); });
  }

  // ---------- Lời chúc ----------

  function renderWishes() {
    const query = fold($("wish-search").value);
    const all = [...state.wishes].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.id.localeCompare(b.id));
    const items = all.filter((w) => !query || fold(`${w.name} ${w.message}`).includes(query));
    $("wish-count").textContent = items.length !== all.length ? `${items.length} / ${all.length} lời chúc` : `${all.length} lời chúc`;

    const list = $("wish-list");
    if (!items.length) {
      list.replaceChildren(el("p", "text-secondary small mb-0",
        all.length ? "Không có lời chúc nào khớp." : "Chưa có lời chúc nào."));
      return;
    }
    const guestByCode = new Map(state.guests.map((g) => [g.code, g]));
    list.replaceChildren(...items.map((wish) => {
      const row = el("div", "request-item wish-item");
      row.dataset.id = wish.id;
      const info = el("div", "request-info");
      info.append(el("div", "name", wish.name || "(không tên)"));
      info.append(el("div", "wish-message", wish.message || ""));
      const meta = [];
      if (wish.createdAt != null) meta.push(formatTime(wish.createdAt));
      if (wish.code) {
        const guest = guestByCode.get(wish.code);
        meta.push(guest ? `Khách ${greeting(guest)} (mã ${wish.code})` : `Mã ${wish.code}`);
      } else {
        meta.push("Link chung");
      }
      info.append(el("div", "meta", meta.join(" · ")));
      row.append(info);
      const actions = el("div", "request-actions");
      actions.append(button("Xoá", "btn-outline-danger", () => removeWish(wish)));
      row.append(actions);
      return row;
    }));
  }

  async function removeWish(wish) {
    const preview = String(wish.message || "").slice(0, 80);
    if (!confirm(`Xoá lời chúc của "${wish.name}"?\n\n"${preview}"\n\nLời chúc sẽ biến mất khỏi thiệp.`)) return;
    await deleteDoc(doc(db, "wishes", wish.id));
    toast(`Đã xoá lời chúc của ${wish.name}`);
  }

  $("wish-search").addEventListener("input", () => { if (state.loaded.has("wishes")) renderWishes(); });

  // ---------- Thống kê ----------

  function stat(label, value, sub, key) {
    const box = el("div", "stat");
    if (key) box.dataset.stat = key;
    box.append(el("div", "stat-value", String(value)), el("div", "stat-label", label));
    if (sub) box.append(el("div", "stat-sub", sub));
    return box;
  }

  // Ô số liệu dùng chung cho một lễ và cho tổng ngày.
  function figures(s) {
    const grid = el("div", "stat-grid");
    const sources = [];
    if (s.yesPeopleBySource.public) sources.push(`${s.yesPeopleBySource.public} người qua link chung`);
    if (s.yesPeopleBySource.deleted) sources.push(`${s.yesPeopleBySource.deleted} người của khách đã xoá`);
    grid.append(
      stat("Khách mời", s.invitedGuests, `${s.invitedPeople} người dự kiến`, "invited"),
      stat("Xác nhận đi", `${s.yesPeople} người`, `${s.yesResponses} xác nhận${sources.length ? ` · gồm ${sources.join(", ")}` : ""}`, "yes"),
      stat("Chưa chắc", s.maybeResponses, s.maybePeople ? `~${s.maybePeople} người dự kiến` : "", "maybe"),
      stat("Không đi", s.noGuests, s.noPeople ? `${s.noPeople} người dự kiến` : "", "no"),
      stat("Chưa trả lời", s.pendingGuests, `${s.pendingPeople} người dự kiến`, "pending"),
    );
    const tables = el("div", "stat-tables");
    tables.append(
      stat("Mâm (đã xác nhận)", s.tables, "", "tables"),
      stat("Mâm dự kiến", s.tablesExpected, "", "tablesExpected"),
    );
    return [grid, tables];
  }

  // Khách có mã nhưng invitedEvents không có lễ hợp lệ nào: không thuộc lễ nào nên không vào số từng lễ.
  // Hiện riêng để không rơi mất; người đã xác nhận đi vẫn nằm trong mâm của lễ họ chọn.
  function unassignedBlock(unassigned) {
    if (!unassigned.guests) return [];
    const box = el("section", "stats-unassigned alert alert-warning small");
    box.dataset.stat = "unassigned";
    box.append(el("strong", "", `${unassigned.guests} khách chưa được mời lễ nào`),
      el("div", "", `${unassigned.people} người dự kiến · ${unassigned.answered} đã trả lời `
        + `(${unassigned.yesPeople} người đi) · ${unassigned.pendingGuests} chưa trả lời `
        + `(${unassigned.pendingPeople} người dự kiến).`),
      el("div", "", "Các khách này không nằm trong khách mời hay mâm dự kiến của lễ nào. "
        + "Người đã xác nhận đi vẫn tính vào mâm của lễ họ chọn. Sửa danh sách lễ ở mục Khách mời để xếp họ vào lễ."));
    return [box];
  }

  function renderStats() {
    const { days, events, totals, unassigned } = state.stats;
    const root = $("stats-days");
    $("stats-summary").textContent = `${totals.guests} khách mời · ${totals.guestsAnswered} đã trả lời · `
      + `${totals.responses - totals.duplicates} xác nhận được tính (${totals.bySource.public} link chung`
      + `${totals.bySource.deleted ? `, ${totals.bySource.deleted} khách đã xoá` : ""})`
      + (totals.duplicates ? ` · ${totals.duplicates} xác nhận trùng không tính` : "");

    if (!events.length) {
      root.replaceChildren(el("p", "text-secondary small mb-0", "Chưa có sự kiện nào trong wedding-data.js."));
      return;
    }
    root.replaceChildren(...unassignedBlock(unassigned), ...days.map((day) => {
      const block = el("section", "stats-day");
      block.dataset.day = day.date;
      const head = el("div", "stats-day-head");
      head.append(el("h3", "h5 mb-0", dayLabel(day.date)));
      head.append(el("span", "stats-day-tables",
        `${day.tables} mâm · dự kiến ${day.tablesExpected} mâm`));
      block.append(head);

      const cards = el("div", "stats-events");
      for (const key of day.eventKeys) {
        const s = events.find((e) => e.key === key);
        const card = el("div", "card stats-event");
        card.dataset.event = key;
        const body = el("div", "card-body");
        body.append(el("h4", "h6 mb-3", eventLabel(key)), ...figures(s));
        card.append(body);
        cards.append(card);
      }
      block.append(cards);

      if (day.eventKeys.length > 1) {
        const total = el("div", "card stats-event stats-day-total");
        total.dataset.event = `day:${day.date}`;
        const body = el("div", "card-body");
        body.append(el("h4", "h6 mb-3", `Cộng ngày ${day.date.split("-").reverse().join("/")} (${day.eventKeys.length} lễ)`),
          ...figures(day));
        total.append(body);
        block.append(total);
      }
      return block;
    }));
  }

  $("stats-note").textContent = `Mâm = làm tròn lên (số người đã xác nhận đi lễ đó) / ${TABLE_SIZE}. `
    + `Mâm dự kiến cộng thêm số người dự kiến của khách được mời mà chưa trả lời. `
    + "Mỗi lễ tính riêng; số theo ngày là cộng các lễ trong ngày (khách mời hai lễ cùng ngày được đếm ở cả hai). "
    + "Khách có mã chỉ được tính ở lễ được mời; khách chưa được mời lễ nào hiện riêng ở đầu trang. "
    + "Khách link chung trùng tên (không phân biệt hoa/thường, khoảng trắng; có dấu khác nhau thì là người khác) chỉ tính xác nhận mới nhất. "
    + "Xác nhận của khách đã bị xoá khỏi danh sách vẫn được tính người đi, không tính vào khách mời. "
    + "\"Chưa chắc\" không tính vào mâm.";

  return { start, stop };
}
