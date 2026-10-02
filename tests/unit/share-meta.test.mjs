// Unit test cho thẻ chia sẻ link của thiệp (MI, Human 2026-10-02):
//   - máy đọc link của Zalo, Telegram, X, Messenger, Facebook không chạy JavaScript, nên title/description/og:*/
//     twitter:* phải nằm cố định trong <head> của docs/index.html (ngoại lệ của luật "không hard-code nội dung");
//   - og:image/twitter:image là URL tuyệt đối tới file có thật trong repo, kích thước khai trong thẻ khớp file;
//   - icon/apple-touch-icon là file PNG vuông có thật, đúng cỡ khai;
//   - robots noindex còn; applyMeta (card.js) chạy trong trình duyệt không được ghi rỗng/đè thẻ tĩnh bằng
//     giá trị rỗng hay ảnh giữ chỗ .svg.
// Giá trị expected viết tay theo ruling của Human, không tính từ code.
// Chạy: node --test tests/unit/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";

const DOCS = new URL("../../docs/", import.meta.url);
const ORIGIN = "https://thien-phuong-weddingcard.anhlp.com/";
const html = readFileSync(new URL("index.html", DOCS), "utf8");
const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
// Bỏ chú thích để thẻ nằm trong comment không bị tính là thẻ thật.
const headTags = head.replace(/<!--[\s\S]*?-->/g, "");

const TITLE = "Thiệp cưới Thiện & Phương · 25.10.2026";
const DESCRIPTION = "Trân trọng kính mời bạn đến dự lễ cưới của Nguyễn Đức Thiện & Triệu Thị Phương. " +
  "Lễ cưới nhà gái 06:30 · Lễ thành hôn nhà trai 10:00, Chủ nhật 25/10/2026.";

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1]] = m[2].replace(/&amp;/g, "&");
  return out;
}
const tags = (name) => [...headTags.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => attrs(m[0]));
const metas = tags("meta");
const links = tags("link");
const metaBy = (key, value) => metas.filter((m) => m[key] === value);
const content = (key, value) => {
  const found = metaBy(key, value);
  assert.equal(found.length, 1, `đúng một thẻ meta ${key}="${value}", có ${found.length}`);
  return found[0].content;
};

