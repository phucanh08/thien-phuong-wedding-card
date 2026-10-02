// Unit test cho đường vào thiệp sau khi bỏ v1 (X2, ruling Human 2026-10-02: chỉ dùng thiệp v2):
//   - `/`, `/?code=X`, `/?code=X#y` luôn tới /v2/, giữ nguyên ?code= và #hash; đường gốc vẫn đọc bản xuất
//     bản một lần (content-loader.js) trước khi chuyển, kể cả khi đọc lỗi vẫn chuyển sang v2;
//   - `/v1/`, `/v1/?code=X#y`, `/v1/index.html` chuyển sang /v2/ tương ứng; trang /v1/ chỉ còn chuyển hướng;
//   - không còn trang chọn "Cả 2"; site.version nằm trong data nhưng bị bỏ qua.
// Script inline của trang chạy trong vm với location/import() giả (rìa trình duyệt).
// Chạy: node --test tests/unit/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const DOCS = new URL("../../docs/", import.meta.url);
const SITE = "https://thiep.example/site/";
const read = (page) => readFileSync(new URL(page, DOCS), "utf8");

function inlineScripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attrs]) => !/\bsrc=/i.test(attrs) && !/\bnomodule\b/i.test(attrs))
    .map(([, , body]) => body);
}

// Chạy các script inline của trang ở documentUrl; trả URL tuyệt đối mà trang chuyển tới (location.replace).
async function landing(page, documentUrl, { loader } = {}) {
  const url = new URL(documentUrl);
  const replaced = [];
  const imports = [];
  const link = { href: "" };
  const sandbox = {
    location: {
      href: url.href, search: url.search, hash: url.hash, hostname: url.hostname,
      replace(target) { replaced.push(new URL(target, url).href); },
    },
    document: {
      baseURI: url.href,
      querySelector: () => link,
      querySelectorAll: () => [],
      getElementById: () => ({ hidden: false }),
    },
    console: { warn() {}, log() {}, error() {} },
    URL,
    __import(specifier) {
      imports.push(new URL(specifier, url).href);
      return loader ? loader() : Promise.resolve({ preloadPublished: async () => {} });
    },
  };
  for (const body of inlineScripts(read(page))) {
    // Script cần DOM thật (vd. markup thiệp) thì bỏ qua: chỉ quan tâm trang có chuyển hướng hay không.
    try { vm.runInNewContext(body.replace(/\bimport\(/g, "__import("), sandbox); } catch {}
  }
  for (let i = 0; i < 20 && !replaced.length; i++) await new Promise((r) => setTimeout(r, 5));
  return { replaced, imports };
}

const CASES = [
  ["index.html", `${SITE}`, `${SITE}v2/`],
  ["index.html", `${SITE}?code=abcd2345`, `${SITE}v2/?code=abcd2345`],
  ["index.html", `${SITE}?code=abcd2345#loi-chuc`, `${SITE}v2/?code=abcd2345#loi-chuc`],
  ["v1/index.html", `${SITE}v1/`, `${SITE}v2/`],
  ["v1/index.html", `${SITE}v1/?code=abcd2345#loi-chuc`, `${SITE}v2/?code=abcd2345#loi-chuc`],
  ["v1/index.html", `${SITE}v1/index.html`, `${SITE}v2/`],
  ["v1/index.html", `${SITE}v1/index.html?code=abcd2345#y`, `${SITE}v2/?code=abcd2345#y`],
];

for (const [page, from, to] of CASES) {
  test(`${from} -> ${to}`, async () => {
    const { replaced } = await landing(page, from);
    assert.deepEqual(replaced, [to]);
  });
}

test("đường gốc vẫn đọc bản xuất bản một lần (content-loader.js) trước khi chuyển", async () => {
  let preloaded = 0;
  const { replaced, imports } = await landing("index.html", `${SITE}?code=abcd2345`, {
    loader: async () => ({ preloadPublished: async () => { preloaded++; } }),
  });
  assert.deepEqual(imports, [`${SITE}content-loader.js`]);
  assert.equal(preloaded, 1);
  assert.deepEqual(replaced, [`${SITE}v2/?code=abcd2345`]);
});

test("đường gốc: content-loader.js lỗi vẫn mở v2", async () => {
  const { replaced } = await landing("index.html", `${SITE}?code=abcd2345#y`, {
    loader: () => Promise.reject(new TypeError("Failed to fetch dynamically imported module")),
  });
  assert.deepEqual(replaced, [`${SITE}v2/?code=abcd2345#y`]);
});

test("không còn trang chọn phiên bản; dự phòng không JS / không module trỏ tới v2", () => {
  const root = read("index.html");
  assert.doesNotMatch(root, /data-version|chooser|v1\//);
  assert.match(root, /<noscript><meta http-equiv="refresh" content="0; url=v2\/"><\/noscript>/);
  assert.match(root, /<script nomodule>[\s\S]*location\.replace\('v2\/' \+ location\.search \+ location\.hash\)/);
});

test("trang /v1/ chỉ còn chuyển hướng, không còn markup/asset của v1", () => {
  const page = read("v1/index.html");
  assert.ok(page.length < 1500, `${page.length} ký tự`);
  assert.doesNotMatch(page, /template135|wedding-data|content-loader|<section|<img/);
  assert.match(page, /<noscript><meta http-equiv="refresh" content="0; url=\.\.\/v2\/"><\/noscript>/);
});

test("cardVersion / CARD_VERSIONS không còn trong content-loader.js và admin/content-model.js", async () => {
  assert.doesNotMatch(read("content-loader.js"), /cardVersion|CARD_VERSIONS|loadCardVersion/);
  const model = await import("../../docs/admin/content-model.js");
  assert.equal("cardVersion" in model, false);
  assert.equal("CARD_VERSIONS" in model, false);
});
