// Unit test chặn phóng cả trang (docs/no-page-zoom.js) và chụm ảnh (docs/pinch-zoom.js) trên điện thoại.
// Luật (Human 2026-10-03, cơ chế đo trên Safari iOS 26.5 Simulator — xem commit):
//   - trang ở scale 1: chụm hai ngón/chạm đúp không phóng cả trang (gesturestart/gesturechange bị chặn,
//     <html> touch-action "pan-x pan-y"); chụm hai ngón lên một ảnh thì ảnh đó nổi lên (bản sao .pz-clone);
//   - trang đã bị phóng (lọt khi ngón đặt thêm lúc trang đang cuộn — WebKit không cho trang chặn lúc đó):
//     không chặn nữa, kể cả trên ảnh, để chụm hai ngón thu trang về scale 1; về 1 thì chặn lại.
// Hai file là script thường chạy trên DOM: test chạy trong vm với document/visualViewport giả.
// Expected viết tay theo luật trên. Chạy: node --test tests/unit/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (path) => readFileSync(new URL(`../../docs/${path}`, import.meta.url), "utf8");

function target() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, fn, opts) {
      const capture = typeof opts === "object" ? !!opts.capture : !!opts;
      listeners.set(type, (listeners.get(type) || []).concat({ fn, capture }));
    },
    removeEventListener(type, fn, opts) {
      const capture = typeof opts === "object" ? !!opts.capture : !!opts;
      listeners.set(type, (listeners.get(type) || []).filter((l) => l.fn !== fn || l.capture !== capture));
    },
  };
}

// Trình duyệt giả tối thiểu: một ảnh [data-pinch-zoom] 200x100 ở (10, 20), visualViewport đổi scale được.
function browser() {
  const vv = Object.assign(target(), { scale: 1 });
  const root = { style: { touchAction: "" } };
  const appended = [];
  const img = Object.assign(target(), {
    tagName: "IMG",
    src: "a.webp",
    parentElement: null,
    classList: { add() {}, remove() {} },
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 100 }),
  });
  const document = Object.assign(target(), {
    readyState: "complete",
    documentElement: root,
    body: { appendChild: (node) => appended.push(node) },
    querySelectorAll: (sel) => (sel.includes("[data-pinch-zoom]") ? [img] : []),
    createElement: () => ({
      style: {},
      classList: { add() {}, remove() {} },
      setAttribute() {},
      addEventListener() {},
      remove() {},
    }),
  });
  const window = Object.assign(target(), { visualViewport: vv });
  const context = {
    window,
    document,
    visualViewport: vv,
    getComputedStyle: () => ({ borderRadius: "0px" }),
    setTimeout: () => 0,
    clearTimeout() {},
    Date,
    Math,
  };
  vm.createContext(context);
  return { context, document, window, vv, root, img, appended };
}

function run(b, file) {
  vm.runInContext(read(file), b.context, { filename: file });
}

// Gửi sự kiện tới listener của từng phần tử theo thứ tự trình duyệt: capture trên document, rồi phần tử đích,
// rồi bubble trên document. Trả về sự kiện để xem có bị preventDefault không.
function dispatch(b, type, { on = b.document, touches = [] } = {}) {
  const e = {
    type,
    touches,
    cancelable: true,
    defaultPrevented: false,
    stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
  };
  const call = (node, capture) =>
    (node.listeners.get(type) || [])
      .filter((l) => l.capture === capture)
      .forEach((l) => { if (!e.stopped) l.fn.call(node, Object.assign(e, { currentTarget: node })); });
  call(b.document, true);
  if (on !== b.document) { call(on, false); call(on, true); }
  call(b.document, false);
  return e;
}

function zoomTo(b, scale) {
  b.vv.scale = scale;
  (b.vv.listeners.get("resize") || []).forEach((l) => l.fn({ type: "resize" }));
}

const t1 = { identifier: 1, clientX: 60, clientY: 60 };
const t2 = { identifier: 2, clientX: 120, clientY: 80 };

