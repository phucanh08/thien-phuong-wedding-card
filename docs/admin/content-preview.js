// Xem trước sống của thiệp khi đang sửa nội dung, không cần xuất bản và không sửa thiệp.
//
// Cách làm: iframe cùng origin, ghi (document.write) đúng HTML của /v1/ hoặc /v2/ kèm một script
// chạy đầu tiên thay fetch tới siteContent/published bằng data đang sửa. Thiệp vẫn đi qua
// content-loader.js thật (validate + normalize), nên xem trước giống hệt thứ khách sẽ thấy.
// document.open() gán URL của trang quản lý cho iframe: location.hostname vẫn là localhost khi chạy
// local (thiệp tự nối emulator), <base href="../"> trỏ về gốc site như ở /v1/.
// Mỗi lần vẽ lại dùng iframe mới (window mới): script thường của thiệp khai báo biến toàn cục bằng
// const, ghi lại vào cùng window sẽ lỗi "already declared".
import { toFirestoreValue } from "./content-model.js";

const DEBOUNCE_MS = 450;
const READY_TIMEOUT_MS = 10000;
const SITE_ROOT = new URL("../", import.meta.url);

// Phần tử neo của từng mục trên thiệp, để "Xem phần này" cuộn tới.
export const PREVIEW_ANCHORS = {
  v1: {
    meta: "", couple: "#couple", wedding: ".banner-section", invitation: "#invitation",
    events: "#event", story: "#story", gallery: "#gallery", donate: "#donate", music: "",
  },
  v2: {
    meta: "", couple: ".v2-couple", wedding: ".v2-lovestory", invitation: ".v2-family",
    cover: ".v2-cover", thanks: ".v2-thanks", events: ".v2-events", story: "#v2-story-section",
    gallery: ".v2-album", donate: ".v2-gift", music: "",
  },
};

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
  const htmlCache = new Map();
  let version = "v1";
  let data = null;
  let timer = null;
  let generation = 0;
  let current = null;

  async function pageHtml(v) {
    if (!htmlCache.has(v)) {
      const response = await fetch(new URL(`${v}/index.html`, SITE_ROOT), { cache: "no-store" });
      if (!response.ok) throw new Error(`Không tải được thiệp ${v} (HTTP ${response.status}).`);
      htmlCache.set(v, await response.text());
    }
    return htmlCache.get(v);
  }

  function isReady(win, v) {
    const doc = win.document;
    if (!doc.documentElement.dataset.contentSource) return false;
    if (v === "v1") {
      const preloader = doc.getElementById("preloader");
      return !preloader || preloader.style.display === "none";
    }
    return true;
  }

  async function waitReady(frame, v, gen) {
    const end = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < end && gen === generation) {
      try {
        if (isReady(frame.contentWindow, v)) return true;
      } catch {
        // iframe đang dựng
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  async function build() {
    const gen = ++generation;
    const v = version;
    onState?.({ state: "loading" });
    let html;
    try {
      html = await pageHtml(v);
    } catch (error) {
      onState?.({ state: "error", message: error.message });
      return;
    }
    if (gen !== generation) return;

    const frame = document.createElement("iframe");
    frame.className = "content-preview-frame is-pending";
    frame.dataset.version = v;
    frame.title = `Xem trước thiệp ${v}`;
    container.append(frame);
    const injected = html.replace(/<head([^>]*)>/i,
      (tag) => `${tag}${bootstrapScript({ fields: { data: toFirestoreValue(data) } })}`);
    const doc = frame.contentDocument;
    doc.open();
    doc.write(injected);
    doc.close();

    const ready = await waitReady(frame, v, gen);
    if (gen !== generation) {
      frame.remove();
      return;
    }
    const previous = current;
    let scrollY = 0;
    try {
      scrollY = previous ? previous.contentWindow.scrollY : 0;
    } catch {
      scrollY = 0;
    }
    const win = frame.contentWindow;
    if (v === "v2" && previous && previousOpened(previous)) await openEnvelope(win, gen);
    if (gen !== generation) {
      frame.remove();
      return;
    }
    if (scrollY) win.scrollTo(0, scrollY);
    frame.classList.remove("is-pending");
    previous?.remove();
    current = frame;
    const source = win.document.documentElement.dataset.contentSource || "";
    onState?.({ state: ready ? "ready" : "slow", source, version: v });
  }

  function previousOpened(frame) {
    try {
      return frame.dataset.version === "v2" && !frame.contentDocument.documentElement.classList.contains("v2-locked");
    } catch {
      return false;
    }
  }

  // v2 mở bằng phong bì: đã mở ở bản trước thì mở luôn ở bản mới (chạm giả nút mở).
  async function openEnvelope(win, gen) {
    const button = win.document.getElementById("v2-envelope-open");
    if (!button) return;
    button.click();
    const end = Date.now() + 6000;
    while (Date.now() < end && gen === generation
      && win.document.documentElement.classList.contains("v2-locked")) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 1200));
  }

  return {
    // Vẽ lại sau một nhịp ngắn (gõ liên tục chỉ vẽ một lần).
    update(next, { immediate = false } = {}) {
      data = next;
      clearTimeout(timer);
      timer = setTimeout(build, immediate ? 0 : DEBOUNCE_MS);
    },
    setVersion(next) {
      if (next === version) return;
      version = next;
      if (data) this.update(data, { immediate: true });
    },
    get version() {
      return version;
    },
    // Cuộn được chưa: đã có khung vẽ xong và khung đang hiện (trên điện thoại lớp xem trước đóng thì
    // khung không có layout, cuộn không có tác dụng).
    get canScroll() {
      return current !== null && current.getClientRects().length > 0;
    },
    async scrollTo(section) {
      if (!current) return;
      const frame = current;
      const selector = PREVIEW_ANCHORS[frame.dataset.version][section];
      const win = frame.contentWindow;
      // v2 đang đóng phong bì thì mở trước, nội dung mới cuộn được (mục ở đầu thiệp thì giữ phong bì).
      if (selector && frame.dataset.version === "v2" && win.document.documentElement.classList.contains("v2-locked")) {
        await openEnvelope(win, generation);
        if (frame !== current) return;
      }
      const target = selector ? win.document.querySelector(selector) : null;
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      else win.scrollTo({ top: 0, behavior: "smooth" });
    },
    // Dừng vẽ (rời trang/đăng xuất).
    clear() {
      clearTimeout(timer);
      generation++;
      current = null;
      container.replaceChildren();
    },
  };
}
