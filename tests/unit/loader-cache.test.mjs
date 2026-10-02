// Unit test cho đường nạp nội dung của khách (F1c, Human duyệt 2026-10-02):
// - Qua đường gốc /?code=: chỉ chờ Firestore một lần. Trang phiên bản (/v1/, /v2/) dùng lại kết quả
//   đường gốc vừa đọc (thành công hay quá giờ), không đọc lại, không chờ lần hai.
// - Máy đã từng tải được bản xuất bản: đọc mới không kịp / lỗi mạng -> bản đã lưu (source 'cached');
//   chưa có bản lưu -> wedding-data.js (source 'fallback'). Bản lưu cũ hơn không đè bản mới.
// Mỗi trang là một lần import content-loader.js mới (?trang=...), như hai document thật; chúng chỉ
// chung sessionStorage/localStorage. fetch, storage và đồng hồ là rìa hệ thống nên được thay.
// Chạy: node --test tests/unit/
import { test } from "node:test";
import assert from "node:assert/strict";

const FALLBACK = {
  couple: { groom: { shortName: "Thiện" }, bride: { shortName: "Phương" } },
  wedding: { dateISO: "2026-10-25" },
  events: [],
  music: { title: "TODO", src: "" },
};

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
const local = new MemoryStorage();
const session = new MemoryStorage();
globalThis.window = { WEDDING_DATA: FALLBACK, localStorage: local, sessionStorage: session };
globalThis.location = { hostname: "thiep.example" };

let pageNo = 0;
// Một document mới trên cùng máy, cùng tab
const openPage = () => import(`../../docs/content-loader.js?trang=${++pageNo}`);

const realFetch = globalThis.fetch;
const realNow = Date.now;
let calls = 0;
function serve(handler) {
  calls = 0;
  globalThis.fetch = (...args) => { calls++; return handler(...args); };
}
function encode(v) {
  if (v === null) return { nullValue: null };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  if (typeof v === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)])) } };
  if (typeof v === "number") return { integerValue: String(v) };
  if (typeof v === "boolean") return { booleanValue: v };
  return { stringValue: v };
}
// Bản xuất bản: groom là tên hiện trên thiệp để nhận ra bản nào được vẽ; updateTime do Firestore đặt.
function published(groom, updateTime, extra = {}) {
  const data = { ...FALLBACK, couple: { groom: { shortName: groom }, bride: { shortName: "Phương" } }, ...extra };
  return { name: "projects/p/databases/(default)/documents/siteContent/published", fields: { data: encode(data) }, updateTime };
}
const ok = (doc) => async () => new Response(JSON.stringify(doc), { status: 200 });
const notFound = async () => new Response(JSON.stringify({ error: { code: 404 } }), { status: 404 });
// Firestore treo: không trả lời tới khi bị huỷ; mạng tự bỏ sau 1.5s để test không giữ request nền lâu
const hang = (url, { signal }) => new Promise((resolve, reject) => {
  signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  setTimeout(() => reject(new TypeError("network timeout")), 1500);
});
const offline = async () => { throw new TypeError("Failed to fetch"); };
const later = (doc, ms) => () => new Promise((resolve) => setTimeout(() => resolve(new Response(JSON.stringify(doc), { status: 200 })), ms));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const groomOf = ({ data }) => data.couple.groom.shortName;

const T1 = "2026-10-02T08:00:00.000001Z";
const T2 = "2026-10-02T09:30:00.5Z";
const T3 = "2026-10-02T10:00:00Z";

let restoreWarn;
test.beforeEach(() => {
  local.clear();
  session.clear();
  const warn = console.warn;
  console.warn = () => {};
  restoreWarn = () => { console.warn = warn; };
});
test.afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
  restoreWarn();
});

// Lượt khách qua /?code=: đường gốc chọn phiên bản rồi trang phiên bản vẽ.
async function rootThenCard({ rootTimeout, cardTimeout } = {}) {
  const root = await openPage();
  const version = await root.loadCardVersion(rootTimeout ? { timeoutMs: rootTimeout } : undefined);
  const card = await openPage();
  const t0 = realNow();
  const content = await card.loadWeddingContent(cardTimeout ? { timeoutMs: cardTimeout } : undefined);
  return { version, ...content, cardMs: realNow() - t0 };
}

test("(A) qua /?code=: cả lượt chỉ đọc siteContent/published một lần", async () => {
  for (const version of ["v1", "v2"]) {
    local.clear();
    serve(ok(published("Thiện mới", T1, { site: { version } })));
    const r = await rootThenCard();
    assert.equal(r.version, version);
    assert.equal(r.source, "published");
    assert.equal(groomOf(r), "Thiện mới");
    assert.equal(calls, 1, `${version}: ${calls} request`);
  }
});

