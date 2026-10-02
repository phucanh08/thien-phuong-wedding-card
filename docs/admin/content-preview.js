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
const SETTLE_MS = 400;
const LARGE_WAIT_MS = 150; // bản lớn đã có trong cache đổi trong vài chục ms; băng ảnh Album có ảnh không bao giờ đổi
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  let asked = null; // yêu cầu tới chỗ nào gần nhất (bấm ô / "Xem phần này"), kể cả yêu cầu khung cũ đã tới

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
      await sleep(25);
    }
    return false;
  }

  async function build() {
    const gen = ++generation;
    const askedAtStart = asked;
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
    const alive = () => gen === generation;
    // Khung mới còn ẩn: tắt chuyển động CSS để nó hiện ra đúng trạng thái cuối (phong bì đã mở, các mục đã
    // hiện), không mờ dần hay trượt vào lúc thay khung cũ.
    const still = win.document.createElement("style");
    still.textContent = "*, *::before, *::after { transition: none !important; }";
    win.document.head.append(still);
    // Người sửa vừa yêu cầu tới một chỗ mà khung cũ chưa kịp tới: khung mới tới chỗ đó thay khung cũ.
    if (previous && (previousOpened(previous) || wanted)) await openEnvelope(win, alive, true);
    if (!alive()) {
      frame.remove();
      return;
    }
    // Đặt khung mới vào chỗ người sửa vừa yêu cầu tới trong lúc khung mới dựng (bấm ô / "Xem phần này"), không
    // thì vào chỗ đang xem trên khung cũ. Trả về chỗ đã đặt theo (yêu cầu, hoặc vị trí cuộn của khung cũ).
    const place = () => {
      const spec = wanted || (asked !== askedAtStart ? asked : null);
      wanted = null;
      if (spec && scrollFrame(win, spec, "auto")) return spec;
      let position = null;
      try {
        position = previous ? viewPosition(previous.contentWindow) : null;
      } catch {
        position = null;
      }
      if (position) restorePosition(win, position);
      return position ? position.y : null;
    };
    const oldWin = previous?.contentWindow || null;
    const placed = place();
    await settle(win, oldWin, alive);
    if (!alive()) {
      frame.remove();
      return;
    }
    // Trong lúc chờ, người sửa cuộn khung cũ hoặc yêu cầu tới chỗ khác: đặt lại theo chỗ mới nhất.
    if (place() !== placed) await settle(win, oldWin, alive);
    if (!alive()) {
      frame.remove();
      return;
    }
    frame.classList.remove("is-pending");
    previous?.remove();
    current = frame;
    win.getComputedStyle(win.document.body).opacity; // chốt trạng thái cuối trước khi bật lại chuyển động
    setTimeout(() => still.remove(), 100);
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
  // alive(): còn cần mở không (khung bị thay thì thôi chờ). instant: khung mới còn ẩn, thiệp mở ngay không
  // chờ hiệu ứng (v2/card.js đọc window.__contentPreviewInstant).
  async function openEnvelope(win, alive, instant = false) {
    const button = win.document.getElementById("v2-envelope-open");
    if (!button) return;
    if (instant) win.__contentPreviewInstant = true;
    button.click();
    const end = Date.now() + 6000;
    while (Date.now() < end && alive()
      && win.document.documentElement.classList.contains("v2-locked")) {
      await sleep(instant ? 20 : 100);
    }
    if (!instant) await sleep(1200);
  }

  // Chờ khung mới (còn ẩn) xong phần trong khung nhìn: các mục đã được thiệp cho hiện (IntersectionObserver
  // thêm .is-in), font và ảnh đã tải, ảnh mà khung cũ đang hiện bản lớn (cùng mục) thì khung mới cũng đã đổi
  // sang bản lớn (thiệp hiện bản nhỏ trước, xem setImgPair), để lúc hiện không mờ, trống hay đổi ảnh; quá
  // SETTLE_MS (riêng chờ bản lớn: LARGE_WAIT_MS) thì thôi chờ. oldWin: khung đang thấy (null khi chưa có).
  async function settle(win, oldWin, alive) {
    const start = Date.now();
    const end = start + SETTLE_MS;
    let large = new Set();
    try {
      large = new Set([...(oldWin?.document.images || [])].filter((img) => img.src.includes("-large."))
        .map((img) => imageKey(img, img.src)));
    } catch {
      // khung cũ đã bị bỏ
    }
    await sleep(20);
    while (Date.now() < end && alive() && !settled(win, Date.now() - start < LARGE_WAIT_MS ? large : new Set())) {
      await sleep(20);
    }
  }

  // Ảnh theo mục của thiệp chứa nó: cùng một ảnh có thể hiện bản lớn ở mục này, bản nhỏ ở mục khác (băng ảnh).
  function imageKey(img, src) {
    const section = img.closest(CARD_SECTIONS);
    const index = section ? [...img.ownerDocument.querySelectorAll(CARD_SECTIONS)].indexOf(section) : -1;
    return `${index} ${src}`;
  }

  function settled(win, large) {
    const height = win.innerHeight;
    const inView = (node) => {
      const r = node.getBoundingClientRect();
      return r.width > 0 && r.bottom > 0 && r.top < height;
    };
    const doc = win.document;
    return doc.fonts.status === "loaded"
      && [...doc.querySelectorAll("[data-reveal]")].every((node) => node.classList.contains("is-in") || !inView(node))
      && [...doc.images].every((img) => !inView(img)
        || (img.complete && !(img.src.includes("-small.") && large.has(imageKey(img, img.src.replace("-small.", "-large."))))));
  }

  // Mục con chưa có trên thiệp (vd. mốc chuyện tình chưa vẽ) thì tới neo của cả mục. Trả về đã cuộn chưa.
  function scrollFrame(win, { section, path }, behavior) {
    const selectors = previewTargets(section, path, data);
    if (!selectors) return false;
    const anchor = PREVIEW_ANCHORS[section];
    const target = selectors.length ? pickTarget(win, selectors) || (anchor && pickTarget(win, [anchor])) : null;
    if (selectors.length && !target) return false;
    win.scrollTo({ top: target ? targetTop(win, target) : 0, behavior });
    return true;
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
      asked = spec;
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
