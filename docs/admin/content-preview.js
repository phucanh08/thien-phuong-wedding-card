// Xem trước sống của thiệp khi đang sửa nội dung, không cần xuất bản và không sửa thiệp.
//
// Cách làm: iframe cùng origin, ghi (document.write) đúng HTML của thiệp (gốc site, index.html) kèm
// một script chạy đầu tiên thay fetch tới siteContent/published bằng data đang sửa. Thiệp vẫn đi qua
// content-loader.js thật (validate + normalize), nên xem trước giống hệt thứ khách sẽ thấy.
// document.open() gán URL của trang quản lý cho iframe: location.hostname vẫn là localhost khi chạy
// local (thiệp tự nối emulator); <base> chèn thêm trỏ về gốc site để đường dẫn tương đối như ở trang gốc.
// Mỗi lần vẽ lại dùng iframe mới (window mới): script thường của thiệp khai báo biến toàn cục bằng
// const, ghi lại vào cùng window sẽ lỗi "already declared".
import { toFirestoreValue } from "./content-model.js";

const DEBOUNCE_MS = 450;
const READY_TIMEOUT_MS = 10000;
const SITE_ROOT = new URL("../", import.meta.url);

// Phần tử neo của từng mục trên thiệp ("Xem phần này" khi chưa bấm ô nào trong mục). "" = đầu thiệp.
export const PREVIEW_ANCHORS = {
  meta: "", couple: ".v2-couple", wedding: ".v2-lovestory", events: ".v2-events", story: "#v2-story-section",
  gallery: ".v2-album", donate: ".v2-gift", music: "",
};

// Mục con trên thiệp hiện giá trị của từng ô (path của ô trong trình sửa), để khung xem trước tới đúng chỗ
// khi bấm ô / "Xem phần này". Một ô hiện ở nhiều chỗ thì liệt kê theo thứ tự ưu tiên: chỗ nào đang nằm trong
// khung nhìn thì ở lại chỗ đó, không thì tới chỗ đầu tiên. Ô không hiện trong thân thiệp (tab trình duyệt,
// nhạc, hạn xác nhận chỉ có trong sheet) -> null: khung đứng yên.
const eventItem = (key) => `.v2-event__item[data-event-key=${JSON.stringify(String(key))}]`;
const FIELD_TARGETS = [
  [/^couple\.\w+\.(?:shortName|fullName)$/, () => [".v2-couple__names", ".v2-events__couple"]],
  [/^couple\./, () => [".v2-family__list"]],
  [/^wedding\.dateISO$/, () => [".v2-countdown", ".v2-calendar", ".v2-couple__date"]],
  [/^wedding\.rsvpDeadline$/, () => null],
  [/^wedding\.(?:mainImage|envelopeImage)$/, () => [".v2-couple__banner"]],
  [/^wedding\.invitationImage$/, () => [".v2-lovestory__portrait"]],
  [/^wedding\.coverImages(?:\.|$)/, () => [".v2-cover"]],
  [/^wedding\.(?:introText|invitationText)(?:\.|$)/, () => [".v2-lovestory__intro"]],
  [/^wedding\.thanksText$/, () => [".v2-thanks"]],
  [/^events\.\d+\.dressCode(?:\.|$)/, () => ["#v2-dresscode-wrap"]],
  [/^events\.(\d+)\.(?:venue|address|mapUrl)$/, (key, field) => [`.v2-event:has(${key})`,
    ...(field === "venue" ? [".v2-timeline__list"] : [])]],
  [/^events\.(\d+)\.(?:title|startISO|endISO)$/, (key) => [key, ".v2-timeline__list"]],
  [/^events\.(\d+)\./, (key) => [key]],
  [/^story\.(\d+)\./, (i) => [`#v2-story > .v2-story__item:nth-child(${i + 1})`]],
  [/^gallery(?:\.|$)/, () => [".v2-album"]],
  [/^donate\.(groom|bride)\./, (n) => [`#v2-gift > .v2-gift__card:nth-child(${n})`]],
  [/^(?:meta|music)\./, () => null],
];

// Bộ chọn (theo thứ tự ưu tiên) của chỗ cần xem cho ô `path` thuộc mục `section`; không có path hay ô lạ ->
// neo của mục. [] = đầu thiệp; null = đứng yên.
export function previewTargets(section, path, data) {
  const anchor = PREVIEW_ANCHORS[section] ? [PREVIEW_ANCHORS[section]] : [];
  if (!path) return anchor;
  for (const [pattern, targets] of FIELD_TARGETS) {
    const m = pattern.exec(path);
    if (!m) continue;
    let arg = m[1];
    if (path.startsWith("events.")) arg = eventItem(data?.events?.[Number(m[1])]?.key ?? "");
    else if (path.startsWith("story.")) arg = Number(m[1]);
    else if (path.startsWith("donate.")) arg = m[1] === "bride" && data?.donate?.groom ? 2 : 1;
    const field = path.split(".")[2];
    return targets(arg, field);
  }
  return anchor;
}

