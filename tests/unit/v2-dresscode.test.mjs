// Unit test cho docs/v2/dresscode.js: gom mục Dresscode của thiệp v2 (ruling Human 2026-10-02, theo mẫu
// "Nhà Có Hỷ" chỉ có MỘT hàng chấm màu, không ghi tên lễ).
//   - Mọi lễ có dressCode (sau khi bỏ mã màu sai) đều cùng bộ màu, cùng thứ tự -> một hàng, không tên lễ.
//   - Các lễ có bộ màu khác nhau -> mỗi lễ một hàng kèm tên lễ, theo thứ tự đầu vào.
//   - Lễ không có màu (thiếu / rỗng / toàn mã sai) không tính vào việc so bộ màu và không có hàng riêng.
//   - Không lễ nào có màu -> không hàng nào (thiệp ẩn mục).
//   - Mã màu sai bị bỏ; so bộ màu không phân biệt hoa thường.
// Expected viết tay theo luật trên, không tính bằng hàm đang test.
// Chạy: node --test tests/unit/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../docs/v2/dresscode.js", import.meta.url), "utf8");
const window = {};
vm.runInNewContext(source, { window });
// Mảng tạo trong context vm khác prototype với mảng của test: đưa về JSON thường trước khi so.
const plain = (value) => JSON.parse(JSON.stringify(value));
const dressRows = (events) => plain(window.v2Dresscode.dressRows(events));

const PALETTE = ["#ffffff", "#000000", "#f4c6cf", "#f3e7d3"];
const ev = (title, dressCode) => ({ title, ...(dressCode === undefined ? {} : { dressCode }) });

test("4 lễ cùng bộ màu: một hàng, không tên lễ", () => {
  const rows = dressRows([ev("Lễ A", PALETTE), ev("Lễ B", PALETTE), ev("Lễ C", PALETTE), ev("Lễ D", PALETTE)]);
  assert.deepEqual(rows, [{ title: null, colors: PALETTE }]);
});

test("bộ màu khác nhau: mỗi lễ một hàng kèm tên lễ, giữ thứ tự", () => {
  const rows = dressRows([ev("Lễ A", ["#111111", "#222222"]), ev("Lễ B", ["#333333"]), ev("Lễ C", ["#111111", "#222222"])]);
  assert.deepEqual(rows, [
    { title: "Lễ A", colors: ["#111111", "#222222"] },
    { title: "Lễ B", colors: ["#333333"] },
    { title: "Lễ C", colors: ["#111111", "#222222"] },
  ]);
});

test("cùng màu nhưng khác thứ tự là bộ khác: mỗi lễ một hàng", () => {
  const rows = dressRows([ev("Lễ A", ["#111111", "#222222"]), ev("Lễ B", ["#222222", "#111111"])]);
  assert.deepEqual(rows, [
    { title: "Lễ A", colors: ["#111111", "#222222"] },
    { title: "Lễ B", colors: ["#222222", "#111111"] },
  ]);
});

test("lễ không có màu (thiếu, rỗng, không phải mảng) bị bỏ; các lễ còn lại cùng bộ -> một hàng", () => {
  const rows = dressRows([ev("Lễ A", PALETTE), ev("Lễ B"), ev("Lễ C", []), ev("Lễ D", PALETTE), ev("Lễ E", "#ffffff")]);
  assert.deepEqual(rows, [{ title: null, colors: PALETTE }]);
});

test("lễ không có màu không có hàng riêng khi các lễ còn lại khác bộ", () => {
  const rows = dressRows([ev("Lễ A", ["#111111"]), ev("Lễ B"), ev("Lễ C", ["#222222"])]);
  assert.deepEqual(rows, [
    { title: "Lễ A", colors: ["#111111"] },
    { title: "Lễ C", colors: ["#222222"] },
  ]);
});

test("một lễ duy nhất có màu: một hàng không tên lễ", () => {
  assert.deepEqual(dressRows([ev("Lễ A"), ev("Lễ B", ["#abc", "#123456"])]), [{ title: null, colors: ["#abc", "#123456"] }]);
});

test("không lễ nào có màu (hoặc không có lễ): không hàng nào", () => {
  assert.deepEqual(dressRows([ev("Lễ A"), ev("Lễ B", []), ev("Lễ C", ["đỏ", "rgb(0,0,0)"])]), []);
  assert.deepEqual(dressRows([]), []);
});

test("mã màu sai bị bỏ khỏi bộ màu; lễ chỉ còn mã sai coi như không có màu", () => {
  const rows = dressRows([ev("Lễ A", ["#ffffff", "red", "javascript:1", 5, null, "#000000"]), ev("Lễ B", ["#ffffff", "#000000"]), ev("Lễ C", ["xyz"])]);
  assert.deepEqual(rows, [{ title: null, colors: ["#ffffff", "#000000"] }]);
});

test("so bộ màu không phân biệt hoa thường; giữ nguyên chữ của lễ đầu", () => {
  const rows = dressRows([ev("Lễ A", ["#FFFFFF", "#F4C6CF"]), ev("Lễ B", ["#ffffff", "#f4c6cf"])]);
  assert.deepEqual(rows, [{ title: null, colors: ["#FFFFFF", "#F4C6CF"] }]);
});
