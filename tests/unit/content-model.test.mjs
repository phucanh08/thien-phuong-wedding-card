// Unit test cho docs/admin/content-model.js: luật kiểm nội dung trước khi lưu/xuất bản (C6 + ruling M1).
// Chạy: node --test tests/unit/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateContent, urlProblem, setPath, getPath, toFirestoreValue, splitISO, joinISO,
} from "../../docs/admin/content-model.js";

function sample() {
  return {
    meta: { title: "T", description: "", previewImage: "assets/a.webp", favicon: "" },
    couple: {
      groom: { shortName: "Thiện", fullName: "Nguyễn Đức Thiện", photo: "", facebook: null },
      bride: { shortName: "Phương", fullName: "", photo: "https://cdn.example/p.webp", facebook: null },
    },
    wedding: { dateISO: "2026-10-25", invitationText: [] },
    events: [{ key: "groom-drinks", title: "TIỆC", startISO: "2026-10-24T16:30:00+07:00", mapUrl: "", dressCode: ["#fff", "#32435f"] }],
    story: [],
    gallery: [],
    donate: { groom: { qr: "" }, bride: { qr: "" } },
    music: { src: "assets/musics/a.mp3", title: "" },
  };
}

const paths = (problems) => problems.map((p) => p.path);

test("dữ liệu hợp lệ không có lỗi; mảng rỗng được", () => {
  assert.deepEqual(validateContent(sample()), []);
});

test("thiếu shortName (rỗng hoặc chỉ khoảng trắng) bị chặn", () => {
  const d = sample();
  d.couple.groom.shortName = "";
  d.couple.bride.shortName = "   ";
  assert.deepEqual(paths(validateContent(d)), ["couple.groom.shortName", "couple.bride.shortName"]);
});

test("wedding.dateISO phải YYYY-MM-DD", () => {
  const d = sample();
  d.wedding.dateISO = "25/10/2026";
  assert.deepEqual(paths(validateContent(d)), ["wedding.dateISO"]);
});

test("mỗi event cần key/title/startISO", () => {
  const d = sample();
  d.events[0].title = "";
  d.events[0].startISO = "sáng mai";
  assert.deepEqual(paths(validateContent(d)), ["events.0.title", "events.0.startISO"]);
});

test("event thiếu key (rỗng hoặc không có) bị chặn", () => {
  const d = sample();
  d.events.push({ ...d.events[0] });
  d.events[0].key = "";
  delete d.events[1].key;
  assert.deepEqual(paths(validateContent(d)), ["events.0.key", "events.1.key"]);
});

test("mapUrl javascript: bị chặn", () => {
  const d = sample();
  d.events[0].mapUrl = "javascript:alert(1)";
  assert.deepEqual(paths(validateContent(d)), ["events.0.mapUrl"]);
});

test("dressCode chỉ nhận #rgb / #rrggbb", () => {
  const d = sample();
  d.events[0].dressCode = ["#fff", "red", "#12345"];
  assert.deepEqual(paths(validateContent(d)), ["events.0.dressCode.1", "events.0.dressCode.2"]);
});

test("URL: http/https/tương đối được; scheme khác, nháy, \\, <>, ký tự điều khiển bị chặn", () => {
  for (const ok of ["https://a.b/c.webp", "http://x.y", "assets/x.webp", "../x.webp", "/x.webp"]) {
    assert.equal(urlProblem(ok), null, ok);
  }
  for (const bad of ["javascript:alert(1)", "java\tscript:alert(1)", "data:image/png;base64,AA", "ftp://x/y",
    'https://a.b/"x', "https://a.b/'x", "https://a.b/`x", "https://a.b/\\x", "https://a.b/<x>", "https://a.b/\u0001"]) {
    assert.notEqual(urlProblem(bad), null, JSON.stringify(bad));
  }
});

test("URL ở mọi ô ảnh/link được kiểm, kể cả field tuỳ chọn v2", () => {
  const d = sample();
  d.couple.groom.facebook = "javascript:x";
  d.wedding.envelopeImage = "data:x";
  d.wedding.coverImages = ["assets/a.webp", "vbscript:x"];
  d.gallery = [{ small: "a.webp", large: "<b>" }];
  d.story = [{ title: "a", image: "javascript:y" }];
  d.donate.bride.qr = "javascript:z";
  d.music.src = "javascript:m";
  assert.deepEqual(paths(validateContent(d)), [
    "couple.groom.facebook", "wedding.envelopeImage", "wedding.coverImages.1",
    "story.0.image", "gallery.0.large", "donate.bride.qr", "music.src",
  ]);
});

test("ảnh album phải có ít nhất một URL", () => {
  const d = sample();
  d.gallery = [{ small: "", large: "", caption: "x" }];
  assert.deepEqual(paths(validateContent(d)), ["gallery.0.small"]);
});

test("rsvpDeadline nếu có phải YYYY-MM-DD", () => {
  const d = sample();
  d.wedding.rsvpDeadline = "2026-10-20";
  assert.deepEqual(validateContent(d), []);
  d.wedding.rsvpDeadline = "20/10";
  assert.deepEqual(paths(validateContent(d)), ["wedding.rsvpDeadline"]);
});

test("setPath/getPath giữ nguyên field lạ", () => {
  const d = sample();
  d.wedding.introText = "giữ tôi";
  d.extra = { a: 1 };
  setPath(d, "couple.groom.shortName", "Thiện 2");
  setPath(d, "events.0.title", "MỚI");
  assert.equal(getPath(d, "couple.groom.shortName"), "Thiện 2");
  assert.equal(d.events[0].title, "MỚI");
  assert.equal(d.wedding.introText, "giữ tôi");
  assert.deepEqual(d.extra, { a: 1 });
  setPath(d, "wedding.thanksText", undefined);
  assert.equal("thanksText" in d.wedding, false);
});

test("toFirestoreValue mã hoá đúng kiểu REST", () => {
  assert.deepEqual(toFirestoreValue({ a: "x", n: 3, f: 1.5, b: true, z: null, l: ["y"] }), {
    mapValue: { fields: {
      a: { stringValue: "x" }, n: { integerValue: "3" }, f: { doubleValue: 1.5 }, b: { booleanValue: true },
      z: { nullValue: null }, l: { arrayValue: { values: [{ stringValue: "y" }] } },
    } },
  });
});

test("splitISO/joinISO giữ múi giờ, mặc định +07:00", () => {
  assert.deepEqual(splitISO("2026-10-24T16:30:00+07:00"), { date: "2026-10-24", time: "16:30", rest: ":00+07:00" });
  assert.deepEqual(splitISO("2026-10-25"), { date: "2026-10-25", time: "", rest: "" });
  assert.equal(joinISO("2026-10-24", "17:05", ":00+07:00"), "2026-10-24T17:05:00+07:00");
  assert.equal(joinISO("2026-10-25", "09:00", ""), "2026-10-25T09:00:00+07:00");
  assert.equal(joinISO("2026-10-25", "", ":00+07:00"), "2026-10-25");
  assert.equal(joinISO("", "09:00", ""), "");
});
