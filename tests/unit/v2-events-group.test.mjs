// Unit test cho cách gom lễ theo địa điểm ở mục Sự kiện của thiệp v2 (EG, Human duyệt 2026-10-02):
//   - cùng venue + address (so sau khi trim) là một nhóm; địa chỉ chỉ hiện một lần mỗi nơi;
//   - lễ trong nhóm theo giờ như Timeline, lễ chưa có giờ cuối ngày; nhóm theo lễ sớm nhất của nó;
//   - "Chỉ đường" của nhóm là mapUrl hợp lệ (http/https/tương đối) đầu tiên trong nhóm.
// Expected viết tay theo luật trên, không tính bằng hàm đang test.
// card.js là script thường chạy lúc tải trang: chạy cả file trong vm với DOM giả (mọi thuộc tính/lời gọi
// trả về chính nó), rồi gọi window.v2Events.groupByPlace.
// Chạy: node --test tests/unit/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../docs/v2/card.js", import.meta.url), "utf8");

// Rìa trình duyệt: đối tượng giả nhận mọi thuộc tính / lời gọi, không làm gì
const stub = new Proxy(function () {}, {
  get: (_, key) => (key === Symbol.toPrimitive ? () => "" : key === Symbol.iterator ? [][Symbol.iterator].bind([]) : stub),
  apply: () => stub,
  construct: () => stub,
});
const store = {};
const window = new Proxy(store, { get: (target, key) => (key in target ? target[key] : stub) });
const document = new Proxy({ baseURI: "https://thiep.example/site/" }, { get: (target, key) => (key in target ? target[key] : stub) });
vm.runInNewContext(source, {
  window, document, URL, console,
  history: {},
  HTMLScriptElement: { prototype: { noModule: true } },
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0,
});

// Nhóm -> { venue, address, mapUrl, keys }. Mảng tạo trong context vm khác prototype với mảng của test:
// đưa về JSON thường trước khi so.
function groups(events) {
  return JSON.parse(JSON.stringify(window.v2Events.groupByPlace(events).map((g) => ({
    venue: g.venue, address: g.address, mapUrl: g.mapUrl, keys: g.items.map((x) => x.event.key),
  }))));
}

const TRAI = { venue: "Tư gia nhà trai", address: "Số 63, đường Đền Trình Tuyết Sơn, Mỹ Đức, Hà Nội", mapUrl: "https://maps.app.goo.gl/trai" };
const GAI = { venue: "Tư gia nhà gái", address: "Ngách 08/40 Lý Dương Cảnh - Lâm Thao - Phú Thọ", mapUrl: "https://maps.app.goo.gl/gai" };

test("4 lễ, 2 địa điểm (data thật): 2 nhóm, nhóm có lễ sớm nhất trước, trong nhóm theo giờ", () => {
  const events = [
    { key: "groom-drinks", startISO: "2026-10-24T16:30:00+07:00", ...TRAI },
    { key: "groom-ceremony", startISO: "2026-10-25T10:00:00+07:00", ...TRAI },
    { key: "bride-drinks", startISO: "2026-10-24T16:00:00+07:00", endISO: "2026-10-24T17:00:00+07:00", ...GAI },
    { key: "bride-ceremony", startISO: "2026-10-25T06:30:00+07:00", ...GAI },
  ];
  assert.deepEqual(groups(events), [
    { ...GAI, keys: ["bride-drinks", "bride-ceremony"] },
    { ...TRAI, keys: ["groom-drinks", "groom-ceremony"] },
  ]);
});

test("cùng venue nhưng address khác: 2 nhóm", () => {
  const events = [
    { key: "a", startISO: "2026-10-24T09:00", venue: "Nhà văn hoá", address: "Thôn 1", mapUrl: "https://m/1" },
    { key: "b", startISO: "2026-10-24T10:00", venue: "Nhà văn hoá", address: "Thôn 2", mapUrl: "https://m/2" },
  ];
  assert.deepEqual(groups(events), [
    { venue: "Nhà văn hoá", address: "Thôn 1", mapUrl: "https://m/1", keys: ["a"] },
    { venue: "Nhà văn hoá", address: "Thôn 2", mapUrl: "https://m/2", keys: ["b"] },
  ]);
});

test("lễ chưa có giờ xếp cuối ngày đó, cả trong nhóm lẫn khi so nhóm", () => {
  const events = [
    { key: "no-time", startISO: "2026-10-25", ...GAI },
    { key: "morning", startISO: "2026-10-25T06:30", ...GAI },
    { key: "other-place-no-time", startISO: "2026-10-24", ...TRAI },
    { key: "other-place-late", startISO: "2026-10-26T08:00", ...TRAI },
  ];
  // TRAI có lễ 24/10 (chưa có giờ, nhưng vẫn sớm hơn ngày 25) -> đứng trước GAI
  assert.deepEqual(groups(events).map((g) => g.keys), [
    ["other-place-no-time", "other-place-late"],
    ["morning", "no-time"],
  ]);
  // Cùng một ngày: nhóm chỉ có lễ chưa giờ đứng sau nhóm có giờ
  const sameDay = [
    { key: "pending", startISO: "2026-10-25", ...TRAI },
    { key: "timed", startISO: "2026-10-25T23:00", ...GAI },
  ];
  assert.deepEqual(groups(sameDay).map((g) => g.keys), [["timed"], ["pending"]]);
});

test("một nhóm một lễ: lễ không trùng địa điểm với ai", () => {
  const events = [
    { key: "home-1", startISO: "2026-10-24T08:00", ...TRAI },
    { key: "restaurant", startISO: "2026-10-24T11:00", venue: "Nhà hàng Hoa Sen", address: "12 Lê Lợi", mapUrl: "https://m/hs" },
    { key: "home-2", startISO: "2026-10-24T17:00", ...TRAI },
  ];
  assert.deepEqual(groups(events), [
    { ...TRAI, keys: ["home-1", "home-2"] },
    { venue: "Nhà hàng Hoa Sen", address: "12 Lê Lợi", mapUrl: "https://m/hs", keys: ["restaurant"] },
  ]);
});

test("venue/address so sau khi trim; mapUrl là link hợp lệ đầu tiên của nhóm", () => {
  const events = [
    { key: "a", startISO: "2026-10-24T08:00", venue: " Tư gia nhà gái ", address: "Phú Thọ  ", mapUrl: "javascript:alert(1)" },
    { key: "b", startISO: "2026-10-24T09:00", venue: "Tư gia nhà gái", address: " Phú Thọ", mapUrl: "https://m/gai" },
    { key: "c", startISO: "2026-10-24T10:00", venue: "Tư gia nhà gái", address: "Phú Thọ", mapUrl: "https://m/khac" },
  ];
  assert.deepEqual(groups(events), [
    { venue: "Tư gia nhà gái", address: "Phú Thọ", mapUrl: "https://m/gai", keys: ["a", "b", "c"] },
  ]);
  const noMap = [{ key: "x", startISO: "2026-10-24T08:00", venue: "A", address: "B", mapUrl: "javascript:void(0)" }];
  assert.equal(groups(noMap)[0].mapUrl, "");
});
