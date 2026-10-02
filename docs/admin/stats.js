// Tổng hợp xác nhận tham dự (rsvp) với danh sách khách (guests) thành số liệu từng lễ / từng ngày.
// Hàm thuần, không chạm Firestore hay DOM: responses.js đưa dữ liệu vào, hiển thị kết quả.
//
// Quy tắc (ruling A3 của Lead, trên nền C5 trong CLAUDE.md):
// - Mâm = làm tròn lên (tổng `count` của RSVP `attending == "yes"` có lễ đó) / 10, mỗi lễ một con số;
//   mâm dự kiến = làm tròn lên (người đã xác nhận đi + `expectedCount` của khách mời lễ đó chưa trả lời) / 10.
//   Số theo ngày là cộng các lễ cùng ngày.
// - Khách có mã: lễ được tính = rsvp.events ∩ guests.invitedEvents (khi invitedEvents có lễ hợp lệ).
// - Khách link chung (code null) trùng tên: chỉ tính doc mới nhất. Tên so bằng nameKey: giữ nguyên dấu tiếng Việt
//   ("Ân" ≠ "An"), chỉ bỏ khác biệt hoa/thường, khoảng trắng thừa và ký tự vô hình (ruling R1 của Human).
//   Tên rỗng sau khi làm sạch không gộp với ai.
// - Khách có mã nhưng invitedEvents không có lễ hợp lệ nào: không thuộc lễ nào, được đếm riêng ở `unassigned`.
// - rsvp của khách đã xoá: không tính vào số khách mời, vẫn tính người đi nếu "yes".
// - "maybe" không vào mâm, tính vào "chưa chắc".

export const TABLE_SIZE = 10;

// Ký tự vô hình: định dạng (zero-width…), điều khiển, ô trống Hangul. Khớp cleanName trong guest-import.js.
const INVISIBLE = /[\p{Cf}\p{Cc}\u115F\u1160\u3164\uFFA0]/gu;

// Khoá so tên link chung: NFC, bỏ ký tự vô hình, gộp khoảng trắng, viết thường. KHÔNG bỏ dấu.
export function nameKey(name) {
  return String(name ?? "")
    .replace(/\s+/g, " ")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFC")
    .toLocaleLowerCase("vi");
}

const tables = (people) => Math.ceil(people / TABLE_SIZE);

function validKeys(list, eventKeys) {
  return Array.isArray(list) ? [...new Set(list.filter((k) => eventKeys.has(k)))] : [];
}

function headcount(value) {
  return Number.isInteger(value) && value > 0 ? value : 0;
}