test("trang ở scale 1: chụm/chạm đúp không phóng cả trang", () => {
  const b = browser();
  run(b, "no-page-zoom.js");
  assert.equal(b.root.style.touchAction, "pan-x pan-y");
  assert.equal(dispatch(b, "gesturestart").defaultPrevented, true);
  assert.equal(dispatch(b, "gesturechange").defaultPrevented, true);
});

test("trang đã bị phóng: thôi chặn để chụm thu về được, về scale 1 thì chặn lại", () => {
  const b = browser();
  run(b, "no-page-zoom.js");
  zoomTo(b, 2.97);
  assert.equal(b.root.style.touchAction, "");
  assert.equal(dispatch(b, "gesturestart").defaultPrevented, false);
  assert.equal(dispatch(b, "gesturechange").defaultPrevented, false);
  zoomTo(b, 1);
  assert.equal(b.root.style.touchAction, "pan-x pan-y");
  assert.equal(dispatch(b, "gesturestart").defaultPrevented, true);
});

test("scale 1: chụm hai ngón lên ảnh làm ảnh nổi lên, trang không phóng", () => {
  const b = browser();
  run(b, "no-page-zoom.js");
  run(b, "pinch-zoom.js");
  dispatch(b, "touchstart", { on: b.img, touches: [t1] });
  const second = dispatch(b, "touchstart", { touches: [t1, t2] });
  assert.equal(second.defaultPrevented, true);
  assert.equal(b.appended.filter((n) => n.className === "pz-clone").length, 1);
  assert.equal(dispatch(b, "gesturestart").defaultPrevented, true);
});

test("trang đã bị phóng: chụm hai ngón lên ảnh không làm ảnh nổi lên, để trang thu về", () => {
  const b = browser();
  run(b, "no-page-zoom.js");
  run(b, "pinch-zoom.js");
  zoomTo(b, 2.97);
  dispatch(b, "touchstart", { on: b.img, touches: [t1] });
  const second = dispatch(b, "touchstart", { touches: [t1, t2] });
  assert.equal(second.defaultPrevented, false);
  assert.equal(b.appended.length, 0);
  assert.equal(dispatch(b, "gesturestart").defaultPrevented, false);
});

test("LightGallery không có nút kính lúp (actualSize) và nút phóng/thu", () => {
  const card = read("v2/card.js");
  const configs = [...card.matchAll(/window\.lightGallery\([^,]+,\s*\{([\s\S]*?)\n\s*\}\);/g)].map((m) => m[1]);
  assert.equal(configs.length, 2);
  for (const config of configs) {
    assert.match(config, /actualSize: false/);
    assert.doesNotMatch(config, /showZoomInOutIcons: true/);
  }
});

// Chạm đúp ảnh trong LightGallery không phóng (Human 2026-10-03). lg-zoom gọi setActualSize(index, event) với event là
// touchstart khi chạm đúp, là dblclick khi bấm đúp chuột; pinch-zoom.js bỏ qua loại đầu, giữ loại sau.
test("LightGallery: chạm đúp (touchstart) không phóng ảnh, bấm đúp chuột vẫn phóng", () => {
  const b = browser();
  const calls = [];
  function Zoom() {}
  Zoom.prototype.setActualSize = function (index, event) { calls.push([this, index, event && event.type]); return "zoomed"; };
  b.window.lgZoom = Zoom;
  run(b, "pinch-zoom.js");
  dispatch(b, "lgAfterOpen");
  const zoom = new Zoom();
  assert.equal(zoom.setActualSize(0, { type: "touchstart" }), undefined);
  assert.equal(calls.length, 0);
  assert.equal(zoom.setActualSize(0, { type: "dblclick" }), "zoomed");
  assert.deepEqual(calls.map((c) => c.slice(1)), [[0, "dblclick"]]);
  // Mở lightbox lần nữa không bọc thêm một lớp
  dispatch(b, "lgAfterOpen");
  assert.equal(zoom.setActualSize(1), "zoomed");
  assert.equal(calls.length, 2);
});