// Chỗ cần xem trong khung: chỗ đang nằm trong khung nhìn, không thì chỗ đầu tiên có trên thiệp.
function pickTarget(win, selectors) {
  const found = [];
  for (const selector of selectors) {
    let node = null;
    try {
      node = win.document.querySelector(selector);
    } catch {
      // trình duyệt chưa hiểu :has()
    }
    if (node && node.getClientRects().length) found.push(node);
  }
  const height = win.innerHeight;
  return found.find((node) => {
    const r = node.getBoundingClientRect();
    return r.bottom > 0 && r.top < height;
  }) || found[0] || null;
}

// Vị trí đặt chỗ cần xem: vừa khung thì ở giữa, cao hơn khung thì sát mép trên.
function targetTop(win, node) {
  const r = node.getBoundingClientRect();
  const height = win.innerHeight;
  return Math.max(0, Math.round(win.scrollY + r.top - (r.height < height * 0.8 ? (height - r.height) / 2 : 0)));
}

// Chỗ đang xem: mục đầu tiên (section của thiệp) còn trong khung nhìn và khoảng cách từ mục đó tới đỉnh
// khung. Vẽ lại đổi chiều cao các mục phía trên thì vẫn đặt lại đúng mục đang xem.
const CARD_SECTIONS = "#v2-card > section";
function viewPosition(win) {
  const sections = [...win.document.querySelectorAll(CARD_SECTIONS)];
  const index = sections.findIndex((s) => s.getClientRects().length && s.getBoundingClientRect().bottom > 0);
  return { y: win.scrollY, index, offset: index < 0 ? 0 : sections[index].getBoundingClientRect().top };
}

function restorePosition(win, position) {
  const section = position.index < 0 ? null : win.document.querySelectorAll(CARD_SECTIONS)[position.index];
  const y = section && section.getClientRects().length
    ? win.scrollY + section.getBoundingClientRect().top - position.offset
    : position.y;
  if (y) win.scrollTo(0, Math.max(0, Math.round(y)));
}

// Chạy trong iframe trước mọi script của thiệp. Nhạc tắt tiếng để sửa không bị phát nhạc; form
// RSVP/lời chúc bị chặn gửi (thiệp trong bản xem trước vẫn nối Firestore thật để đọc lời chúc).
function bootstrapScript(firestoreDoc) {
  const json = JSON.stringify(firestoreDoc)
    .replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return `<script>(function () {
  var doc = ${json};
  var realFetch = window.fetch;
  window.__contentPreview = true;
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || String(input);
    if (/\\/documents\\/siteContent\\/published(?:[?#]|$)/.test(url)) {
      return Promise.resolve(new Response(JSON.stringify(doc), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return realFetch.apply(this, arguments);
  };
  var play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { this.muted = true; return play.apply(this, arguments); };
  // Thiệp gửi RSVP/lời chúc bằng sự kiện submit của form: chặn ở window (capture, chạy trước
  // listener của form) để bấm thử trong bản xem trước không ghi thật lên Firestore.
  window.addEventListener("submit", function (event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    var note = document.getElementById("content-preview-blocked");
    if (!note) {
      note = document.createElement("div");
      note.id = "content-preview-blocked";
      note.setAttribute("role", "status");
      note.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;padding:10px 12px;"
        + "border-radius:10px;background:#2b2226;color:#fff;font:14px/1.4 system-ui,sans-serif;text-align:center";
      document.body.appendChild(note);
    }
    note.textContent = "Bản xem trước: không gửi xác nhận tham dự / lời chúc.";
    clearTimeout(note._timer);
    note._timer = setTimeout(function () { note.remove(); }, 4000);
  }, true);
})();</script>`;
}