// rsvps: [{ id, code, name, attending, count, events, note, updatedAt (ms, null nếu chưa có) }]
// guests: [{ code, name, side, invitedEvents, expectedCount, ... }]
// events: [{ key, title, startISO }] theo wedding-data.js
// Trả về { entries, events, days, totals, unassigned }.
export function computeStats({ guests, rsvps, events }) {
  const eventList = events.filter((e) => e && e.key);
  const eventKeys = new Set(eventList.map((e) => e.key));
  const guestByCode = new Map(guests.map((g) => [g.code, g]));

  // ---- Từng xác nhận: phân loại nguồn, lễ được tính, trùng tên ----
  const entries = rsvps.map((r) => {
    const code = typeof r.code === "string" && r.code ? r.code : null;
    const guest = code ? guestByCode.get(code) || null : null;
    const source = !code ? "public" : guest ? "guest" : "deleted";
    const chosen = validKeys(r.events, eventKeys);
    const invited = guest ? validKeys(guest.invitedEvents, eventKeys) : [];
    // Khách có mã mà invitedEvents không khớp lễ nào (dữ liệu sai) → thiệp hiện mọi lễ, nên giữ lựa chọn của khách.
    const counted = source === "guest" && invited.length ? chosen.filter((k) => invited.includes(k)) : chosen;
    return {
      ...r,
      code,
      guest,
      source,
      attending: ["yes", "no", "maybe"].includes(r.attending) ? r.attending : null,
      people: r.attending === "yes" ? headcount(r.count) : 0,
      countedEvents: counted,
      outsideEvents: chosen.filter((k) => !counted.includes(k)),
      duplicateOf: null,
    };
  });

  // Link chung trùng tên: doc mới nhất thắng (chưa có updatedAt coi là cũ nhất; bằng nhau so id cho ổn định).
  const latestByName = new Map();
  for (const e of entries) {
    if (e.source !== "public") continue;
    const key = nameKey(e.name);
    if (!key) continue;
    const best = latestByName.get(key);
    if (!best || newer(e, best)) latestByName.set(key, e);
  }
  for (const e of entries) {
    if (e.source !== "public") continue;
    const best = latestByName.get(nameKey(e.name));
    if (best && best !== e) e.duplicateOf = best.id;
  }

  const active = entries.filter((e) => !e.duplicateOf);
  const rsvpByCode = new Map(active.filter((e) => e.source === "guest").map((e) => [e.code, e]));

  // ---- Từng lễ ----
  const perEvent = eventList.map((event) => {
    const s = blankFigures();
    s.key = event.key;
    s.title = event.title || event.key;
    s.date = String(event.startISO || "").slice(0, 10);

    // Khách mời lễ này (chỉ khách còn trong danh sách).
    for (const guest of guests) {
      if (!validKeys(guest.invitedEvents, eventKeys).includes(event.key)) continue;
      const expected = headcount(guest.expectedCount);
      s.invitedGuests++;
      s.invitedPeople += expected;
      const r = rsvpByCode.get(guest.code);
      if (!r || !r.attending) {
        s.pendingGuests++;
        s.pendingPeople += expected;
      } else if (r.attending === "yes" && r.countedEvents.includes(event.key)) {
        // người đi cộng ở vòng rsvp bên dưới
      } else if (r.attending === "maybe" && r.countedEvents.includes(event.key)) {
        s.maybeResponses++;
        s.maybePeople += expected;
      } else {
        // "no", hoặc trả lời nhưng không chọn lễ này.
        s.noGuests++;
        s.noPeople += expected;
      }
    }

    // Người đi / chưa chắc từ mọi nguồn (khách có mã, link chung, khách đã xoá).
    for (const r of active) {
      if (!r.countedEvents.includes(event.key)) continue;
      if (r.attending === "yes") {
        s.yesResponses++;
        s.yesPeople += r.people;
        s.yesPeopleBySource[r.source] += r.people;
      } else if (r.attending === "maybe" && r.source !== "guest") {
        s.maybeResponses++;
      }
    }
    finish(s);
    return s;
  });

  // ---- Khách có mã nhưng không thuộc lễ nào: không vào số từng lễ, nên đếm riêng cho khỏi rơi mất ----
  const unassigned = { guests: 0, people: 0, answered: 0, pendingGuests: 0, pendingPeople: 0, yesPeople: 0, guestCodes: [] };
  for (const guest of guests) {
    if (validKeys(guest.invitedEvents, eventKeys).length) continue;
    const expected = headcount(guest.expectedCount);
    unassigned.guests++;
    unassigned.people += expected;
    unassigned.guestCodes.push(guest.code);
    const r = rsvpByCode.get(guest.code);
    if (r && r.attending) {
      unassigned.answered++;
      unassigned.yesPeople += r.people;
    } else {
      unassigned.pendingGuests++;
      unassigned.pendingPeople += expected;
    }
  }

  // ---- Theo ngày: cộng các lễ cùng ngày (mâm cũng cộng theo lễ, không làm tròn lại) ----
  const days = [];
  for (const s of perEvent) {
    let day = days.find((d) => d.date === s.date);
    if (!day) {
      day = { ...blankFigures(), date: s.date, eventKeys: [], tables: 0, tablesExpected: 0 };
      days.push(day);
    }
    day.eventKeys.push(s.key);
    addFigures(day, s);
    day.tables += s.tables;
    day.tablesExpected += s.tablesExpected;
  }
  days.sort((a, b) => a.date.localeCompare(b.date));

  // ---- Tổng số xác nhận (không theo lễ) ----
  const totals = {
    responses: entries.length,
    duplicates: entries.filter((e) => e.duplicateOf).length,
    bySource: { guest: 0, public: 0, deleted: 0 },
    byAttending: { yes: 0, no: 0, maybe: 0 },
    yesPeople: 0,
    guests: guests.length,
    guestsAnswered: rsvpByCode.size,
  };
  for (const e of active) {
    totals.bySource[e.source]++;
    if (e.attending) totals.byAttending[e.attending]++;
    totals.yesPeople += e.people;
  }

  return { entries, events: perEvent, days, totals, unassigned };
}

function newer(a, b) {
  const ta = a.updatedAt ?? -Infinity;
  const tb = b.updatedAt ?? -Infinity;
  if (ta !== tb) return ta > tb;
  return String(a.id) > String(b.id);
}

function blankFigures() {
  return {
    invitedGuests: 0, invitedPeople: 0,
    yesResponses: 0, yesPeople: 0, yesPeopleBySource: { guest: 0, public: 0, deleted: 0 },
    maybeResponses: 0, maybePeople: 0,
    noGuests: 0, noPeople: 0,
    pendingGuests: 0, pendingPeople: 0,
  };
}

function finish(s) {
  s.tables = tables(s.yesPeople);
  s.tablesExpected = tables(s.yesPeople + s.pendingPeople);
}

function addFigures(target, s) {
  for (const [key, value] of Object.entries(blankFigures())) {
    if (typeof value === "number") target[key] += s[key];
  }
  for (const source of Object.keys(target.yesPeopleBySource)) {
    target.yesPeopleBySource[source] += s.yesPeopleBySource[source];
  }
}
