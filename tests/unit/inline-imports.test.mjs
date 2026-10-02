// Unit test cho import() động trong script module viết thẳng trong trang.
// Khung xem trước của trang quản lý ghi trang thiệp vào iframe mang URL /admin/ kèm <base> trỏ về gốc site.
// Chrome resolve import() của script inline theo base của tài liệu (gốc site), còn WebKit (Safari) resolve
// theo URL của chính tài liệu (/admin/). Specifier tương đối như './content-loader.js' vì vậy có thể trỏ
// tới /admin/content-loader.js trên Safari: 404, thiệp rơi về wedding-data.js dù đã xuất bản.
// (R1: thiệp nằm ở gốc site, /v1/ và /v2/ chỉ còn chuyển hướng; không trang nào còn import() inline:
// content-loader.js nạp qua module v2/v2.js, import() trong module resolve theo URL của module.)
// Test chạy từng script inline với import() được thay bằng hàm ghi lại specifier, rồi kiểm specifier
// trỏ tới file có thật theo cả hai cách resolve.
// Chạy: node --test tests/unit/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const DOCS = fileURLToPath(new URL("../../docs/", import.meta.url));
// Site nằm dưới một thư mục con như trên GitHub Pages
const SITE = "https://thiep.example/site/";

function inlineModules(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attrs]) => /\btype=["']module["']/i.test(attrs) && !/\bsrc=/i.test(attrs))
    .map(([, , body]) => body);
}

// Specifier mà các script module inline của trang truyền cho import() khi chạy ở documentUrl.
function importSpecifiers(html, documentUrl) {
  const base = html.match(/<base\s+href=["']([^"']+)["']/i);
  const baseURI = new URL(base ? base[1] : "", documentUrl).href;
  const specifiers = [];
  for (const body of inlineModules(html)) {
    const sandbox = {
      document: { baseURI, URL: documentUrl, querySelector: () => ({}) },
      location: new URL(documentUrl),
      URL,
      bootWeddingCard: { boot() {}, bootFallback() {} },
      __import(specifier) {
        specifiers.push(String(specifier));
        return new Promise(() => {});
      },
    };
    vm.runInNewContext(body.replace(/\bimport\(/g, "__import("), sandbox);
  }
  return { baseURI, specifiers };
}

// URL đã resolve -> file trong docs/, hoặc null nếu nằm ngoài site.
function siteFile(url) {
  const { origin, pathname } = new URL(url);
  const root = new URL(SITE);
  if (origin !== root.origin || !pathname.startsWith(root.pathname)) return null;
  return DOCS + decodeURIComponent(pathname.slice(root.pathname.length));
}

const PAGES = [
  // trang thiệp mở trực tiếp, và trang thiệp được ghi vào khung xem trước (iframe mang URL /admin/)
  { page: "index.html", urls: [SITE, `${SITE}?code=abcd2345#loi-chuc`, `${SITE}admin/#noi-dung`] },
  { page: "v1/index.html", urls: [`${SITE}v1/`, `${SITE}v1/?code=abcd2345`] },
  { page: "v2/index.html", urls: [`${SITE}v2/`, `${SITE}v2/?code=abcd2345`] },
];

for (const { page, urls } of PAGES) {
  const html = readFileSync(DOCS + page, "utf8");
  for (const documentUrl of urls) {
    test(`${page} ở ${documentUrl}: import() trong script inline trỏ tới file có thật dù resolve theo base hay theo URL tài liệu`, () => {
      const { baseURI, specifiers } = importSpecifiers(html, documentUrl);
      for (const specifier of specifiers) {
        for (const [rule, against] of [["base (Chrome)", baseURI], ["URL tài liệu (WebKit)", documentUrl]]) {
          const file = siteFile(new URL(specifier, against).href);
          assert.ok(file && existsSync(file),
            `import('${specifier}') resolve theo ${rule} ra ${new URL(specifier, against).href}: không có file trong docs/`);
        }
      }
    });
  }
}

test("thiệp ở gốc nạp content-loader.js qua module v2/v2.js; import() trong đó trỏ tới file có thật", () => {
  const html = readFileSync(DOCS + "index.html", "utf8");
  assert.deepEqual(importSpecifiers(html, SITE).specifiers, []);
  assert.match(html, /<script type="module" src="v2\/v2\.js"><\/script>/);
  const moduleUrl = `${SITE}v2/v2.js`;
  const specifiers = [...readFileSync(DOCS + "v2/v2.js", "utf8").matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)]
    .map(([, s]) => new URL(s, moduleUrl).href);
  assert.deepEqual(specifiers, [`${SITE}content-loader.js`, `${SITE}firebase-config.js`]);
  for (const url of specifiers) assert.ok(existsSync(siteFile(url)), url);
});
