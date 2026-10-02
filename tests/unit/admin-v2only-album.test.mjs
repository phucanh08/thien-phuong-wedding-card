// Unit test cho ô "Hiện ở Album" của trình sửa nội dung (X1, ruling Human 2026-10-02: chỉ dùng thiệp v2).
//   - Mỗi ảnh album có đúng một ô; ô tick đúng những ảnh băng Album v2 đang hiện, theo luật gridItems
//     của docs/v2/gallery-grid.js: ảnh featuredV2 === true, chưa ảnh nào thì ảnh featured, không có thì 6 ảnh đầu.
//   - Sửa ô ghi gallery[].featuredV2 sao cho băng Album v2 = đúng các ô tick; featured không bao giờ bị đổi.
//   - Không cho bỏ tick ảnh cuối cùng (không ảnh nào thì v2 rơi về luật dự phòng).
// Expected viết tay theo luật trên; ngoài ra đối chiếu với gridItems thật của thiệp v2.
// Chạy: node --test tests/unit/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as model from "../../docs/admin/content-model.js";

// Gọi qua namespace: thiếu hàm thì từng test đỏ riêng thay vì cả file không nạp được.
const albumShown = (...args) => model.albumShown(...args);
const setAlbumShown = (...args) => model.setAlbumShown(...args);
const galleryCountText = (...args) => model.galleryCountText(...args);

const source = readFileSync(new URL("../../docs/v2/gallery-grid.js", import.meta.url), "utf8");
const window = {};
vm.runInNewContext(source, { window });
const v2Strip = (gallery) => JSON.parse(JSON.stringify(window.v2GalleryGrid.gridItems(gallery))).map((x) => x.index);

// Album n ảnh: ảnh i có small "s<i>"; flags: { i: { featured, featuredV2 } }
function album(n, flags = {}) {
  return Array.from({ length: n }, (_, i) => ({ small: `s${i}`, large: `l${i}`, ...(flags[i] || {}) }));
}
// Giống dữ liệu đang xuất bản: 17 ảnh, featured [0,2,3,12–15], featuredV2 [0,2,12].
function live() {
  const featured = { featured: true };
  return album(17, {
    0: { featured: true, featuredV2: true }, 2: { featured: true, featuredV2: true }, 3: featured,
    12: { featured: true, featuredV2: true }, 13: featured, 14: featured, 15: featured,
  });
}
const flags = (gallery, key) => gallery.flatMap((g, i) => (key in g ? [[i, g[key]]] : []));

