// Unit test cho đường vào thiệp sau khi bỏ /v2 (R1, Human 2026-10-02: "bỏ /v2 đi, giờ chỉ dùng 1 template"):
//   - `/`, `/?code=X`, `/?code=X#y` vẽ thiệp ngay tại địa chỉ đó: trang gốc là trang thiệp, không chuyển hướng;
//   - mọi đường dẫn tương đối của trang thiệp (script, css, ảnh) trỏ tới file có thật tính từ gốc site;
//   - link cũ `/v2/`, `/v2/?code=X#y`, `/v2/index.html`, `/v1/…` chuyển về `/` tương ứng, giữ ?code= và #hash;
//   - không còn trang chọn "Cả 2"; site.version nằm trong data nhưng bị bỏ qua.
// Script inline của trang chạy trong vm với location/import()/fetch/sessionStorage giả (rìa trình duyệt).
// Chạy: node --test tests/unit/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const DOCS = new URL("../../docs/", import.meta.url);
const SITE = "https://thiep.example/site/";
const read = (page) => readFileSync(new URL(page, DOCS), "utf8");

function inlineScripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attrs]) => !/\bsrc=/i.test(attrs) && !/\bnomodule\b/i.test(attrs))
    .map(([, , body]) => body);
}

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
}

// Chạy các script inline của trang ở documentUrl; trả URL tuyệt đối mà trang chuyển tới (location.replace),
// các import() và fetch() trang gọi. session: sessionStorage chung giữa các lượt mở (cùng tab).
async function landing(page, documentUrl, { session, withFetch = false } = {}) {
  const url = new URL(documentUrl);
  const replaced = [];
  const imports = [];
  const fetches = [];
  const sandbox = {
    location: {
      href: url.href, search: url.search, hash: url.hash, hostname: url.hostname,
      replace(target) { replaced.push(new URL(target, url).href); },
    },
    document: {
      baseURI: url.href,
      querySelector: () => ({ href: "" }),
      querySelectorAll: () => [],
      getElementById: () => ({ hidden: false }),
    },
    console: { warn() {}, log() {}, error() {} },
    URL,
    setTimeout: (fn, ms) => setTimeout(fn, ms).unref(),
    __import(specifier) {
      imports.push(new URL(specifier, url).href);
      return Promise.resolve({ preloadPublished: async () => {} });
    },
  };
  if (session) sandbox.sessionStorage = session;
  if (withFetch) {
    sandbox.fetch = (input, init = {}) => {
      fetches.push({ url: new URL(input, url).href, cache: init.cache });
      return Promise.resolve({ ok: true });
    };
  }
  for (const body of inlineScripts(read(page))) {
    // Script cần DOM thật (vd. markup thiệp) thì bỏ qua: chỉ quan tâm trang có chuyển hướng hay không.
    try { vm.runInNewContext(body.replace(/\bimport\(/g, "__import("), sandbox); } catch {}
  }
  for (let i = 0; i < 20 && !replaced.length; i++) await new Promise((r) => setTimeout(r, 5));
  return { replaced, imports, fetches };
}

for (const from of [SITE, `${SITE}?code=abcd2345`, `${SITE}?code=abcd2345#loi-chuc`]) {
  test(`${from} vẽ thiệp tại chỗ: không chuyển hướng, không import() inline`, async () => {
    const { replaced, imports } = await landing("index.html", from);
    assert.deepEqual(replaced, []);
    assert.deepEqual(imports, []);
  });
}

test("trang gốc là trang thiệp (phong bì, script thiệp), không có <base>", () => {
  const root = read("index.html");
  assert.match(root, /id="v2-envelope"/);
  assert.match(root, /<script src="v2\/card\.js"><\/script>/);
  assert.match(root, /<script type="module" src="v2\/v2\.js"><\/script>/);
  assert.match(root, /<script src="wedding-data\.js"><\/script>/);
  assert.doesNotMatch(root, /<base\s+href/i);
  assert.doesNotMatch(root, /<meta http-equiv="refresh"|location\.replace\(/);
});

// Đường dẫn tương đối trong src/href của trang (bỏ #, data:, http(s):, //) tính từ gốc site.
function relativeRefs(html) {
  return [...html.matchAll(/\b(?:src|href)="([^"]*)"/g)].map(([, v]) => v)
    .filter((v) => v && !/^(?:#|data:|https?:|\/\/|mailto:|tel:)/i.test(v));
}

test("mọi đường dẫn tương đối của trang gốc trỏ tới file có thật trong docs/", () => {
  const refs = relativeRefs(read("index.html"));
  assert.ok(refs.length >= 15, `${refs.length} đường dẫn`);
  for (const ref of refs) {
    const resolved = new URL(ref, SITE);
    assert.ok(resolved.href.startsWith(SITE), `${ref} ra ngoài site: ${resolved.href}`);
    const file = fileURLToPath(new URL(decodeURIComponent(resolved.pathname.slice(new URL(SITE).pathname.length)), DOCS));
    assert.ok(existsSync(file), `${ref} -> ${resolved.href}: không có file`);
  }
});

const REDIRECTS = [
  ["v2/index.html", `${SITE}v2/`, SITE],
  ["v2/index.html", `${SITE}v2/?code=abcd2345`, `${SITE}?code=abcd2345`],
  ["v2/index.html", `${SITE}v2/?code=abcd2345#loi-chuc`, `${SITE}?code=abcd2345#loi-chuc`],
  ["v2/index.html", `${SITE}v2/index.html`, SITE],
  ["v2/index.html", `${SITE}v2/index.html?code=abcd2345#y`, `${SITE}?code=abcd2345#y`],
  ["v1/index.html", `${SITE}v1/`, SITE],
  ["v1/index.html", `${SITE}v1/?code=abcd2345#loi-chuc`, `${SITE}?code=abcd2345#loi-chuc`],
  ["v1/index.html", `${SITE}v1/index.html`, SITE],
  ["v1/index.html", `${SITE}v1/index.html?code=abcd2345#y`, `${SITE}?code=abcd2345#y`],
];

for (const [page, from, to] of REDIRECTS) {
  test(`${from} -> ${to}`, async () => {
    const { replaced } = await landing(page, from);
    assert.deepEqual(replaced, [to]);
  });
}

for (const page of ["v1/index.html", "v2/index.html"]) {
  test(`${page} chỉ còn chuyển hướng về gốc, không còn markup/asset của thiệp`, () => {
    const html = read(page);
    assert.ok(html.length < 2500, `${html.length} ký tự`);
    assert.doesNotMatch(html, /template135|wedding-data|content-loader|card\.js|<section|<img/);
    assert.match(html, /<noscript><meta http-equiv="refresh" content="0; url=\.\.\/"><\/noscript>/);
  });
}

// Trang gốc bản cũ (chuyển sang /v2/) còn trong cache trình duyệt sau khi site cập nhật: /v2/ chuyển về
// gốc, trình duyệt lại mở bản cũ trong cache, bản đó lại chuyển sang /v2/... Lần thứ hai liên tiếp tới
// /v2/ trong cùng tab thì tải lại trang gốc bỏ qua cache trước khi chuyển.
test("/v2/ lần đầu chuyển ngay; tới lại ngay sau đó thì tải lại trang gốc (cache: reload) rồi mới chuyển", async () => {
  const session = new MemoryStorage();
  const first = await landing("v2/index.html", `${SITE}v2/?code=abcd2345#y`, { session, withFetch: true });
  assert.deepEqual(first.fetches, []);
  assert.deepEqual(first.replaced, [`${SITE}?code=abcd2345#y`]);

  const again = await landing("v2/index.html", `${SITE}v2/?code=abcd2345#y`, { session, withFetch: true });
  // Cache trình duyệt theo cả query: tải lại đúng URL sắp chuyển tới (không có #hash)
  assert.deepEqual(again.fetches, [{ url: `${SITE}?code=abcd2345`, cache: "reload" }]);
  assert.deepEqual(again.replaced, [`${SITE}?code=abcd2345#y`]);
});

test("/v2/: sessionStorage bị chặn hay không có fetch vẫn chuyển về gốc", async () => {
  const blocked = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  for (const options of [{ session: blocked, withFetch: true }, { session: new MemoryStorage() }]) {
    await landing("v2/index.html", `${SITE}v2/`, options);
    const { replaced } = await landing("v2/index.html", `${SITE}v2/?code=abcd2345`, options);
    assert.deepEqual(replaced, [`${SITE}?code=abcd2345`]);
  }
});

test("không còn trang chọn phiên bản", () => {
  assert.doesNotMatch(read("index.html"), /data-version|chooser|v1\//);
});

test("cardVersion / CARD_VERSIONS không còn trong content-loader.js và admin/content-model.js", async () => {
  assert.doesNotMatch(read("content-loader.js"), /cardVersion|CARD_VERSIONS|loadCardVersion/);
  const model = await import("../../docs/admin/content-model.js");
  assert.equal("cardVersion" in model, false);
  assert.equal("CARD_VERSIONS" in model, false);
});