test("(A) Firestore treo: trang phiên bản không chờ lần hai sau khi đường gốc đã hết giờ", async () => {
  serve(hang);
  const r = await rootThenCard({ rootTimeout: 80 });
  assert.equal(r.version, "v1");
  assert.equal(r.source, "fallback");
  assert.ok(r.cardMs < 400, `trang phiên bản chờ ${r.cardMs}ms`);
});

test("(A) mở thẳng /v1/ hoặc tải lại trang phiên bản: đọc Firestore như cũ", async () => {
  serve(ok(published("Thiện", T1)));
  const direct = await (await openPage()).loadWeddingContent();
  assert.equal(direct.source, "published");
  assert.equal(calls, 1);

  // Kết quả của đường gốc chỉ dùng một lần: tải lại trang phiên bản thì đọc lại
  serve(ok(published("Thiện", T1)));
  await rootThenCard();
  assert.equal(calls, 1);
  serve(ok(published("Thiện sau tải lại", T2)));
  const reload = await (await openPage()).loadWeddingContent();
  assert.equal(groomOf(reload), "Thiện sau tải lại");
  assert.equal(calls, 1);
});

test("(A) kết quả đường gốc đã cũ (trang phiên bản mở muộn) -> đọc lại, không dùng", async () => {
  serve(ok(published("Thiện cũ", T1)));
  await (await openPage()).loadCardVersion();
  Date.now = () => realNow() + 10 * 60 * 1000;
  serve(ok(published("Thiện mới", T2)));
  const r = await (await openPage()).loadWeddingContent();
  assert.equal(groomOf(r), "Thiện mới");
  assert.equal(calls, 1);
});

test("(B) chưa có bản lưu: quá giờ hoặc mất mạng -> wedding-data.js", async () => {
  serve(hang);
  let r = await (await openPage()).loadWeddingContent({ timeoutMs: 60 });
  assert.equal(r.source, "fallback");
  assert.equal(groomOf(r), "Thiện");
  serve(offline);
  r = await (await openPage()).loadWeddingContent({ timeoutMs: 60 });
  assert.equal(r.source, "fallback");
});

test("(B) đã tải thành công một lần: lần sau quá giờ / mất mạng -> bản đã lưu, không trộn dự phòng", async () => {
  serve(ok(published("Thiện đã lưu", T1, { music: { title: "Bài đã lưu", src: "https://cdn.example/a.mp3" } })));
  assert.equal((await (await openPage()).loadWeddingContent()).source, "published");

  serve(hang);
  let r = await (await openPage()).loadWeddingContent({ timeoutMs: 60 });
  assert.equal(r.source, "cached");
  assert.equal(groomOf(r), "Thiện đã lưu");
  assert.deepEqual(r.data.music, { title: "Bài đã lưu", src: "https://cdn.example/a.mp3" });

  serve(offline);
  r = await (await openPage()).loadWeddingContent({ timeoutMs: 60 });
  assert.equal(r.source, "cached");
  assert.equal(groomOf(r), "Thiện đã lưu");

  // Qua đường gốc: phiên bản và nội dung cùng lấy từ bản đã lưu
  local.clear();
  serve(ok(published("Thiện v2 đã lưu", T1, { site: { version: "v2" } })));
  await (await openPage()).loadWeddingContent();
  serve(hang);
  r = await rootThenCard({ rootTimeout: 60 });
  assert.equal(r.version, "v2");
  assert.equal(r.source, "cached");
  assert.equal(groomOf(r), "Thiện v2 đã lưu");
  assert.ok(r.cardMs < 400, `trang phiên bản chờ ${r.cardMs}ms`);
});

test("(B) xuất bản bản mới, mạng tốt -> hiện bản mới và cập nhật bản lưu", async () => {
  serve(ok(published("Thiện 1", T1)));
  await rootThenCard();
  serve(ok(published("Thiện 2", T2)));
  const r = await rootThenCard();
  assert.equal(r.source, "published");
  assert.equal(groomOf(r), "Thiện 2");
  serve(hang);
  assert.equal(groomOf(await (await openPage()).loadWeddingContent({ timeoutMs: 60 })), "Thiện 2");
});

test("(B) bản cũ hơn đọc về sau không đè bản lưu mới hơn", async () => {
  serve(ok(published("Thiện mới", T2)));
  await (await openPage()).loadWeddingContent();
  // Một tab khác đọc được bản cũ hơn (T1 < T2, khác độ dài phần lẻ giây): vẽ nó, nhưng không lưu đè
  serve(ok(published("Thiện cũ", T1)));
  assert.equal(groomOf(await (await openPage()).loadWeddingContent()), "Thiện cũ");
  serve(hang);
  assert.equal(groomOf(await (await openPage()).loadWeddingContent({ timeoutMs: 60 })), "Thiện mới");
});

