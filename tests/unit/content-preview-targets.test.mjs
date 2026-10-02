// Unit test cho bảng ô -> mục con của khung xem trước (docs/admin/content-preview.js, previewTargets): bấm ô
// hay "Xem phần này" thì khung tới đúng mục con chứa ô đó (Lead 2026-10-03, PF): Màu trang phục -> Dresscode,
// ô của sự kiện -> sự kiện đó (tên/giờ/địa điểm còn hiện ở Timeline), 3 ảnh "With you" -> With you,
// Lời cảm ơn -> Cảm ơn, Câu dẫn/Lời ngỏ/ảnh lời ngỏ -> mục đếm ngược/lời ngỏ, mốc chuyện tình -> đúng mốc,
// mừng cưới -> đúng thẻ của bên đó. Ô không hiện trong thân thiệp -> null (khung đứng yên).
// Expected viết tay theo markup thiệp (docs/index.html) và cách card.js vẽ, không tính bằng code đang test.
// Hành vi cuộn trong khung thật được đo bằng trình duyệt (xem commit).
// Chạy: node --test tests/unit/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { previewTargets, PREVIEW_ANCHORS } from "../../docs/admin/content-preview.js";

const html = readFileSync(new URL("../../docs/index.html", import.meta.url), "utf8");
const card = readFileSync(new URL("../../docs/v2/card.js", import.meta.url), "utf8");

const DATA = {
  events: [{ key: "groom-drinks" }, { key: "groom-ceremony" }, { key: "bride-drinks" }],
  donate: { groom: { bank: "A" }, bride: { bank: "B" } },
};
const first = (section, path, data = DATA) => previewTargets(section, path, data)?.[0];

test("ô -> mục con đúng như bảng", () => {
  const cases = [
    ["couple", "couple.groom.shortName", ".v2-couple__names"],
    ["couple", "couple.bride.shortName", ".v2-couple__names"],
    ["couple", "couple.bride.father", ".v2-family__list"],
    ["couple", "couple.groom.address", ".v2-family__list"],
    ["wedding", "wedding.dateISO", ".v2-countdown"],
    ["wedding", "wedding.mainImage", ".v2-couple__banner"],
    ["wedding", "wedding.invitationImage", ".v2-lovestory__portrait"],
    ["wedding", "wedding.coverImages.0", ".v2-cover"],
    ["wedding", "wedding.coverImages.2", ".v2-cover"],
    ["wedding", "wedding.introText", ".v2-lovestory__intro"],
    ["wedding", "wedding.invitationText", ".v2-lovestory__intro"],
    ["wedding", "wedding.thanksText", ".v2-thanks"],
    ["events", "events.0.dressCode", "#v2-dresscode-wrap"],
    ["events", "events.2.dressCode.3", "#v2-dresscode-wrap"],
    ["events", "events.0.note", '.v2-event__item[data-event-key="groom-drinks"]'],
    ["events", "events.2.lunarText", '.v2-event__item[data-event-key="bride-drinks"]'],
    ["events", "events.1.title", '.v2-event__item[data-event-key="groom-ceremony"]'],
    ["events", "events.1.address", '.v2-event:has(.v2-event__item[data-event-key="groom-ceremony"])'],
    ["story", "story.0.title", "#v2-story > .v2-story__item:nth-child(1)"],
    ["story", "story.1.text", "#v2-story > .v2-story__item:nth-child(2)"],
    ["story", "story.1.image", "#v2-story > .v2-story__item:nth-child(2)"],
    ["gallery", "gallery.3.caption", ".v2-album"],
    ["donate", "donate.groom.bank", "#v2-gift > .v2-gift__card:nth-child(1)"],
    ["donate", "donate.bride.accountNumber", "#v2-gift > .v2-gift__card:nth-child(2)"],
  ];
  for (const [section, path, expected] of cases) assert.equal(first(section, path), expected, path);
});

test("tên/giờ/địa điểm sự kiện còn hiện ở Timeline: Timeline là chỗ thứ hai (đang xem Timeline thì ở lại)", () => {
  for (const field of ["title", "startISO", "endISO", "venue"]) {
    assert.ok(previewTargets("events", `events.0.${field}`, DATA).includes(".v2-timeline__list"), field);
  }
  for (const field of ["note", "lunarText", "address", "mapUrl", "dressCode"]) {
    assert.ok(!previewTargets("events", `events.0.${field}`, DATA).includes(".v2-timeline__list"), field);
  }
});

test("chỉ có thẻ mừng cưới cô dâu (không có chú rể): thẻ cô dâu là thẻ đầu", () => {
  assert.equal(first("donate", "donate.bride.bank", { donate: { bride: { bank: "B" } } }), "#v2-gift > .v2-gift__card:nth-child(1)");
});

test("ô không hiện trong thân thiệp: null (khung đứng yên)", () => {
  for (const [section, path] of [["meta", "meta.title"], ["meta", "meta.favicon"], ["music", "music.src"], ["wedding", "wedding.rsvpDeadline"]]) {
    assert.equal(previewTargets(section, path, DATA), null, path);
  }
});

test("không có ô (mở mục, \"Xem phần này\" khi chưa bấm ô): neo của mục; tab/nhạc: đầu thiệp", () => {
  assert.deepEqual(previewTargets("events", null, DATA), [".v2-events"]);
  assert.deepEqual(previewTargets("story", undefined, DATA), ["#v2-story-section"]);
  assert.deepEqual(previewTargets("meta", null, DATA), []);
  assert.deepEqual(previewTargets("music", null, DATA), []);
});

test("mọi bộ chọn trỏ tới phần tử có trong markup thiệp hoặc do card.js vẽ", () => {
  const paths = [
    "couple.groom.shortName", "couple.groom.father", "wedding.dateISO", "wedding.mainImage", "wedding.invitationImage",
    "wedding.coverImages.1", "wedding.introText", "wedding.thanksText", "events.0.dressCode.0", "events.0.title",
    "events.0.venue", "events.0.note", "story.0.text", "gallery.0.caption", "donate.groom.bank",
  ];
  const selectors = new Set(Object.values(PREVIEW_ANCHORS).filter(Boolean));
  for (const path of paths) previewTargets(path.split(".")[0], path, DATA).forEach((s) => selectors.add(s));
  for (const selector of selectors) {
    for (const [, kind, name] of selector.matchAll(/([.#])([a-z0-9_-]+)/gi)) {
      const inHtml = kind === "#" ? html.includes(`id="${name}"`) : new RegExp(`class="[^"]*\\b${name}\\b`).test(html);
      const drawn = kind === "." && new RegExp(`el\\('[a-z0-9]+', '${name}'`).test(card);
      assert.ok(inHtml || drawn, `${selector}: không có ${kind}${name}`);
    }
  }
  assert.match(card, /item\.dataset\.eventKey = event\.key/, "card.js gắn data-event-key cho từng lễ");
});
