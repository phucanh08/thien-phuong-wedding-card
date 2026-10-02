// Unit test cho khung xem trước của trang quản lý (docs/admin/content-preview.js) sau khi thiệp chuyển
// về gốc site (R1): khung ghi đúng HTML của trang gốc (index.html, cùng HTML khách mở ở /), kèm <base>
// trỏ về gốc site trước mọi đường dẫn tương đối, vì iframe mang URL của trang quản lý (/admin/).
// fetch và iframe là rìa trình duyệt nên được thay; HTML là file thật trong docs/.
// Chạy: node --test tests/unit/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DOCS = new URL("../../docs/", import.meta.url);

// Iframe giả: ghi lại HTML được document.write; thiệp "vẽ xong" ngay (data-content-source có sẵn).
function fakeDom() {
  const frames = [];
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, "iframe");
      const written = [];
      const frame = {
        classList: { remove() {}, contains: () => false },
        remove() {},
        getClientRects: () => [{}],
        written,
        contentDocument: { open() {}, write(html) { written.push(html); }, close() {} },
        contentWindow: {
          scrollY: 0,
          scrollTo() {},
          document: { documentElement: { dataset: { contentSource: "published" }, classList: { contains: () => false } } },
        },
      };
      frames.push(frame);
      return frame;
    },
  };
  return frames;
}

test("xem trước ghi HTML của trang gốc (index.html) kèm <base> về gốc site; đường dẫn tương đối đều có file", async () => {
  const frames = fakeDom();
  const fetched = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    const file = fileURLToPath(url);
    return existsSync(file) ? new Response(readFileSync(file, "utf8")) : new Response("", { status: 404 });
  };
  try {
    const { createPreview } = await import("../../docs/admin/content-preview.js");
    const states = [];
    const preview = createPreview({ container: { append() {}, replaceChildren() {} }, onState: (s) => states.push(s) });
    preview.update({ couple: { groom: { shortName: "Thiện" } } }, { immediate: true });
    for (let i = 0; i < 100 && !states.some((s) => s.state === "ready" || s.state === "error"); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.deepEqual(states.at(-1), { state: "ready", source: "published" });
    assert.deepEqual(fetched, [new URL("index.html", DOCS).href]);

    const html = frames[0].written.join("");
    const root = readFileSync(new URL("index.html", DOCS), "utf8");
    assert.match(root, /id="v2-envelope"/, "trang gốc là trang thiệp");
    const base = html.match(/<base href="([^"]+)">/);
    assert.ok(base, "có <base>");
    assert.equal(base[1], DOCS.href);
    // <base> đứng trước mọi src/href (đường dẫn tương đối tính theo base từ đầu)
    assert.ok(html.indexOf(base[0]) < html.search(/\b(?:src|href)="(?!data:)/), "<base> nằm trước đường dẫn đầu tiên");
    // Phần còn lại đúng là trang gốc
    assert.equal(html.replace(/<base href="[^"]+">/, "").replace(/<script>\(function \(\) \{[\s\S]*?\}\)\(\);<\/script>/, ""), root);

    const refs = [...root.matchAll(/\b(?:src|href)="([^"]*)"/g)].map(([, v]) => v)
      .filter((v) => v && !/^(?:#|data:|https?:|\/\/)/i.test(v));
    assert.ok(refs.length >= 15, `${refs.length} đường dẫn`);
    for (const ref of refs) {
      assert.ok(existsSync(fileURLToPath(new URL(ref, base[1]))), `${ref} theo <base> không có file`);
    }
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.document;
  }
});