test("(B) đọc chậm hơn thời gian chờ: vẽ bằng nguồn khác, bản về muộn được lưu cho lần sau", async () => {
  serve(later(published("Thiện về muộn", T3), 150));
  const first = await (await openPage()).loadWeddingContent({ timeoutMs: 40 });
  assert.equal(first.source, "fallback");
  assert.equal(groomOf(first), "Thiện");
  await sleep(250);
  serve(hang);
  const next = await (await openPage()).loadWeddingContent({ timeoutMs: 40 });
  assert.equal(next.source, "cached");
  assert.equal(groomOf(next), "Thiện về muộn");
});

test("(B) đường gốc hết giờ: trang phiên bản đọc nền để lưu bản mới, không chờ nó", async () => {
  serve(ok(published("Thiện cũ", T1)));
  await (await openPage()).loadWeddingContent();
  serve(later(published("Thiện mới", T2), 150));
  const r = await rootThenCard({ rootTimeout: 40, cardTimeout: 40 });
  assert.equal(r.source, "cached");
  assert.equal(groomOf(r), "Thiện cũ");
  assert.ok(r.cardMs < 100, `trang phiên bản chờ ${r.cardMs}ms`);
  await sleep(250);
  serve(hang);
  assert.equal(groomOf(await (await openPage()).loadWeddingContent({ timeoutMs: 40 })), "Thiện mới");
});

test("(B) đọc được và Firestore trả lời dứt khoát (chưa xuất bản / bản hỏng) -> dự phòng, không dùng bản lưu", async () => {
  serve(ok(published("Thiện đã lưu", T1)));
  await (await openPage()).loadWeddingContent();
  serve(notFound);
  assert.equal((await (await openPage()).loadWeddingContent()).source, "fallback");

  local.clear();
  serve(ok(published("Thiện đã lưu", T1)));
  await (await openPage()).loadWeddingContent();
  serve(ok(published("", T2)));
  assert.equal((await (await openPage()).loadWeddingContent()).source, "fallback");
  serve(hang);
  assert.equal(groomOf(await (await openPage()).loadWeddingContent({ timeoutMs: 40 })), "Thiện đã lưu", "bản hỏng không được lưu");
});

test("(B) bản lưu qua kiểm hợp lệ + normalize như bản mới", async () => {
  // URL lạ bị bỏ ở cả bản mới lẫn bản lưu
  serve(ok(published("Thiện", T1, { music: { title: "x", src: "javascript:alert(1)" } })));
  assert.equal((await (await openPage()).loadWeddingContent()).data.music.src, "");
  serve(hang);
  const cached = await (await openPage()).loadWeddingContent({ timeoutMs: 40 });
  assert.equal(cached.source, "cached");
  assert.equal(cached.data.music.src, "");
  assert.equal(cached.data.site.version, "v1");

  // Bản lưu bị sửa hỏng (thiếu tên) hoặc không phải JSON -> bỏ, dùng dự phòng
  for (const corrupt of [(v) => v.replaceAll("Thiện", ""), () => "{không phải json"]) {
    local.clear();
    serve(ok(published("Thiện", T1)));
    await (await openPage()).loadWeddingContent();
    assert.ok(local.map.size > 0, "đã lưu");
    for (const [k, v] of local.map) local.map.set(k, corrupt(v));
    serve(hang);
    const r = await (await openPage()).loadWeddingContent({ timeoutMs: 40 });
    assert.equal(r.source, "fallback");
  }
});

test("storage bị chặn (trình duyệt cấm / đầy): vẫn chạy như trước, không ném lỗi", async () => {
  const blocked = {
    getItem() { throw new DOMException("denied", "SecurityError"); },
    setItem() { throw new DOMException("full", "QuotaExceededError"); },
    removeItem() { throw new DOMException("denied", "SecurityError"); },
  };
  window.localStorage = blocked;
  window.sessionStorage = blocked;
  try {
    serve(ok(published("Thiện", T1, { site: { version: "v2" } })));
    const r = await rootThenCard();
    assert.equal(r.version, "v2");
    assert.equal(r.source, "published");
    serve(hang);
    assert.equal((await (await openPage()).loadWeddingContent({ timeoutMs: 40 })).source, "fallback");
  } finally {
    window.localStorage = local;
    window.sessionStorage = session;
  }
});

test("xem trước của trang quản lý (__contentPreview): không đọc, không ghi bản lưu", async () => {
  serve(ok(published("Thiện đã lưu", T1)));
  await (await openPage()).loadWeddingContent();
  // Đường gốc vừa đọc trong cùng tab: bản xem trước không được lấy kết quả đó thay bản nháp
  await (await openPage()).loadCardVersion();
  const saved = [...local.map];
  window.__contentPreview = true;
  try {
    // fetch giả của bản xem trước không có updateTime
    serve(ok({ fields: published("Bản nháp").fields }));
    const r = await (await openPage()).loadWeddingContent();
    assert.equal(groomOf(r), "Bản nháp");
    assert.equal(calls, 1);
  } finally {
    delete window.__contentPreview;
  }
  assert.deepEqual([...local.map], saved);
});
