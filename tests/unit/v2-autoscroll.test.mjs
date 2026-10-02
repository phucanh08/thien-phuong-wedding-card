// Unit test cho phần tự cuộn của docs/v2/card.js (Human duyệt 2026-10-02):
//   - tốc độ 80 px/giây;
//   - khách chạm (touchstart/pointerdown), vuốt (touchmove), cuộn (scroll), lăn chuột (wheel) hay bấm phím
//     (keydown) là dừng ngay, kể cả trước khi tự cuộn bắt đầu (từ lúc thiệp hiện ra: armAutoScroll);
//   - sau 30 s không thao tác thì cuộn tiếp từ vị trí hiện tại; mỗi lần thao tác đếm lại 30 s;
//   - không chạy lại khi đang mở sheet (html.v2-sheet-open), xem ảnh lớn (html.lg-on), ô nhập liệu đang
//     focus, hay đã ở cuối trang; hết các trạng thái đó thì đếm 30 s từ lúc hết;
//   - prefers-reduced-motion: không tự cuộn.
// card.js là script thường nhiều DOM, không nạp được cả file trong node: test cắt đúng đoạn "Tự cuộn"
// (giữa hai tiêu đề mục) và chạy trong vm với window/document/requestAnimationFrame/đồng hồ giả.
// Thứ tự gọi armAutoScroll -> startAutoScroll trong openEnvelope được kiểm bằng trình duyệt (xem commit).
// Expected viết tay theo luật trên, không tính bằng code đang test.
// Chạy: node --test tests/unit/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const card = readFileSync(new URL("../../docs/v2/card.js", import.meta.url), "utf8");
const speedLine = card.match(/^\s*const AUTO_SCROLL_SPEED = .*$/m)[0];
const section = card.slice(card.indexOf("// ===== Tự cuộn"), card.indexOf("// ===== Mở phong bì"));

