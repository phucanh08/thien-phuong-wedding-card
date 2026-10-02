// computeStats (docs/admin/stats.js): hàm thuần, chạy bằng `node --test tests/unit/`, không cần emulator.
// Giá trị expected tính tay theo C5 trong CLAUDE.md và ruling A3 / R1, không tính lại bằng chính thuật toán.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as statsModule from "../../docs/admin/stats.js";

const { computeStats } = statsModule;

const EVENTS = [
  { key: "ceremony", title: "LỄ THÀNH HÔN", startISO: "2026-11-01T09:00:00+07:00" },
  { key: "party", title: "TIỆC CƯỚI", startISO: "2026-11-01T18:00:00+07:00" },
  { key: "return", title: "LỄ VU QUY", startISO: "2026-11-02T09:00:00+07:00" },
];

const guest = (code, invitedEvents, expectedCount = 1) => ({ code, name: `Khách ${code}`, invitedEvents, expectedCount });
const rsvp = (id, fields) => ({ id, code: null, name: "", attending: "yes", count: 1, events: [], updatedAt: null, ...fields });
const stats = (guests, rsvps) => computeStats({ guests, rsvps, events: EVENTS });
const event = (result, key) => result.events.find((e) => e.key === key);

test("mâm = làm tròn lên (tổng count RSVP yes có lễ đó) / 10, mỗi lễ một con số", () => {
  const rsvps = [
    rsvp("r1", { name: "A", count: 6, events: ["ceremony", "party"] }),
    rsvp("r2", { name: "B", count: 5, events: ["ceremony"] }),
    rsvp("r3", { name: "C", count: 4, events: ["party"] }),
  ];
  const r = stats([], rsvps);
  assert.equal(event(r, "ceremony").yesPeople, 11); // 6 + 5
  assert.equal(event(r, "ceremony").tables, 2);     // ceil(11 / 10)
  assert.equal(event(r, "party").yesPeople, 10);    // 6 + 4
  assert.equal(event(r, "party").tables, 1);        // đúng 10 người: một mâm
  assert.equal(event(r, "return").tables, 0);
  // Ngày 01/11 cộng hai lễ: 2 + 1, không làm tròn lại từ 21 người.
  assert.equal(r.days.find((d) => d.date === "2026-11-01").tables, 3);
});

test("'maybe' và 'no' không vào mâm", () => {
  const r = stats([], [
    rsvp("r1", { name: "A", attending: "maybe", count: 9, events: ["ceremony"] }),
    rsvp("r2", { name: "B", attending: "no", count: 9, events: ["ceremony"] }),
    rsvp("r3", { name: "C", count: 1, events: ["ceremony"] }),
  ]);
  assert.equal(event(r, "ceremony").yesPeople, 1);
  assert.equal(event(r, "ceremony").tables, 1);
  assert.equal(event(r, "ceremony").maybeResponses, 1);
});

test("khách có mã: lễ được tính = events ∩ invitedEvents", () => {
  const r = stats(
    [guest("g1", ["ceremony"], 3)],
    [rsvp("g1", { code: "g1", count: 3, events: ["ceremony", "party"] })],
  );
  assert.equal(event(r, "ceremony").yesPeople, 3);
  assert.equal(event(r, "party").yesPeople, 0);
  assert.deepEqual(r.entries[0].outsideEvents, ["party"]);
});

test("NB1: khách có mã mà invitedEvents không có lễ hợp lệ nào vẫn được đếm, không rơi mất", () => {
  for (const invitedEvents of [[], ["khong-co-le-nay"], undefined]) {
    const r = stats([guest("g1", invitedEvents, 4), guest("g2", ["ceremony"], 2)], []);
    assert.equal(r.unassigned.guests, 1, JSON.stringify(invitedEvents));
    assert.equal(r.unassigned.people, 4);
    assert.equal(r.unassigned.pendingGuests, 1);
    assert.equal(r.unassigned.pendingPeople, 4);
    assert.deepEqual(r.unassigned.guestCodes, ["g1"]);
    assert.equal(r.totals.guests, 2);
    // Khách g2 (có lễ) không bị lẫn vào nhóm này.
    assert.equal(event(r, "ceremony").invitedGuests, 1);
  }
});

