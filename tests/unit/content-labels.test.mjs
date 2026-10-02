// Unit test cho docs/admin/content-labels.js: nhãn "hiện ở đâu" của từng ô trong trình sửa nội dung (F1a).
// Bảng expected là bảng đích Lead chốt (V1 / V2 / "V1 · V2" / công dụng), không tính từ code.
// Chạy: node --test tests/unit/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { whereOf } from "../../docs/admin/content-labels.js";

const BOTH = "V1 · V2";
const SHARE = "tiêu đề tab / xem trước khi chia sẻ link";

// Mọi data-path mà content-editor.js tạo ra (đã thay chỉ số mảng và groom/bride bằng ví dụ thật).
const EXPECTED = {
  "site.version": "chọn trang mở từ link gốc",
  "meta.title": SHARE,
  "meta.description": SHARE,
  "meta.previewImage": SHARE,
  "meta.favicon": SHARE,
  "couple.groom.shortName": BOTH,
  "couple.bride.shortName": BOTH,
  "couple.groom.fullName": SHARE,
  "couple.bride.fullName": SHARE,
  "couple.groom.photo": "V1",
  "couple.bride.photo": "V1",
  "couple.groom.father": BOTH,
  "couple.bride.mother": BOTH,
  "couple.groom.address": BOTH,
  "couple.bride.address": BOTH,
  "couple.groom.bio": "V1",
  "couple.bride.bio": "V1",
  "couple.groom.facebook": "V1",
  "couple.bride.facebook": "V1",
  "wedding.dateISO": BOTH,
  "wedding.lunarText": "V1",
  "wedding.rsvpDeadline": "V2",
  "wedding.mainImage": BOTH,
  "wedding.invitationImage": BOTH,
  "wedding.envelopeImage": "V2",
  "wedding.coverImages.0": "V2",
  "wedding.coverImages.1": "V2",
  "wedding.coverImages.2": "V2",
  "wedding.invitationText": BOTH,
  "wedding.introText": "V2",
  "wedding.thanksText": "V2",
  "events.0.title": BOTH,
  "events.3.side": BOTH,
  "events.0.startISO": BOTH,
  "events.2.endISO": BOTH,
  "events.0.lunarText": BOTH,
  "events.0.venue": BOTH,
  "events.0.address": BOTH,
  "events.0.mapUrl": BOTH,
  "events.0.note": BOTH,
  "events.1.image": "V1",
  "events.0.dressCode": BOTH,
  "events.0.dressCode.1": BOTH,
  "story.0.date": BOTH,
  "story.4.title": BOTH,
  "story.0.text": BOTH,
  "story.0.image": BOTH,
  "gallery.0.featured": "V1",
  "gallery.3.featuredV2": "V2",
  "gallery.0.caption": BOTH,
  "gallery.12.small": BOTH,
  "gallery.12.large": BOTH,
  "donate.groom.bank": BOTH,
  "donate.bride.accountName": BOTH,
  "donate.groom.accountNumber": BOTH,
  "donate.bride.branch": BOTH,
  "donate.groom.qr": BOTH,
  "music.title": BOTH,
  "music.src": BOTH,
};

test("mỗi ô của trình sửa có nhãn khớp bảng đích", () => {
  const got = Object.fromEntries(Object.keys(EXPECTED).map((path) => [path, whereOf(path).tag]));
  assert.deepEqual(got, EXPECTED);
});

test("ghi chú đi kèm: lời ngỏ (v2 dùng khi Câu dẫn trống) và giờ kết thúc (HH:mm – HH:mm, Thêm vào lịch)", () => {
  assert.match(whereOf("wedding.invitationText").note, /v2 dùng lời ngỏ khi “Câu dẫn” để trống/);
  const end = whereOf("events.0.endISO").note;
  assert.match(end, /HH:mm – HH:mm/);
  assert.match(end, /Thêm vào lịch/);
  assert.equal(whereOf("wedding.introText").note, undefined);
});

// Ruling Lead (G2, N2 của G1R): ô "Lưới v1" giữ nhãn V1 nhưng ghi chú rằng v2 cũng dùng lưới này khi
// chưa chọn ảnh "Lưới v2". Ô "Lưới v2" chỉ có nhãn V2.
test("ghi chú Lưới v1: v2 dùng lưới v1 khi chưa chọn ảnh Lưới v2", () => {
  const v1 = whereOf("gallery.5.featured");
  assert.equal(v1.tag, "V1");
  assert.match(v1.note, /v2/);
  assert.match(v1.note, /Lưới v2/);
  assert.match(v1.note, /chưa chọn/);
  assert.deepEqual(whereOf("gallery.5.featuredV2"), { tag: "V2" });
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
  assert.ok(found.size > 40, `quét được ${found.size} path`);
  const suffixes = new Set([...known].map((k) => k.split(".").slice(-1)[0]));
  const missing = [...found].filter((f) => !known.has(f) && !suffixes.has(f));
  assert.deepEqual(missing, []);
});
