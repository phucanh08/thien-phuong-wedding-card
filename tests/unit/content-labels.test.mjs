// Unit test cho docs/admin/content-labels.js: nhãn "hiện ở đâu" của từng ô trong trình sửa nội dung (F1a).
// Bảng expected là bảng đích Lead chốt, không tính từ code. X1 (ruling Human 2026-10-02: chỉ dùng thiệp
// v2): bỏ nhãn V1 / V2 / "V1 · V2"; ô hiện trên thiệp không có nhãn (NONE), chỉ giữ nhãn công dụng.
// Chạy: node --test tests/unit/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { whereOf } from "../../docs/admin/content-labels.js";

const NONE = undefined;
const SHARE = "tiêu đề tab / xem trước khi chia sẻ link";

// Mọi data-path mà content-editor.js tạo ra (đã thay chỉ số mảng và groom/bride bằng ví dụ thật).
const EXPECTED = {
  "meta.title": SHARE,
  "meta.description": SHARE,
  "meta.previewImage": SHARE,
  "meta.favicon": SHARE,
  "couple.groom.shortName": NONE,
  "couple.bride.shortName": NONE,
  "couple.groom.fullName": SHARE,
  "couple.bride.fullName": SHARE,
  "couple.groom.father": NONE,
  "couple.bride.mother": NONE,
  "couple.groom.address": NONE,
  "couple.bride.address": NONE,
  "wedding.dateISO": NONE,
  "wedding.rsvpDeadline": NONE,
  "wedding.mainImage": NONE,
  "wedding.invitationImage": NONE,
  "wedding.envelopeImage": NONE,
  "wedding.coverImages.0": NONE,
  "wedding.coverImages.1": NONE,
  "wedding.coverImages.2": NONE,
  "wedding.invitationText": NONE,
  "wedding.introText": NONE,
  "wedding.thanksText": NONE,
  "events.0.title": NONE,
  "events.3.side": NONE,
  "events.0.startISO": NONE,
  "events.2.endISO": NONE,
  "events.0.lunarText": NONE,
  "events.0.venue": NONE,
  "events.0.address": NONE,
  "events.0.mapUrl": NONE,
  "events.0.note": NONE,
  "events.0.dressCode": NONE,
  "events.0.dressCode.1": NONE,
  "story.0.date": NONE,
  "story.4.title": NONE,
  "story.0.text": NONE,
  "story.0.image": NONE,
  "gallery.0.caption": NONE,
  "gallery.12.small": NONE,
  "gallery.12.large": NONE,
  "donate.groom.bank": NONE,
  "donate.bride.accountName": NONE,
  "donate.groom.accountNumber": NONE,
  "donate.bride.branch": NONE,
  "donate.groom.qr": NONE,
  "music.title": NONE,
  "music.src": NONE,
};

test("mỗi ô của trình sửa có nhãn khớp bảng đích", () => {
  const got = Object.fromEntries(Object.keys(EXPECTED).map((path) => [path, whereOf(path).tag]));
  assert.deepEqual(got, EXPECTED);
});

test("ghi chú đi kèm: lời ngỏ (hiện thay câu dẫn khi Câu dẫn trống) và giờ kết thúc (HH:mm – HH:mm, Thêm vào lịch)", () => {
  assert.match(whereOf("wedding.invitationText").note, /câu dẫn khi “Câu dẫn” để trống/);
  const end = whereOf("events.0.endISO").note;
  assert.match(end, /HH:mm – HH:mm/);
  assert.match(end, /Thêm vào lịch/);
  assert.equal(whereOf("wedding.introText").note, undefined);
});

// X1: nhãn và ghi chú không còn nhắc phiên bản thiệp.
test("không nhãn/ghi chú nào nhắc v1/v2", () => {
  for (const path of Object.keys(EXPECTED)) {
    const { tag = "", note = "" } = whereOf(path);
    assert.doesNotMatch(`${tag} ${note}`, /v[12]/i, path);
  }
});

test("không có ô birthday trong trình sửa (giá trị cũ được giữ vì field lạ không bị đụng)", () => {
  const source = readFileSync(new URL("../../docs/admin/content-editor.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /birthday/);
});

// Thêm ô mới vào trình sửa mà chưa quyết nhãn thì test này đỏ.
test("mọi path mà content-editor.js khai đều có trong bảng expected", () => {
  const source = readFileSync(new URL("../../docs/admin/content-editor.js", import.meta.url), "utf8");
  const known = new Set(Object.keys(EXPECTED).map((path) => path.replace(/^(couple|donate)\.(groom|bride)\./, "$1.*.").replace(/\.\d+(?=\.|$)/g, ".*")));
  const found = new Set();
  for (const m of source.matchAll(/path:\s*`\$\{p\}\.(\w+)`/g)) found.add(m[1]);
  for (const m of source.matchAll(/path:\s*"([\w.]+)"/g)) found.add(m[1]);
  assert.ok(found.size > 30, `quét được ${found.size} path`); // X1 bỏ 7 ô chỉ v1 dùng: còn 39
  const suffixes = new Set([...known].map((k) => k.split(".").slice(-1)[0]));
  const missing = [...found].filter((f) => !known.has(f) && !suffixes.has(f));
  assert.deepEqual(missing, []);
});