// Trang dài 5000 px, khung 800 px (cuối trang: scrollY 4200). Đồng hồ giả bước 16 ms: mỗi bước phát
// "scroll" nếu vị trí đã đổi (như trình duyệt: ở khung hình sau, trước requestAnimationFrame), chạy khung
// hình đã xin rồi tới timer đến hạn.
function load({ reducedMotion = false } = {}) {
  const listeners = new Map();
  const classes = new Set();
  let now = 0;
  let frames = new Map();
  let nextId = 1;
  let scrolled = false;
  const timers = new Map();
  const fire = (type) => [...(listeners.get(type) || [])].forEach((fn) => fn({ type }));
  const window = {
    scrollY: 0,
    innerHeight: 800,
    scrollTo(x, y) {
      if (y === window.scrollY) return;
      window.scrollY = y;
      scrolled = true;
    },
    addEventListener(type, fn) { listeners.set(type, (listeners.get(type) || new Set()).add(fn)); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
  };
  const document = {
    activeElement: null,
    documentElement: { scrollHeight: 5000, classList: { contains: (name) => classes.has(name) } },
  };
  const context = {
    window,
    document,
    performance: { now: () => now },
    requestAnimationFrame(fn) { frames.set(nextId, fn); return nextId++; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setInterval(fn, ms) { timers.set(nextId, { fn, ms, at: now + ms }); return nextId++; },
    setTimeout(fn, ms) { timers.set(nextId, { fn, at: now + ms, once: true }); return nextId++; },
    clearInterval(id) { timers.delete(id); },
    clearTimeout(id) { timers.delete(id); },
    reducedMotion,
  };
  // Bản chưa có armAutoScroll (listener chỉ gắn khi bắt đầu cuộn) chạy như arm không làm gì
  vm.runInNewContext(`${speedLine}\n${section}
    this.api = { armAutoScroll: typeof armAutoScroll === "function" ? armAutoScroll : () => {}, startAutoScroll, stopAutoScroll };`, context);
  const page = {
    ...context.api,
    window,
    document,
    fire,
    // Khách tự cuộn trang tới y (vuốt, kéo thanh cuộn)
    userScrollTo(y) { window.scrollY = y; scrolled = true; },
    setClass(name, on) { if (on) classes.add(name); else classes.delete(name); },
    run(ms) {
      for (const end = now + ms; now < end;) {
        now += 16;
        if (scrolled) { scrolled = false; fire("scroll"); }
        const due = frames;
        frames = new Map();
        due.forEach((fn) => fn(now));
        for (const [id, t] of [...timers]) {
          if (t.at > now) continue;
          if (t.once) timers.delete(id); else t.at += t.ms;
          t.fn();
        }
      }
    },
    // Đang tự cuộn: 1 s sau vị trí tăng
    moving() { const y = window.scrollY; page.run(1000); return window.scrollY > y; },
  };
  return page;
}

// Mở phong bì như openEnvelope: thiệp hiện (arm), 1,1 s sau bắt đầu cuộn, cuộn thêm `ms`
function opened(ms = 1000, options) {
  const page = load(options);
  page.armAutoScroll();
  page.run(1100);
  page.startAutoScroll();
  page.run(ms);
  return page;
}

test("tốc độ 80 px/giây", () => {
  const page = opened(0);
  page.run(2000);
  // 2000 ms (125 khung 16 ms) * 80 px/s = 160 px
  assert.ok(Math.abs(page.window.scrollY - 160) <= 2, `scrollY = ${page.window.scrollY}, cần ≈ 160`);
});

for (const type of ["touchstart", "touchmove", "pointerdown", "wheel", "keydown"]) {
  test(`${type} khi đang tự cuộn: dừng ngay`, () => {
    const page = opened();
    page.fire(type);
    const stoppedAt = page.window.scrollY;
    page.run(3000);
    assert.equal(page.window.scrollY, stoppedAt);
  });
}

test("cuộn do chính tự cuộn (sự kiện scroll) không làm nó dừng", () => {
  const page = opened(3000);
  assert.ok(page.moving());
});

test("chạm sau khi thiệp hiện, trước khi tự cuộn bắt đầu: không bắt đầu, 30 s sau mới chạy", () => {
  const page = load();
  page.armAutoScroll();
  page.run(500);
  page.fire("touchstart");
  page.run(600);
  page.startAutoScroll();
  page.run(28000); // 28,6 s sau lần chạm
  assert.equal(page.window.scrollY, 0);
  page.run(2400); // 31 s sau lần chạm
  assert.ok(page.moving(), "phải tự cuộn lại sau 30 s");
});

test("dừng → 30 s không thao tác → cuộn tiếp từ vị trí hiện tại, 80 px/s", () => {
  const page = opened();
  page.fire("touchstart");
  page.userScrollTo(1000); // khách vuốt trang tới 1000
  page.run(29000);
  assert.equal(page.window.scrollY, 1000, "chưa đủ 30 s thì đứng yên");
  page.run(2000); // 31 s
  const y = page.window.scrollY;
  assert.ok(y > 1000 && y < 1000 + 80 * 1.5, `cuộn tiếp từ 1000, đang ở ${y}`);
  page.run(2000);
  assert.ok(Math.abs(page.window.scrollY - y - 160) <= 2, `80 px/s: ${page.window.scrollY - y} px trong 2 s`);
});

test("thao tác ở giây 29 → đếm lại 30 s từ thao tác đó", () => {
  const page = opened();
  page.fire("touchstart");
  const stoppedAt = page.window.scrollY;
  page.run(29000);
  page.fire("touchstart");
  page.run(29000); // 58 s sau lần chạm đầu, 29 s sau lần cuối
  assert.equal(page.window.scrollY, stoppedAt);
  page.run(2000);
  assert.ok(page.moving());
});

test("khách tự cuộn (scroll) khi đã dừng cũng đếm lại 30 s", () => {
  const page = opened();
  page.fire("touchstart");
  page.run(20000);
  page.userScrollTo(1500);
  page.run(20000); // 40 s sau lần chạm, 20 s sau lần cuộn
  assert.equal(page.window.scrollY, 1500);
  page.run(11000);
  assert.ok(page.moving());
});

for (const [name, block, unblock] of [
  ["sheet (xác nhận tham dự, lời chúc)", (p) => p.setClass("v2-sheet-open", true), (p) => p.setClass("v2-sheet-open", false)],
  ["ảnh lớn (lightbox)", (p) => p.setClass("lg-on", true), (p) => p.setClass("lg-on", false)],
  ["ô nhập liệu đang focus", (p) => { p.document.activeElement = { tagName: "INPUT" }; }, (p) => { p.document.activeElement = null; }],
  ["ô nhập nhiều dòng đang focus", (p) => { p.document.activeElement = { tagName: "TEXTAREA" }; }, (p) => { p.document.activeElement = null; }],
]) {
  test(`${name}: không chạy lại khi đang mở; đóng → 30 s sau chạy`, () => {
    const page = opened();
    page.fire("pointerdown"); // chạm mở sheet / ảnh / ô nhập
    block(page);
    const stoppedAt = page.window.scrollY;
    page.run(35000);
    assert.equal(page.window.scrollY, stoppedAt, "đang mở thì không chạy lại");
    unblock(page);
    page.run(29000);
    assert.equal(page.window.scrollY, stoppedAt, "chưa đủ 30 s từ lúc đóng");
    page.run(2000);
    assert.ok(page.moving(), "đóng 30 s rồi phải chạy lại");
  });
}

test("tới cuối trang thì dừng ở cuối, không chạy lại", () => {
  const page = opened(60000);
  assert.equal(page.window.scrollY, 4200); // 5000 - 800
  page.run(60000);
  assert.equal(page.window.scrollY, 4200);
});

test("dừng rồi khách cuộn xuống cuối trang: không chạy lại; cuộn lên → 30 s sau chạy", () => {
  const page = opened();
  page.fire("touchstart");
  page.userScrollTo(4200);
  page.run(60000);
  assert.equal(page.window.scrollY, 4200);
  page.fire("touchstart");
  page.userScrollTo(3000);
  page.run(29000);
  assert.equal(page.window.scrollY, 3000);
  page.run(2000);
  assert.ok(page.moving());
});

test("prefers-reduced-motion: không tự cuộn, kể cả sau 30 s", () => {
  const page = opened(1000, { reducedMotion: true });
  page.run(60000);
  assert.equal(page.window.scrollY, 0);
});