test("ô tick đúng ảnh băng Album v2 đang hiện", () => {
  assert.deepEqual(albumShown(live()), [0, 2, 12]);
  // chưa có featuredV2: theo featured
  const old = live().map(({ featuredV2, ...rest }) => rest);
  assert.deepEqual(albumShown(old), [0, 2, 3, 12, 13, 14, 15]);
  // featuredV2 false = chưa chọn
  assert.deepEqual(albumShown(album(8, { 1: { featured: true, featuredV2: false }, 4: { featuredV2: false } })), [1]);
  // không chọn gì: 6 ảnh đầu; album ít ảnh: cả album
  assert.deepEqual(albumShown(album(9)), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(albumShown(album(2)), [0, 1]);
  assert.deepEqual(albumShown([]), []);
  assert.deepEqual(albumShown(undefined), []);
});

test("albumShown khớp gridItems của thiệp v2", () => {
  const cases = [
    live(), live().map(({ featuredV2, ...rest }) => rest), album(9), album(3), [],
    album(8, { 7: { featuredV2: true }, 1: { featured: true } }),
    album(8, { 0: { featured: true, featuredV2: false } }),
  ];
  for (const g of cases) assert.deepEqual(albumShown(g), v2Strip(g), JSON.stringify(g));
});

test("tick ảnh 5, bỏ ảnh 2: chỉ featuredV2 đổi, băng v2 = [0,5,12]", () => {
  const g = live();
  const featuredBefore = flags(g, "featured");
  assert.equal(setAlbumShown(g, 5, true), true);
  assert.equal(setAlbumShown(g, 2, false), true);
  assert.deepEqual(v2Strip(g), [0, 5, 12]);
  assert.deepEqual(albumShown(g), [0, 5, 12]);
  assert.deepEqual(flags(g, "featured"), featuredBefore);
  assert.deepEqual(flags(g, "featuredV2"), [[0, true], [5, true], [12, true]]);
  // phần còn lại của từng ảnh giữ nguyên
  assert.deepEqual(g.map(({ featured, featuredV2, ...rest }) => rest), album(17));
});

test("dữ liệu chưa có featuredV2: sửa một ô -> băng v2 = đúng tập đang tick", () => {
  const g = live().map(({ featuredV2, ...rest }) => rest);
  assert.equal(setAlbumShown(g, 5, true), true);
  assert.deepEqual(v2Strip(g), [0, 2, 3, 5, 12, 13, 14, 15]);
  assert.deepEqual(flags(g, "featured"), [[0, true], [2, true], [3, true], [12, true], [13, true], [14, true], [15, true]]);
  assert.equal(setAlbumShown(g, 13, false), true);
  assert.deepEqual(v2Strip(g), [0, 2, 3, 5, 12, 14, 15]);

  // không featured lẫn featuredV2: 6 ảnh đầu đang hiện; bỏ ảnh 0 -> còn 1–5
  const first6 = album(9);
  assert.equal(setAlbumShown(first6, 0, false), true);
  assert.deepEqual(v2Strip(first6), [1, 2, 3, 4, 5]);
  assert.deepEqual(flags(first6, "featured"), []);
});

test("không cho bỏ tick ảnh cuối cùng", () => {
  const g = live();
  assert.equal(setAlbumShown(g, 0, false), true);
  assert.equal(setAlbumShown(g, 2, false), true);
  const before = JSON.stringify(g);
  assert.equal(setAlbumShown(g, 12, false), false);
  assert.equal(JSON.stringify(g), before);
  assert.deepEqual(v2Strip(g), [12]);

  const one = album(1);
  assert.equal(setAlbumShown(one, 0, false), false);
  assert.deepEqual(v2Strip(one), [0]);
});

test("tick ảnh đang hiện / bỏ ảnh không hiện: không đổi gì", () => {
  const g = live();
  const before = JSON.stringify(g);
  assert.equal(setAlbumShown(g, 0, true), true);
  assert.equal(setAlbumShown(g, 7, false), true);
  assert.equal(JSON.stringify(g), before);
});

test("dòng đếm album nói theo một ô", () => {
  assert.equal(galleryCountText(live()), "17 ảnh · Hiện ở Album: 3 ảnh");
  assert.equal(galleryCountText(live().map(({ featuredV2, ...rest }) => rest)), "17 ảnh · Hiện ở Album: 7 ảnh");
  assert.equal(galleryCountText(album(9)), "9 ảnh · Hiện ở Album: 6 ảnh");
  assert.equal(galleryCountText([]), "0 ảnh");
});

// Trình sửa không còn ô Phiên bản thiệp, ô chỉ v1 dùng, hay ô Lưới v1/Lưới v2 (data các field đó vẫn
// giữ nguyên vì trình sửa sửa trên bản sao của data).
test("trình sửa không khai ô của v1", () => {
  const editor = readFileSync(new URL("../../docs/admin/content-editor.js", import.meta.url), "utf8");
  const paths = [
    ...[...editor.matchAll(/path:\s*`\$\{p\}\.(\w+)`/g)].map((m) => `*.${m[1]}`),
    ...[...editor.matchAll(/path:\s*"([\w.]+)"/g)].map((m) => m[1]),
  ];
  assert.ok(paths.length > 30, `quét được ${paths.length} path`);
  for (const gone of ["site.version", "*.photo", "*.bio", "*.facebook", "wedding.lunarText", "*.featured", "*.featuredV2"]) {
    assert.ok(!paths.includes(gone), gone);
  }
  // `${p}.image` còn đúng một ô: ảnh chuyện tình (ảnh sự kiện chỉ v1 dùng)
  assert.deepEqual(paths.filter((p) => p === "*.image"), ["*.image"]);
  assert.doesNotMatch(editor, /path:\s*`\$\{p\}\.image`, label: "Ảnh sự kiện"/);
  assert.ok(paths.includes("*.lunarText"), "events[].lunarText v2 vẫn dùng");
  assert.doesNotMatch(editor, /Lưới v[12]|Phiên bản thiệp|CARD_VERSIONS|setVersion/);
  const html = readFileSync(new URL("../../docs/admin/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /content-preview-version|Thiệp v1/);
});
