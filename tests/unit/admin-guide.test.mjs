// Mục "Hướng dẫn sử dụng" của trang quản lý (Human 2026-10-02):
//   - Cuối menu có mục "Hướng dẫn sử dụng", điều hướng bằng hash như các mục khác.
//   - Lần đầu một tài khoản vào được trang quản lý trên một trình duyệt → tự mở mục Hướng dẫn;
//     nhớ bằng localStorage theo tài khoản (uid), không ghi Firestore. Chưa vào được app (đang chặn ở
//     màn đổi mật khẩu / chưa có quyền) thì chưa tính là lần đầu.
// Đây là kiểm nguồn tĩnh + logic thuần; hành vi chạy thật được kiểm bằng harness WebKit trên emulator.
// Chạy: node --test tests/unit/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { claimFirstVisit } from "../../docs/admin/guide.js";

const read = (name) => readFileSync(new URL(`../../docs/admin/${name}`, import.meta.url), "utf8");
const html = read("index.html");
const js = read("admin.js");
const guideJs = read("guide.js");

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    data,
  };
}

// ---------- Markup ----------

test("menu có mục Hướng dẫn sử dụng ở cuối, trỏ tới #huong-dan", () => {
  const nav = html.slice(html.indexOf('<nav class="app-nav"'), html.indexOf("</nav>"));
  const links = [...nav.matchAll(/<a href="#([^"]+)" data-section="([^"]+)">([^<]*)<\/a>/g)];
  const last = links[links.length - 1];
  assert.ok(last, "menu không có mục nào");
  assert.equal(last[1], "huong-dan");
  assert.equal(last[2], "huong-dan");
  assert.equal(last[3], "Hướng dẫn sử dụng");
  assert.equal(links.length, 6, "5 mục cũ + Hướng dẫn");
});

test("có panel huong-dan và admin.js nhận hash huong-dan", () => {
  assert.match(html, /<section data-panel="huong-dan"[^>]*\bhidden>/);
  assert.match(js, /const SECTIONS = \[[^\]]*"huong-dan"[^\]]*\]/);
  // Mục cũ vẫn đứng nguyên thứ tự, mục mới ở cuối.
  assert.match(js, /\["khach-moi", "xac-nhan", "thong-ke", "noi-dung", "quan-tri", "huong-dan"\]/);
});

test("hướng dẫn nhắc đủ 6 nhóm việc, đúng tên nút trên giao diện", () => {
  const start = html.indexOf('<section data-panel="huong-dan"');
  const panel = html.slice(start, html.indexOf("</section>", start));
  for (const text of [
    "Khách mời", "Xác nhận", "lời chúc", "Thống kê", "Nội dung thiệp", "Quản trị viên", "Đăng xuất",
    "Copy link", "Thêm khách", "Lưu nháp", "Xuất bản", "Lịch sử", "Khôi phục", "Hiện ở Album",
    "Tạo tài khoản", "Thu hồi quyền", "Cấp lại quyền",
  ]) {
    assert.ok(panel.includes(text), `hướng dẫn thiếu "${text}"`);
  }
});

// ---------- Lần đầu đăng nhập ----------

test("claimFirstVisit: lần đầu true, các lần sau false", () => {
  const storage = fakeStorage();
  assert.equal(claimFirstVisit(storage, "uid-a"), true);
  assert.equal(claimFirstVisit(storage, "uid-a"), false);
  assert.equal(claimFirstVisit(storage, "uid-a"), false);
});

test("claimFirstVisit: nhớ theo tài khoản, tài khoản khác trên cùng máy vẫn là lần đầu", () => {
  const storage = fakeStorage();
  assert.equal(claimFirstVisit(storage, "uid-a"), true);
  assert.equal(claimFirstVisit(storage, "uid-b"), true);
  assert.equal(claimFirstVisit(storage, "uid-a"), false);
  assert.equal(claimFirstVisit(storage, "uid-b"), false);
});

test("claimFirstVisit: storage hỏng/bị chặn thì không tự mở (tránh mở mỗi lần đăng nhập)", () => {
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(claimFirstVisit(broken, "uid-a"), false);
  const readOnly = { getItem: () => null, setItem() { throw new Error("quota"); } };
  assert.equal(claimFirstVisit(readOnly, "uid-a"), false);
  assert.equal(claimFirstVisit(null, "uid-a"), false);
});

test("claimFirstVisit: không có uid thì không tính", () => {
  assert.equal(claimFirstVisit(fakeStorage(), ""), false);
  assert.equal(claimFirstVisit(fakeStorage(), null), false);
});

test("guide.js chỉ dùng localStorage-kiểu getItem/setItem, không chạm Firestore", () => {
  assert.doesNotMatch(guideJs, /^\s*import\b|setDoc|updateDoc|getFirestore/m);
});

// ---------- Nối vào admin.js ----------

test("admin.js tự mở hướng dẫn trong enterApp (sau khi qua màn đổi mật khẩu), không ở nơi khác", () => {
  const enter = js.slice(js.indexOf("function enterApp(user)"), js.indexOf("function currentSection()"));
  assert.match(enter, /claimFirstVisit\(browserStorage\(\), user\.uid\)/);
  assert.match(enter, /huong-dan/);
  // Màn đổi mật khẩu và màn chưa có quyền không được đụng tới.
  for (const fn of ["function showChangePassword(user)", "function showNoAccess(user)"]) {
    const body = js.slice(js.indexOf(fn), js.indexOf("}\n", js.indexOf(fn)));
    assert.doesNotMatch(body, /claimFirstVisit|huong-dan/, `${fn} không được mở hướng dẫn`);
  }
  // Chọn mục phải xảy ra sau khi đặt hash, để lần đầu vẽ đúng mục Hướng dẫn ngay.
  assert.ok(enter.indexOf("huong-dan") < enter.indexOf("showSection()"));
});