test("NB1: khách không thuộc lễ nào đã trả lời 'yes' → người đi vào mâm theo lễ khách chọn (C5), và nhóm riêng ghi đã trả lời", () => {
  const r = stats(
    [guest("g1", [], 4)],
    [rsvp("g1", { code: "g1", count: 12, events: ["party"] })],
  );
  assert.equal(event(r, "party").yesPeople, 12);
  assert.equal(event(r, "party").tables, 2); // ceil(12 / 10)
  assert.equal(r.unassigned.guests, 1);
  assert.equal(r.unassigned.answered, 1);
  assert.equal(r.unassigned.pendingGuests, 0);
  assert.equal(r.unassigned.yesPeople, 12);
});

test("NB2: tên chỉ có khoảng trắng hoặc ký tự vô hình không tạo nhóm 'tên rỗng'", () => {
  const blanks = ["", "   ", "​", " ㅤ ", " ​\t"];
  const rsvps = blanks.map((name, i) => rsvp(`b${i}`, { name, count: 1, events: ["ceremony"], updatedAt: 100 + i }));
  const r = stats([], rsvps);
  assert.deepEqual(r.entries.map((e) => e.duplicateOf), [null, null, null, null, null]);
  assert.equal(r.totals.duplicates, 0);
  assert.equal(event(r, "ceremony").yesPeople, 5);
});

test("(a) link chung: khác hoa/thường, khoảng trắng, ký tự vô hình thì gộp; chỉ tính bản mới nhất", () => {
  const r = stats([], [
    rsvp("old", { name: "Nguyễn  Văn A", count: 2, events: ["ceremony"], updatedAt: 1000 }),
    rsvp("mid", { name: "  NGUYỄN VĂN a ", count: 3, events: ["ceremony"], updatedAt: 2000 }),
    rsvp("new", { name: "nguyễn​ văn a", count: 4, events: ["ceremony"], updatedAt: 3000 }),
  ]);
  const byId = Object.fromEntries(r.entries.map((e) => [e.id, e.duplicateOf]));
  assert.deepEqual(byId, { old: "new", mid: "new", new: null });
  assert.equal(event(r, "ceremony").yesPeople, 4);
  assert.equal(r.totals.duplicates, 2);
});

test("(a) link chung: giữ dấu tiếng Việt, 'Ân' ≠ 'An' nên không gộp", () => {
  const r = stats([], [
    rsvp("an", { name: "An", count: 2, events: ["ceremony"], updatedAt: 1 }),
    rsvp("an-dau", { name: "Ân", count: 3, events: ["ceremony"], updatedAt: 2 }),
    rsvp("nguyen", { name: "Nguyen Van A", count: 1, events: ["ceremony"], updatedAt: 3 }),
    rsvp("nguyen-dau", { name: "Nguyễn Văn A", count: 1, events: ["ceremony"], updatedAt: 4 }),
  ]);
  assert.deepEqual(r.entries.map((e) => e.duplicateOf), [null, null, null, null]);
  assert.equal(event(r, "ceremony").yesPeople, 7); // 2 + 3 + 1 + 1
});

test("(a) link chung: dấu dựng sẵn (NFC) và dấu tổ hợp (NFD) là cùng một tên", () => {
  const r = stats([], [
    rsvp("nfc", { name: "Ân", events: ["ceremony"], updatedAt: 1 }),
    rsvp("nfd", { name: "Ân", events: ["ceremony"], updatedAt: 2 }),
  ]);
  assert.equal(r.entries.find((e) => e.id === "nfc").duplicateOf, "nfd");
});

test("khách có mã không bị gộp theo tên; khách đã xoá vẫn tính người đi", () => {
  const r = stats(
    [guest("g1", ["ceremony"], 1)],
    [
      rsvp("g1", { code: "g1", name: "Trùng Tên", count: 1, events: ["ceremony"], updatedAt: 1 }),
      rsvp("zz", { code: "zz", name: "Trùng Tên", count: 2, events: ["ceremony"], updatedAt: 2 }),
      rsvp("p1", { name: "Trùng Tên", count: 4, events: ["ceremony"], updatedAt: 3 }),
    ],
  );
  assert.deepEqual(r.entries.map((e) => e.duplicateOf), [null, null, null]);
  assert.equal(event(r, "ceremony").yesPeople, 7);
  assert.equal(event(r, "ceremony").invitedGuests, 1); // khách đã xoá không tính vào khách mời
});

test("nameKey: bỏ vô hình, gộp khoảng trắng, viết thường, giữ dấu", () => {
  const { nameKey } = statsModule;
  assert.equal(nameKey("  Ân​  Lê "), "ân lê");
  assert.equal(nameKey(null), "");
  assert.notEqual(nameKey("Ân"), nameKey("An"));
});
