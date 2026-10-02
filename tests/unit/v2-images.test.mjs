// Unit test cho cặp ảnh nhỏ/lớn của thiệp v2 (docs/v2/gallery-grid.js), I1 "ảnh nhỏ trước, bản nét thay sau"
// (Human duyệt 2026-10-02). Hợp đồng C6: ảnh tải lên có cặp R2 `content/<uuid>-small.webp` /
// `content/<uuid>-large.webp`; asset trong repo cũng theo cặp `…-small.webp` / `…-large.webp`.
//   - URL khớp mẫu `…-small.webp` | `…-large.webp` (cùng thư mục, không query/hash) -> suy bản còn lại.
//   - URL không khớp mẫu -> dùng đúng URL đó cho cả hai bản (không suy, không thay ảnh).
//   - URL sai (không phải chuỗi, rỗng, giao thức khác http/https) -> bỏ qua: cả hai bản rỗng.
//   - Ảnh bìa: ô có wedding.coverImages -> suy từ URL đó; không có -> cặp small/large của ảnh album.
// Expected viết tay theo luật trên, không tính bằng hàm đang test.
// Chạy: node --test tests/unit/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../docs/v2/gallery-grid.js", import.meta.url), "utf8");
const window = {};
vm.runInNewContext(source, { window });
const plain = (value) => JSON.parse(JSON.stringify(value));
const imagePair = (...args) => plain(window.v2GalleryGrid.imagePair(...args));
const coverPairs = (...args) => plain(window.v2GalleryGrid.coverPairs(...args));

const WORKER = "https://thien-phuong-media.example.workers.dev/content";
const UUID = "0b6f3c2e-9a41-4d7e-8f1a-2c5d6e7f8a9b";

test("R2 content/<uuid>-small.webp <-> -large.webp: suy được cả hai chiều", () => {
  const expected = { small: `${WORKER}/${UUID}-small.webp`, large: `${WORKER}/${UUID}-large.webp` };
  assert.deepEqual(imagePair(`${WORKER}/${UUID}-small.webp`), expected);
  assert.deepEqual(imagePair(`${WORKER}/${UUID}-large.webp`), expected);
});

test("assets/…-small.webp <-> -large.webp: suy được cả hai chiều, giữ thư mục", () => {
  const expected = {
    small: "assets/images/photos/photo-04-small.webp",
    large: "assets/images/photos/photo-04-large.webp"
  };
  assert.deepEqual(imagePair("assets/images/photos/photo-04-small.webp"), expected);
  assert.deepEqual(imagePair("assets/images/photos/photo-04-large.webp"), expected);
});

test("URL không theo mẫu: dùng đúng URL đó cho cả hai bản, không suy", () => {
  for (const url of [
    "https://example.com/wedding/main.jpg",
    "assets/images/placeholder/landscape.svg",
    "assets/images/photos/photo-04-small.png",
    `${WORKER}/${UUID}-small.webp?v=2`,
    `${WORKER}/${UUID}-large.webp#x`,
    `${WORKER}/${UUID}-medium.webp`,
    `${WORKER}/${UUID}.webp`,
    `${WORKER}/-small.webp`
  ]) {
    assert.deepEqual(imagePair(url), { small: url, large: url }, url);
  }
});

test("URL sai: bỏ qua, cả hai bản rỗng", () => {
  for (const url of [
    undefined,
    null,
    42,
    "",
    "javascript:alert(1)//a-small.webp",
    "data:image/webp;base64,AAAA-small.webp",
    "ftp://example.com/content/a-small.webp"
  ]) {
    assert.deepEqual(imagePair(url), { small: "", large: "" }, String(url));
  }
});

test("http(s) và đường dẫn tương đối hợp lệ vẫn suy", () => {
  assert.deepEqual(imagePair("http://localhost:8194/assets/a-small.webp"), {
    small: "http://localhost:8194/assets/a-small.webp",
    large: "http://localhost:8194/assets/a-large.webp"
  });
  assert.deepEqual(imagePair("photo-small.webp"), { small: "photo-small.webp", large: "photo-large.webp" });
});

// Album 8 ảnh: ảnh i có small "s<i>", large "l<i>" (không theo mẫu -> lấy đúng cặp của album, không suy)
function album(flags = {}) {
  return Array.from({ length: 8 }, (_, i) => ({ small: `s${i}`, large: `l${i}`, ...(flags[i] || {}) }));
}

test("ảnh bìa không có coverImages: cặp small/large của 3 ảnh đầu băng ảnh Album", () => {
  assert.deepEqual(coverPairs(album()), [
    { small: "s0", large: "l0" },
    { small: "s1", large: "l1" },
    { small: "s2", large: "l2" }
  ]);
  const g = album({ 2: { featuredV2: true }, 6: { featuredV2: true } });
  assert.deepEqual(coverPairs(g), [
    { small: "s2", large: "l2" },
    { small: "s6", large: "l6" },
    { small: "s2", large: "l2" }
  ]);
});

test("ảnh bìa có coverImages: suy cặp từ URL đó, ô thiếu lấy từ album", () => {
  const covers = [`${WORKER}/${UUID}-large.webp`, "https://example.com/left.jpg"];
  assert.deepEqual(coverPairs(album(), covers), [
    { small: `${WORKER}/${UUID}-small.webp`, large: `${WORKER}/${UUID}-large.webp` },
    { small: "https://example.com/left.jpg", large: "https://example.com/left.jpg" },
    { small: "s2", large: "l2" }
  ]);
});

test("album rỗng, không coverImages: ô rỗng", () => {
  assert.deepEqual(coverPairs([], undefined), [
    { small: "", large: "" },
    { small: "", large: "" },
    { small: "", large: "" }
  ]);
});
