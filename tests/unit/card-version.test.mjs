// Unit test cho phiên bản thiệp dùng chung (site.version, ruling C6 ngày 2026-10-02):
// "v1" | "v2" | "both"; thiếu hoặc sai giá trị -> "v1". Đường dẫn gốc đọc nó từ bản xuất bản;
// chưa xuất bản, đọc lỗi hoặc quá thời gian chờ -> "v1".
// Chạy: node --test tests/unit/
import { test } from "node:test";
import assert from "node:assert/strict";
import { cardVersion, CARD_VERSIONS } from "../../docs/admin/content-model.js";

// content-loader.js là module trình duyệt: cần window/location; fetch là rìa mạng nên được thay.
const FALLBACK = {
  couple: { groom: { shortName: "Thiện" }, bride: { shortName: "Phương" } },
  wedding: { dateISO: "2026-10-25" },
  events: [],
};
globalThis.window = { WEDDING_DATA: FALLBACK };
globalThis.location = { hostname: "thiep.example" };
const { loadWeddingContent, loadCardVersion } = await import("../../docs/content-loader.js");

const realFetch = globalThis.fetch;
const silence = () => {
  const warn = console.warn;
  console.warn = () => {};
  return () => { console.warn = warn; };
};

// Bản xuất bản hợp lệ, site là giá trị JS (undefined = không có field site).
function publishedDoc(site) {
  const data = { ...FALLBACK, ...(site === undefined ? {} : { site }) };
  return { fields: { data: encode(data) } };
}
function encode(v) {
  if (v === null) return { nullValue: null };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  if (typeof v === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)])) } };
  if (typeof v === "number") return { integerValue: String(v) };
  if (typeof v === "boolean") return { booleanValue: v };
  return { stringValue: v };
}
function serve(handler) {
  globalThis.fetch = handler;
}
const json = (body, status = 200) => async () => new Response(JSON.stringify(body), { status });

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

test("cardVersion: chỉ nhận v1/v2/both; thiếu hoặc sai -> v1", () => {
  assert.deepEqual(CARD_VERSIONS, ["v1", "v2", "both"]);
  assert.equal(cardVersion({ site: { version: "v1" } }), "v1");
  assert.equal(cardVersion({ site: { version: "v2" } }), "v2");
  assert.equal(cardVersion({ site: { version: "both" } }), "both");
  for (const site of [undefined, null, "v2", [], {}, { version: null }, { version: "V2" }, { version: " v2" },
    { version: "v3" }, { version: 2 }, { version: ["v2"] }]) {
    assert.equal(cardVersion({ site }), "v1", JSON.stringify(site));
  }
  assert.equal(cardVersion(null), "v1");
  assert.equal(cardVersion(undefined), "v1");
});

test("loadCardVersion: đọc site.version của bản xuất bản", async () => {
  for (const version of ["v1", "v2", "both"]) {
    serve(json(publishedDoc({ version })));
    assert.equal(await loadCardVersion(), version);
  }
});

test("loadCardVersion: bản xuất bản thiếu/sai site.version -> v1", async () => {
  for (const site of [undefined, { version: "v9" }, { version: "" }, "both"]) {
    serve(json(publishedDoc(site)));
    assert.equal(await loadCardVersion(), "v1", JSON.stringify(site));
  }
});

test("loadCardVersion: chưa xuất bản (404), lỗi mạng, bản xuất bản hỏng -> v1", async () => {
  const restore = silence();
  try {
    serve(json({ error: { code: 404 } }, 404));
    assert.equal(await loadCardVersion(), "v1");
    serve(async () => { throw new TypeError("Failed to fetch"); });
    assert.equal(await loadCardVersion(), "v1");
    serve(json({ fields: {} }));
    assert.equal(await loadCardVersion(), "v1");
    // Thiệp sẽ bỏ bản xuất bản thiếu tên (dùng dự phòng) -> đường gốc cũng không theo version của nó
    const broken = publishedDoc({ version: "v2" });
    broken.fields.data.mapValue.fields.couple = encode({ groom: { shortName: "" }, bride: { shortName: "Phương" } });
    serve(json(broken));
    assert.equal(await loadCardVersion(), "v1");
  } finally {
    restore();
  }
});

test("loadCardVersion: Firestore treo -> v1 ngay khi hết thời gian chờ", async () => {
  const restore = silence();
  try {
    serve((url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const t0 = Date.now();
    assert.equal(await loadCardVersion({ timeoutMs: 80 }), "v1");
    const ms = Date.now() - t0;
    assert.ok(ms >= 70 && ms < 1000, `${ms}ms`);
  } finally {
    restore();
  }
});

test("loadWeddingContent: data.site.version đã normalize, field lạ trong site giữ nguyên", async () => {
  serve(json(publishedDoc({ version: "both", ghiChu: "giữ tôi" })));
  let { data, source } = await loadWeddingContent();
  assert.equal(source, "published");
  assert.deepEqual(data.site, { version: "both", ghiChu: "giữ tôi" });

  serve(json(publishedDoc({ version: "v7" })));
  ({ data } = await loadWeddingContent());
  assert.deepEqual(data.site, { version: "v1" });

  serve(json(publishedDoc(undefined)));
  ({ data } = await loadWeddingContent());
  assert.deepEqual(data.site, { version: "v1" });
});

test("loadWeddingContent: dự phòng không có site -> site.version v1", async () => {
  const restore = silence();
  try {
    serve(json({}, 404));
    const { data, source } = await loadWeddingContent();
    assert.equal(source, "fallback");
    assert.equal(data.site.version, "v1");
  } finally {
    restore();
  }
});
