// Unit test cho phần tự cuộn của docs/v2/card.js (S1, Human duyệt 2026-10-02):
//   - tốc độ 80 px/giây;
//   - khách chạm (touchstart/pointerdown), lăn chuột (wheel) hay bấm phím (keydown) là dừng ngay;
//   - thao tác từ lúc thiệp hiện ra (armAutoScroll) cũng tính: khách đã chạm/vuốt trước khi tự cuộn bắt
//     đầu thì tự cuộn không chạy; đã dừng thì không tự chạy lại.
// card.js là script thường nhiều DOM, không nạp được cả file trong node: test cắt đúng đoạn "Tự cuộn"
// (giữa hai tiêu đề mục) và chạy trong vm với window/requestAnimationFrame/đồng hồ giả.
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

// Trang dài 5000 px, khung 800 px; mỗi khung hình 16 ms
function load() {
  const listeners = new Map();
  let now = 0;
  let frames = new Map();
  let nextFrame = 1;
  const window = {
    scrollY: 0,
    innerHeight: 800,
    scrollTo(x, y) { window.scrollY = y; },
    addEventListener(type, fn) { listeners.set(type, (listeners.get(type) || new Set()).add(fn)); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
  };
  const context = {
    window,
    document: { documentElement: { scrollHeight: 5000 } },
    performance: { now: () => now },
    requestAnimationFrame(fn) { frames.set(nextFrame, fn); return nextFrame++; },
    cancelAnimationFrame(id) { frames.delete(id); },
    reducedMotion: false,
  };
  // Bản chưa có armAutoScroll (listener chỉ gắn khi bắt đầu cuộn) chạy như arm không làm gì
  vm.runInNewContext(`${speedLine}\n${section}
    this.api = { armAutoScroll: typeof armAutoScroll === "function" ? armAutoScroll : () => {}, startAutoScroll, stopAutoScroll };`, context);
  return {
    ...context.api,
    window,
    fire(type) { [...(listeners.get(type) || [])].forEach(fn => fn({ type })); },
    run(ms) {
      for (const end = now + ms; now < end;) {
        now += 16;
        const due = frames;
        frames = new Map();
        due.forEach(fn => fn(now));
      }
    },
  };
}

test("tốc độ 80 px/giây", () => {
  const page = load();
  page.armAutoScroll();
  page.startAutoScroll();
  page.run(2000);
  // 2000 ms (125 khung 16 ms) * 80 px/s = 160 px
  assert.ok(Math.abs(page.window.scrollY - 160) <= 2, `scrollY = ${page.window.scrollY}, cần ≈ 160`);
});

for (const type of ["touchstart", "pointerdown", "wheel", "keydown"]) {
  test(`${type} khi đang tự cuộn: dừng ngay, không chạy lại`, () => {
    const page = load();
    page.armAutoScroll();
    page.startAutoScroll();
    page.run(1000);
    page.fire(type);
    const stoppedAt = page.window.scrollY;
    page.run(3000);
    assert.equal(page.window.scrollY, stoppedAt);
  });
}

test("chạm sau khi thiệp hiện, trước khi tự cuộn bắt đầu: tự cuộn không chạy", () => {
  const page = load();
  page.armAutoScroll();
  page.run(500);
  page.fire("touchstart");
  page.startAutoScroll();
  page.run(3000);
  assert.equal(page.window.scrollY, 0);
});

test("tới cuối trang thì dừng ở cuối", () => {
  const page = load();
  page.armAutoScroll();
  page.startAutoScroll();
  page.run(60000);
  assert.equal(page.window.scrollY, 4200); // 5000 - 800
});