export function createPreview({ container, onState }) {
  let html = null;
  let data = null;
  let timer = null;
  let generation = 0;
  let current = null;
  let wanted = null; // { section, path } người sửa yêu cầu tới, khung chưa tới được

  async function pageHtml() {
    if (html === null) {
      const response = await fetch(new URL("index.html", SITE_ROOT), { cache: "no-store" });
      if (!response.ok) throw new Error(`Không tải được thiệp (HTTP ${response.status}).`);
      html = await response.text();
    }
    return html;
  }

  async function waitReady(frame, gen) {
    const end = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < end && gen === generation) {
      try {
        if (frame.contentWindow.document.documentElement.dataset.contentSource) return true;
      } catch {
        // iframe đang dựng
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  async function build() {
    const gen = ++generation;
    onState?.({ state: "loading" });
    let page;
    try {
      page = await pageHtml();
    } catch (error) {
      onState?.({ state: "error", message: error.message });
      return;
    }
    if (gen !== generation) return;

    const frame = document.createElement("iframe");
    frame.className = "content-preview-frame is-pending";
    frame.title = "Xem trước thiệp";
    container.append(frame);
    const injected = page.replace(/<head([^>]*)>/i,
      (tag) => `${tag}<base href="${SITE_ROOT.href}">${bootstrapScript({ fields: { data: toFirestoreValue(data) } })}`);
    const doc = frame.contentDocument;
    doc.open();
    doc.write(injected);
    doc.close();

    const ready = await waitReady(frame, gen);
    if (gen !== generation) {
      frame.remove();
      return;
    }
    const previous = current;
    const win = frame.contentWindow;
    // Người sửa vừa yêu cầu tới một chỗ mà khung cũ chưa kịp tới: khung mới tới chỗ đó thay khung cũ.
    if (previous && (previousOpened(previous) || wanted)) await openEnvelope(win, () => gen === generation);
    if (gen !== generation) {
      frame.remove();
      return;
    }
    // Lấy chỗ đang xem sau cùng (người sửa có thể đã cuộn khung cũ trong lúc khung mới dựng).
    let position = null;
    try {
      position = previous ? viewPosition(previous.contentWindow) : null;
    } catch {
      position = null;
    }
    if (position) restorePosition(win, position);
    if (wanted) {
      const spec = wanted;
      wanted = null;
      scrollFrame(win, spec, "auto");
    }
    frame.classList.remove("is-pending");
    previous?.remove();
    current = frame;
    const source = win.document.documentElement.dataset.contentSource || "";
    onState?.({ state: ready ? "ready" : "slow", source });
  }

  function previousOpened(frame) {
    try {
      return !frame.contentDocument.documentElement.classList.contains("v2-locked");
    } catch {
      return false;
    }
  }

  // Thiệp mở bằng phong bì: đã mở ở bản trước thì mở luôn ở bản mới (chạm giả nút mở).
  // alive(): còn cần mở không (khung bị thay thì thôi chờ).
  async function openEnvelope(win, alive) {
    const button = win.document.getElementById("v2-envelope-open");
    if (!button) return;
    button.click();
    const end = Date.now() + 6000;
    while (Date.now() < end && alive()
      && win.document.documentElement.classList.contains("v2-locked")) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 1200));
  }

  // Mục con chưa có trên thiệp (vd. mốc chuyện tình chưa vẽ) thì tới neo của cả mục.
  function scrollFrame(win, { section, path }, behavior) {
    const selectors = previewTargets(section, path, data);
    if (!selectors) return;
    const anchor = PREVIEW_ANCHORS[section];
    const target = selectors.length ? pickTarget(win, selectors) || (anchor && pickTarget(win, [anchor])) : null;
    if (selectors.length && !target) return;
    win.scrollTo({ top: target ? targetTop(win, target) : 0, behavior });
  }

  return {
    // Vẽ lại sau một nhịp ngắn (gõ liên tục chỉ vẽ một lần).
    update(next, { immediate = false } = {}) {
      data = next;
      clearTimeout(timer);
      timer = setTimeout(build, immediate ? 0 : DEBOUNCE_MS);
    },
    // Cuộn được chưa: đã có khung vẽ xong và khung đang hiện (trên điện thoại lớp xem trước đóng thì
    // khung không có layout, cuộn không có tác dụng).
    get canScroll() {
      return current !== null && current.getClientRects().length > 0;
    },
    // Đưa khung tới chỗ hiện ô `path` của mục `section` (không có path: neo của mục), rồi đứng yên ở đó.
    async scrollTo(section, path) {
      const selectors = previewTargets(section, path, data);
      if (!current || !selectors) return;
      const spec = { section, path };
      const frame = current;
      const win = frame.contentWindow;
      // Thiệp đang đóng phong bì thì mở trước, nội dung mới cuộn được (mục ở đầu thiệp thì giữ phong bì).
      wanted = selectors.length ? spec : null;
      if (wanted && win.document.documentElement.classList.contains("v2-locked")) {
        await openEnvelope(win, () => frame === current);
        // Khung đã được thay (khung mới tự tới chỗ này) hoặc đã có yêu cầu mới hơn.
        if (frame !== current || wanted !== spec) return;
      }
      wanted = null;
      scrollFrame(win, spec, "smooth");
    },
    // Dừng vẽ (rời trang/đăng xuất).
    clear() {
      clearTimeout(timer);
      generation++;
      current = null;
      wanted = null;
      container.replaceChildren();
    },
  };
}