// Kích thước ảnh đọc từ chính file (PNG: IHDR, JPEG: SOF).
function imageSize(file) {
  const buf = readFileSync(new URL(file, DOCS));
  if (buf.readUInt32BE(0) === 0x89504e47) return { type: "image/png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  assert.equal(buf.readUInt16BE(0), 0xffd8, `${file} là JPEG hoặc PNG`);
  let i = 2;
  while (i < buf.length) {
    assert.equal(buf[i], 0xff);
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { type: "image/jpeg", height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  throw new Error(`${file}: không thấy SOF`);
}
const inRepo = (url) => {
  assert.ok(url.startsWith(ORIGIN), `${url} là URL tuyệt đối của tên miền thiệp`);
  const path = url.slice(ORIGIN.length);
  assert.ok(existsSync(new URL(path, DOCS)), `${path} có thật trong docs/`);
  return path;
};

test("title, description và og:/twitter: văn bản cố định trong <head>", () => {
  assert.equal(/<title>([^<]*)<\/title>/.exec(headTags)[1].replace(/&amp;/g, "&"), TITLE);
  assert.equal(content("name", "description"), DESCRIPTION);
  assert.equal(content("property", "og:type"), "website");
  assert.equal(content("property", "og:site_name"), "Thiện & Phương");
  assert.equal(content("property", "og:title"), TITLE);
  assert.equal(content("property", "og:description"), DESCRIPTION);
  assert.equal(content("property", "og:url"), ORIGIN);
  assert.equal(content("property", "og:locale"), "vi_VN");
  assert.equal(content("name", "twitter:title"), TITLE);
  assert.equal(content("name", "twitter:description"), DESCRIPTION);
});

test("ảnh chia sẻ: URL tuyệt đối tới file JPEG vuông có thật, kích thước khai khớp file", () => {
  const image = content("property", "og:image");
  const file = inRepo(image);
  const size = imageSize(file);
  assert.equal(size.type, "image/jpeg");
  assert.equal(size.width, size.height, "ảnh vuông");
  assert.ok(size.width >= 600 && size.width <= 1200, `cạnh ${size.width} trong 600–1200`);
  assert.ok(readFileSync(new URL(file, DOCS)).length <= 300 * 1024, "file ≤ 300 KB");
  assert.equal(content("property", "og:image:width"), String(size.width));
  assert.equal(content("property", "og:image:height"), String(size.height));
  assert.equal(content("property", "og:image:type"), "image/jpeg");
  assert.match(content("property", "og:image:alt"), /\S/);
  assert.equal(content("name", "twitter:image"), image);
  assert.match(content("name", "twitter:image:alt"), /\S/);
});

test("ảnh vuông dùng twitter:card=summary (summary_large_image của X cắt ảnh về 2:1, mất mặt)", () => {
  assert.equal(content("name", "twitter:card"), "summary");
});

test("icon và apple-touch-icon trỏ file PNG vuông có thật, đúng cỡ khai", () => {
  const byRel = (rel) => links.filter((l) => l.rel === rel);
  assert.equal(links.filter((l) => l.rel === "icon" && l.href === "data:,").length, 0, "không còn favicon data:,");
  for (const [rel, expected] of [["icon", 48], ["apple-touch-icon", 180]]) {
    const found = byRel(rel);
    assert.equal(found.length, 1, `đúng một link rel=${rel}`);
    assert.ok(!/^[a-z]+:|^\//i.test(found[0].href), `${rel} dùng đường dẫn tương đối (thiệp có thể mở qua <base>)`);
    assert.ok(existsSync(new URL(found[0].href, DOCS)), `${found[0].href} có thật`);
    const size = imageSize(found[0].href);
    assert.deepEqual([size.type, size.width, size.height], ["image/png", expected, expected]);
    assert.equal(found[0].sizes, `${expected}x${expected}`);
    assert.equal(found[0].type, "image/png");
  }
});

test("robots noindex, nofollow còn nguyên", () => {
  assert.equal(content("name", "robots"), "noindex, nofollow");
});

// ===== applyMeta chạy trong trình duyệt =====
// DOM giả dựng từ chính <head> thật; chỉ hỗ trợ các selector applyMeta dùng.
function fakeDocument() {
  const nodes = [
    ...metas.map((a) => ({ tagName: "META", a: { ...a } })),
    ...links.map((a) => ({ tagName: "LINK", a: { ...a } })),
  ].map((n) => ({
    tagName: n.tagName,
    getAttribute: (k) => (k in n.a ? n.a[k] : null),
    setAttribute: (k, v) => { n.a[k] = String(v); },
    removeAttribute: (k) => { delete n.a[k]; },
    attrs: n.a,
  }));
  return {
    title: TITLE,
    baseURI: ORIGIN,
    nodes,
    querySelector(selector) {
      const m = /^(meta|link)\[(name|property|rel)="([^"]+)"\]$/.exec(selector);
      assert.ok(m, `selector ${selector} nằm trong tập fake hỗ trợ`);
      return nodes.find((n) => n.tagName === m[1].toUpperCase() && n.attrs[m[2]] === m[3]) || null;
    },
  };
}

function runApplyMeta(data) {
  const source = readFileSync(new URL("v2/card.js", DOCS), "utf8");
  const start = source.indexOf("function applyMeta(D) {");
  const end = source.indexOf("// ===== Vẽ thiệp =====");
  assert.ok(start > 0 && end > start, "tìm thấy applyMeta trong card.js");
  const document = fakeDocument();
  const context = { document, URL };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}; this.applyMeta = applyMeta;`, context);
  context.applyMeta(data);
  return document;
}

const base = (meta) => ({
  couple: { groom: { shortName: "Thiện", fullName: "Nguyễn Đức Thiện" }, bride: { shortName: "Phương", fullName: "Triệu Thị Phương" } },
  meta,
});

test("applyMeta với dữ liệu dự phòng (ảnh giữ chỗ .svg) không đổi thẻ chia sẻ và favicon tĩnh", () => {
  const document = runApplyMeta(base({
    title: "Thiện & Phương Wedding",
    description: "mô tả khác",
    previewImage: "assets/images/placeholder/landscape.svg",
    favicon: "assets/images/placeholder/favicon.svg",
  }));
  const shareTags = (d) => d.nodes.filter((n) => /^(og:|twitter:|description$|robots$)/.test(n.attrs.property || n.attrs.name || ""));
  assert.deepEqual(shareTags(document).map((n) => n.attrs), shareTags(fakeDocument()).map((n) => n.attrs));
  const icon = document.nodes.find((n) => n.tagName === "LINK" && n.attrs.rel === "icon");
  assert.equal(icon.attrs.href, links.find((l) => l.rel === "icon").href);
});

test("applyMeta với dữ liệu thiếu/rỗng không ghi rỗng thẻ tĩnh hay tiêu đề", () => {
  const document = runApplyMeta(base({ title: "", description: "", previewImage: "", favicon: "" }));
  assert.equal(document.title, TITLE);
  for (const n of document.nodes) {
    for (const [k, v] of Object.entries(n.attrs)) assert.notEqual(v, "", `${n.tagName} ${JSON.stringify(n.attrs)}: ${k} rỗng`);
  }
  assert.equal(document.querySelector('meta[property="og:image"]').attrs.content, content("property", "og:image"));
});

test("applyMeta vẫn đặt tiêu đề tab và favicon từ dữ liệu khi favicon là ảnh thật", () => {
  const document = runApplyMeta(base({
    title: "Tiêu đề tab mới",
    description: "",
    previewImage: "assets/images/placeholder/landscape.svg",
    favicon: "https://media.example/content/abc-small.webp",
  }));
  assert.equal(document.title, "Tiêu đề tab mới");
  assert.equal(document.nodes.find((n) => n.tagName === "LINK" && n.attrs.rel === "icon").attrs.href, "https://media.example/content/abc-small.webp");
  assert.equal(document.querySelector('meta[property="og:image"]').attrs.content, content("property", "og:image"));
  assert.equal(document.querySelector('meta[property="og:title"]').attrs.content, TITLE);
});
