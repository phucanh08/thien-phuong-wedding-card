// Unit test cho docs/v2/gallery-grid.js: ảnh ở băng ảnh Album và ảnh bìa "With you" của thiệp v2 (G1,
// ruling Human 2026-10-02: field tuỳ chọn gallery[].featuredV2 = "lưới v2"; featured = "lưới v1").
//   - Có ảnh featuredV2 -> lưới v2 là các ảnh đó, theo thứ tự album.
//   - Không ảnh nào featuredV2 -> như lưới v1: ảnh featured, không có thì 6 ảnh đầu (dữ liệu cũ hiện y như trước).
//   - Ảnh bìa thiếu wedding.coverImages -> lấy từ lưới v2: [large ảnh 1, small ảnh 2, small ảnh 3], thiếu thì ảnh 1.
//   - index là chỉ số trong album: lightbox / "Tất cả hình ảnh" mở toàn album theo chỉ số này.
// Expected viết tay theo luật trên, không tính bằng hàm đang test.
// Chạy: node --test tests/unit/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../docs/v2/gallery-grid.js", import.meta.url), "utf8");
const window = {};
vm.runInNewContext(source, { window });
// Mảng tạo trong context vm khác prototype với mảng của test: đưa về JSON thường trước khi so.
const plain = (value) => JSON.parse(JSON.stringify(value));
const gridItems = (...args) => plain(window.v2GalleryGrid.gridItems(...args));
const coverSources = (...args) => plain(window.v2GalleryGrid.coverSources(...args));

// Album 8 ảnh: ảnh i có small "s<i>", large "l<i>"; flags: { i: { featured, featuredV2 } }
function album(flags = {}) {
  return Array.from({ length: 8 }, (_, i) => ({ small: `s${i}`, large: `l${i}`, ...(flags[i] || {}) }));
}
const indexes = (gallery) => gridItems(gallery).map((x) => x.index);

test("không có featured lẫn featuredV2: 6 ảnh đầu", () => {
  assert.deepEqual(indexes(album()), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(coverSources(album()), ["l0", "s1", "s2"]);
});

test("chỉ có featured (dữ liệu cũ): lưới v2 = lưới v1", () => {
  const g = album({ 1: { featured: true }, 3: { featured: true }, 5: { featured: true } });
  assert.deepEqual(indexes(g), [1, 3, 5]);
  assert.deepEqual(coverSources(g), ["l1", "s3", "s5"]);
});

test("có featuredV2: lưới v2 theo featuredV2, theo thứ tự album, bỏ qua featured", () => {
  const g = album({ 1: { featured: true }, 3: { featured: true }, 6: { featuredV2: true }, 2: { featuredV2: true } });
  assert.deepEqual(indexes(g), [2, 6]);
  assert.deepEqual(gridItems(g).map((x) => x.item.small), ["s2", "s6"]);
});

test("ảnh bìa thiếu coverImages lấy từ lưới v2; lưới ít ảnh thì dùng lại ảnh đầu", () => {
  const g = album({ 1: { featured: true }, 3: { featured: true }, 6: { featuredV2: true }, 2: { featuredV2: true } });
  assert.deepEqual(coverSources(g), ["l2", "s6", "s2"]);
  assert.deepEqual(coverSources(g, []), ["l2", "s6", "s2"]);
  assert.deepEqual(coverSources(album({ 4: { featuredV2: true } })), ["l4", "s4", "s4"]);
});

test("featuredV2 false ở mọi ảnh = chưa chọn: theo featured", () => {
  const g = album({ 0: { featured: true, featuredV2: false }, 7: { featured: true, featuredV2: false }, 3: { featuredV2: false } });
  assert.deepEqual(indexes(g), [0, 7]);
});

test("coverImages có giá trị thì dùng, ô thiếu lấy từ lưới v2", () => {
  const g = album({ 5: { featuredV2: true }, 6: { featuredV2: true }, 7: { featuredV2: true } });
  assert.deepEqual(coverSources(g, ["c0", "c1", "c2"]), ["c0", "c1", "c2"]);
  assert.deepEqual(coverSources(g, ["c0"]), ["c0", "s6", "s7"]);
});

test("featured (lưới v1) không ảnh hưởng lưới v2 khi đã có featuredV2", () => {
  const before = album({ 4: { featuredV2: true }, 5: { featuredV2: true } });
  const after = album({ 4: { featuredV2: true }, 5: { featuredV2: true }, 0: { featured: true }, 1: { featured: true } });
  assert.deepEqual(indexes(after), indexes(before));
  assert.deepEqual(coverSources(after), coverSources(before));
});
