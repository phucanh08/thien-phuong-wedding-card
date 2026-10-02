// Unit test cho import() động trong script module viết thẳng trong trang thiệp (/v1/, /v2/).
// Các trang này có <base href="../">. Chrome resolve import() của script inline theo base của tài liệu
// (gốc site), còn WebKit (Safari) resolve theo URL của chính tài liệu (/v1/, hay /admin/ khi trang
// được ghi vào khung xem trước của trang quản lý). Specifier tương đối như './content-loader.js' vì vậy
// trỏ tới /v1/content-loader.js trên Safari: 404, thiệp rơi về wedding-data.js dù đã xuất bản.
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
      document: { baseURI, URL: documentUrl },
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
  { page: "v1/index.html", urls: [`${SITE}v1/`, `${SITE}v1/?code=abcd2345`, `${SITE}admin/#noi-dung`] },
  { page: "v2/index.html", urls: [`${SITE}v2/`, `${SITE}admin/#noi-dung`] },
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

test("v1/index.html nạp content-loader.js bằng import() trong script inline (test trên không rỗng)", () => {
  const html = readFileSync(DOCS + "v1/index.html", "utf8");
  const { baseURI, specifiers } = importSpecifiers(html, `${SITE}v1/`);
  assert.deepEqual(specifiers.map((s) => new URL(s, baseURI).href), [`${SITE}content-loader.js`]);
});
