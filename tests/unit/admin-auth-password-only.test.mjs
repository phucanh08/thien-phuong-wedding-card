// Trang quản lý chỉ đăng nhập bằng tên đăng nhập + mật khẩu (Human chọn 2026-10-02, bỏ Google).
//   - Không còn nút/chữ/mã Google ở màn đăng nhập và phần Quản trị viên.
//   - Không còn luồng tài khoản Google tự tạo yêu cầu `pending` chờ duyệt.
//   - Người đăng nhập được nhưng chưa có quyền gặp màn "chưa có quyền" (có đăng xuất), không được nạp dữ liệu.
// Đây là kiểm nguồn tĩnh; hành vi chạy thật được kiểm bằng harness WebKit trên emulator (xem handoff G1).
// Chạy: node --test tests/unit/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../../docs/admin/${name}`, import.meta.url), "utf8");
const html = read("index.html");
const js = read("admin.js");
const css = read("admin.css");

// Cắt đúng một <section id="..."> ... </section> của index.html.
function section(id) {
  const start = html.indexOf(`<section id="${id}"`);
  assert.ok(start >= 0, `thiếu section ${id}`);
  return html.slice(start, html.indexOf("</section>", start));
}

test("index.html, admin.js, admin.css không còn gì về Google", () => {
  for (const [name, text] of [["index.html", html], ["admin.js", js], ["admin.css", css]]) {
    assert.doesNotMatch(text, /google/i, `${name} còn chữ Google`);
  }
});

test("màn đăng nhập chỉ có form tên + mật khẩu, một nút Đăng nhập", () => {
  const login = section("view-login");
  assert.equal((login.match(/<button/g) || []).length, 1);
  assert.match(login, /id="btn-login"/);
  assert.match(login, /id="login-username"/);
  assert.match(login, /id="login-password"/);
  assert.doesNotMatch(login, /<svg/);
});

test("không còn luồng tài khoản chờ duyệt", () => {
  assert.doesNotMatch(js, /signInWithPopup|signInWithRedirect|GoogleAuthProvider/);
  assert.doesNotMatch(js, /status:\s*"pending"/, "không tự tạo yêu cầu pending");
  assert.doesNotMatch(html, /id="view-pending"|id="pending-badge"/);
  assert.doesNotMatch(html + js, /chờ duyệt/i);
});

test("có màn 'chưa có quyền' với nút đăng xuất", () => {
  const view = section("view-no-access");
  assert.match(view, /chưa có quyền/i);
  assert.match(view, /data-action="logout"/);
  assert.match(js, /showNoAccess\(user\)/);
});
