// Test hợp đồng C5 (CLAUDE.md) cho firestore.rules trên Firestore emulator.
// Chạy: npm test  (firebase emulators:exec đặt FIRESTORE_EMULATOR_HOST).
// RULES_FILE cho phép chạy cùng bộ test với file rules khác (proof RED/MUTATE).
import { after, before, beforeEach, describe, test } from "node:test";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";

const RULES_FILE = process.env.RULES_FILE ?? "firestore.rules";
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8282").split(":");

const GUEST_CODE = "ab23cd45";
const MISSING_CODE = "zz99zz99";
const SUPER_GOOGLE = "phucanhdn01@gmail.com";
const SUPER_PASSWORD = "admin@thien-phuong-wedding.local";

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-thien-phuong-rules",
    firestore: { rules: readFileSync(RULES_FILE, "utf8"), host, port: Number(port) },
  });
});

after(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "guests", GUEST_CODE), {
      name: "Anh Minh",
      salutation: "Anh",
      side: "groom",
      group: "Bạn đại học",
      phone: "0900000000",
      invitedEvents: ["ceremony"],
      expectedCount: 2,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      createdBy: SUPER_GOOGLE,
    });
    await setDoc(doc(db, "rsvp", GUEST_CODE), validRsvp());
    await setDoc(doc(db, "wishes", "w1"), validWish());
    await setDoc(doc(db, "accessRequests", "approvedUid"), {
      email: "editor@thien-phuong-wedding.local",
      displayName: "editor",
      provider: "password",
      username: "editor",
      status: "approved",
      mustChangePassword: false,
      requestedAt: Timestamp.now(),
    });
    await setDoc(doc(db, "accessRequests", "approvedForcedUid"), {
      email: "fresh@thien-phuong-wedding.local",
      displayName: "fresh",
      provider: "password",
      username: "fresh",
      status: "approved",
      mustChangePassword: true,
      requestedAt: Timestamp.now(),
    });
    await setDoc(doc(db, "accessRequests", "pendingUid"), pendingRequest("pending@gmail.com"));
    await setDoc(doc(db, "accessRequests", "forcedUid"), {
      ...pendingRequest("forced@thien-phuong-wedding.local"),
      provider: "password",
      username: "forced",
      mustChangePassword: true,
    });
    await setDoc(doc(db, "accessRequests", "rejectedUid"), {
      ...pendingRequest("rejected@gmail.com"),
      status: "rejected",
    });
  });
});

// ---- Ngữ cảnh ----

const guest = () => env.unauthenticatedContext().firestore();
const user = (uid, email, emailVerified = true) =>
  env.authenticatedContext(uid, { email, email_verified: emailVerified }).firestore();
const pendingUser = () => user("pendingUid", "pending@gmail.com");
const newcomer = () => user("newUid", "new@gmail.com");
const approvedForcedAdmin = () => user("approvedForcedUid", "fresh@thien-phuong-wedding.local");
const approvedAdmin = () => user("approvedUid", "editor@thien-phuong-wedding.local");
const superGoogle = () => user("superG", SUPER_GOOGLE, true);
const superPassword = () => user("superP", SUPER_PASSWORD, false);
const fakeSuperGoogle = () => user("fakeG", SUPER_GOOGLE, false);

// ---- Dữ liệu hợp lệ ----

function validRsvp(over = {}) {
  return {
    code: GUEST_CODE,
    attending: "yes",
    count: 2,
    events: ["ceremony"],
    note: "Sẽ tới",
    updatedAt: serverTimestamp(),
    ...over,
  };
}

function walkInRsvp(over = {}) {
  return validRsvp({ code: null, name: "Chị Lan", ...over });
}

function validWish(over = {}) {
  return {
    name: "Chị Lan",
    message: "Trăm năm hạnh phúc",
    code: null,
    createdAt: serverTimestamp(),
    ...over,
  };
}

function pendingRequest(email, over = {}) {
  return {
    email,
    displayName: "Người mới",
    provider: "google",
    status: "pending",
    mustChangePassword: false,
    requestedAt: Timestamp.now(),
    ...over,
  };
}

// ---- Khách (không đăng nhập) ----

describe("khách: guests", () => {
  test("get guests/{code} đúng code", async () => {
    await assertSucceeds(getDoc(doc(guest(), "guests", GUEST_CODE)));
  });
  test("không list guests", async () => {
    await assertFails(getDocs(collection(guest(), "guests")));
  });
  test("không tạo guests (code không tồn tại không tự tạo)", async () => {
    await assertFails(setDoc(doc(guest(), "guests", MISSING_CODE), { name: "X" }));
  });
  test("không sửa/xoá guests", async () => {
    await assertFails(updateDoc(doc(guest(), "guests", GUEST_CODE), { name: "Y" }));
    await assertFails(deleteDoc(doc(guest(), "guests", GUEST_CODE)));
  });
});

describe("khách: rsvp/{code}", () => {
  test("tạo khi guest tồn tại", async () => {
    await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), "rsvp", GUEST_CODE)));
    await assertSucceeds(setDoc(doc(guest(), "rsvp", GUEST_CODE), validRsvp()));
  });
  test("sửa khi guest tồn tại", async () => {
    await assertSucceeds(setDoc(doc(guest(), "rsvp", GUEST_CODE), validRsvp({ attending: "no", count: 0 })));
    await assertSucceeds(updateDoc(doc(guest(), "rsvp", GUEST_CODE), { count: 3, updatedAt: serverTimestamp() }));
  });
  test("serverTimestamp cho updatedAt được chấp nhận", async () => {
    await assertSucceeds(setDoc(doc(guest(), "rsvp", GUEST_CODE), validRsvp({ updatedAt: serverTimestamp() })));
  });
  test("chặn khi guests/{code} không tồn tại", async () => {
    await assertFails(setDoc(doc(guest(), "rsvp", MISSING_CODE), validRsvp({ code: MISSING_CODE })));
  });
  test("chặn sửa khi guests/{code} đã bị xoá", async () => {
    await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), "guests", GUEST_CODE)));
    await assertFails(setDoc(doc(guest(), "rsvp", GUEST_CODE), validRsvp({ count: 3 })));
    await assertFails(updateDoc(doc(guest(), "rsvp", GUEST_CODE), { count: 3, updatedAt: serverTimestamp() }));
  });
  test("chặn khi field code khác doc id", async () => {
    await assertFails(setDoc(doc(guest(), "rsvp", GUEST_CODE), validRsvp({ code: MISSING_CODE })));
  });
  test("chặn ghi code null đè lên rsvp của guest có thật", async () => {
    await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), "rsvp", GUEST_CODE)));
    await assertFails(setDoc(doc(guest(), "rsvp", GUEST_CODE), walkInRsvp()));
  });
  test("không xoá rsvp", async () => {
    await assertFails(deleteDoc(doc(guest(), "rsvp", GUEST_CODE)));
  });
  test("không đọc rsvp (get và list)", async () => {
    await assertFails(getDoc(doc(guest(), "rsvp", GUEST_CODE)));
    await assertFails(getDocs(collection(guest(), "rsvp")));
  });
});

describe("khách: rsvp/{autoId}", () => {
  test("tạo khi code == null và có name", async () => {
    await assertSucceeds(addDoc(collection(guest(), "rsvp"), walkInRsvp()));
  });
  test("chặn khi code null mà thiếu name", async () => {
    const { name, ...noName } = walkInRsvp();
    await assertFails(addDoc(collection(guest(), "rsvp"), noName));
  });
  test("chặn khi code null mà name rỗng", async () => {
    await assertFails(addDoc(collection(guest(), "rsvp"), walkInRsvp({ name: "" })));
  });
  test("chặn khi code là chuỗi không phải doc id", async () => {
    await assertFails(addDoc(collection(guest(), "rsvp"), walkInRsvp({ code: GUEST_CODE })));
  });
  test("không sửa rsvp/{autoId} đã tạo", async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "rsvp", "autoId12345"), walkInRsvp()));
    await assertFails(setDoc(doc(guest(), "rsvp", "autoId12345"), walkInRsvp({ count: 5 })));
  });
});

// Mỗi ca validate chạy trên cả ba đường ghi: sửa rsvp/{code} đã có, tạo rsvp/{code},
// tạo rsvp/{autoId} (code null + name) — để nhánh create và update đều bị kiểm.
describe("khách: validate rsvp", () => {
  const modes = {
    "update rsvp/{code}": async (data) => setDoc(doc(guest(), "rsvp", GUEST_CODE), data),
    "create rsvp/{code}": async (data) => {
      await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), "rsvp", GUEST_CODE)));
      return setDoc(doc(guest(), "rsvp", GUEST_CODE), data);
    },
    "create rsvp/{autoId}": async (data) => {
      const walkIn = { ...data, name: data.name ?? "Chị Lan" };
      if ("code" in walkIn) walkIn.code = null;
      return addDoc(collection(guest(), "rsvp"), walkIn);
    },
  };
  // over ghi đè field; remove là danh sách field bỏ đi.
  const build = (over, remove) => {
    const data = validRsvp(over);
    for (const key of remove) delete data[key];
    return data;
  };
  const ok = async (over = {}, remove = []) => {
    for (const [mode, write] of Object.entries(modes)) {
      await assertSucceeds(write(build(over, remove)), mode);
    }
  };
  const bad = async (over = {}, remove = []) => {
    for (const [mode, write] of Object.entries(modes)) {
      await assertFails(write(build(over, remove)), mode);
    }
  };
  test("count biên 0 và 20 hợp lệ", async () => {
    await ok({ count: 0 });
    await ok({ count: 20 });
  });
  test("count 21, -1, 1.5, chuỗi bị chặn", async () => {
    await bad({ count: 21 });
    await bad({ count: -1 });
    await bad({ count: 1.5 });
    await bad({ count: "2" });
  });
  test("attending chỉ yes|no|maybe", async () => {
    await ok({ attending: "maybe" });
    await bad({ attending: "YES" });
    await bad({ attending: true });
  });
  test("events phải là mảng", async () => {
    await bad({ events: "ceremony" });
  });
  test("note ≤ 500, kiểu string, có thể vắng", async () => {
    await ok({ note: "a".repeat(500) });
    await bad({ note: "a".repeat(501) });
    await bad({ note: 5 });
    await ok({}, ["note"]);
  });
  test("updatedAt phải == request.time (serverTimestamp)", async () => {
    await ok({ updatedAt: serverTimestamp() });
    await bad({ updatedAt: Timestamp.now() });
    await bad({ updatedAt: Timestamp.fromMillis(Date.now() + 86_400_000) });
    await bad({ updatedAt: "2026-10-02" });
  });
  test("thiếu field bắt buộc bị chặn", async () => {
    for (const key of ["code", "attending", "count", "events", "updatedAt"]) {
      await bad({}, [key]);
    }
  });
  test("name phải là string nếu có", async () => {
    await ok({ name: "Anh Minh" });
    await bad({ name: 42 });
  });
  test("name ≤ 60", async () => {
    await ok({ name: "n".repeat(60) });
    await bad({ name: "n".repeat(61) });
  });
  test("events ≤ 10 phần tử, mọi phần tử là string ≤ 50", async () => {
    const ten = Array.from({ length: 10 }, (_, i) => `e${i}`);
    await ok({ events: ten });
    await ok({ events: [] });
    await ok({ events: ["e".repeat(50)] });
    await bad({ events: [...ten, "e10"] });
    await bad({ events: ["ceremony", 5] });
    await bad({ events: [null] });
    await bad({ events: ["e".repeat(51)] });
    await bad({ events: ["ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "e".repeat(51)] });
  });
  test("field lạ bị chặn", async () => {
    await bad({ isAdmin: true });
  });
});

describe("khách: wishes", () => {
  const add = (data) => addDoc(collection(guest(), "wishes"), data);
  test("đọc (get, list) và tạo", async () => {
    await assertSucceeds(getDoc(doc(guest(), "wishes", "w1")));
    await assertSucceeds(getDocs(collection(guest(), "wishes")));
    await assertSucceeds(add(validWish()));
    await assertSucceeds(add(validWish({ code: GUEST_CODE })));
  });
  test("không sửa/xoá", async () => {
    await assertFails(updateDoc(doc(guest(), "wishes", "w1"), { message: "đổi" }));
    await assertFails(deleteDoc(doc(guest(), "wishes", "w1")));
  });
  test("name ≤ 60, message ≤ 500", async () => {
    await assertSucceeds(add(validWish({ name: "n".repeat(60), message: "m".repeat(500) })));
    await assertFails(add(validWish({ name: "n".repeat(61) })));
    await assertFails(add(validWish({ message: "m".repeat(501) })));
  });
  test("createdAt phải == request.time (serverTimestamp)", async () => {
    await assertSucceeds(add(validWish({ createdAt: serverTimestamp() })));
    await assertFails(add(validWish({ createdAt: Timestamp.now() })));
    await assertFails(add(validWish({ createdAt: Timestamp.fromMillis(Date.now() + 86_400_000) })));
  });
  test("name và message không rỗng", async () => {
    await assertFails(add(validWish({ name: "" })));
    await assertFails(add(validWish({ message: "" })));
    await assertSucceeds(add(validWish({ name: "n", message: "m" })));
  });
  test("kiểu sai và field thiếu/lạ bị chặn", async () => {
    await assertFails(add(validWish({ name: 1 })));
    await assertFails(add(validWish({ message: null })));
    await assertFails(add(validWish({ code: 123 })));
    await assertFails(add(validWish({ createdAt: "hôm nay" })));
    await assertFails(add(validWish({ approved: true })));
    const { code, ...noCode } = validWish();
    await assertFails(add(noCode));
  });
});

describe("khách: accessRequests", () => {
  test("không đọc/ghi", async () => {
    await assertFails(getDoc(doc(guest(), "accessRequests", "pendingUid")));
    await assertFails(getDocs(collection(guest(), "accessRequests")));
    await assertFails(setDoc(doc(guest(), "accessRequests", "x"), pendingRequest("x@gmail.com")));
  });
});

// ---- Người đăng nhập chưa được duyệt ----

describe("người đăng nhập chưa duyệt", () => {
  test("tạo accessRequests/{uid} của mình với pending", async () => {
    await assertSucceeds(setDoc(doc(newcomer(), "accessRequests", "newUid"), pendingRequest("new@gmail.com")));
  });
  test("tạo tài khoản mật khẩu pending kèm username hợp lệ", async () => {
    const db = user("pwUid", "linh.2@thien-phuong-wedding.local");
    await assertSucceeds(setDoc(doc(db, "accessRequests", "pwUid"),
      pendingRequest("linh.2@thien-phuong-wedding.local", { provider: "password", username: "linh.2" })));
  });
  test("displayName null được chấp nhận, kiểu khác bị chặn", async () => {
    const ref = doc(newcomer(), "accessRequests", "newUid");
    await assertSucceeds(setDoc(ref, pendingRequest("new@gmail.com", { displayName: null })));
    await assertFails(setDoc(ref, pendingRequest("new@gmail.com", { displayName: 5 })));
  });
  test("chặn tạo với status khác pending", async () => {
    for (const status of ["approved", "rejected"]) {
      await assertFails(setDoc(doc(newcomer(), "accessRequests", "newUid"),
        pendingRequest("new@gmail.com", { status })), status);
    }
  });
  test("chặn tạo doc của uid khác", async () => {
    await assertFails(setDoc(doc(newcomer(), "accessRequests", "otherUid"), pendingRequest("new@gmail.com")));
  });
  test("chặn tạo sai shape", async () => {
    const db = newcomer();
    const ref = doc(db, "accessRequests", "newUid");
    await assertFails(setDoc(ref, pendingRequest("someone@gmail.com")), "email khác token");
    await assertFails(setDoc(ref, pendingRequest("new@gmail.com", { provider: "facebook" })), "provider");
    await assertFails(setDoc(ref, pendingRequest("new@gmail.com", { username: "abc" })), "username với google");
    await assertFails(setDoc(ref, pendingRequest("new@gmail.com", { mustChangePassword: "no" })), "mustChangePassword");
    await assertFails(setDoc(ref, pendingRequest("new@gmail.com", { decidedBy: SUPER_GOOGLE })), "decidedBy");
  });
  test("username phải [a-z0-9._-]{3,30}", async () => {
    const email = "x@thien-phuong-wedding.local";
    const db = user("pwUid", email);
    const ref = doc(db, "accessRequests", "pwUid");
    for (const username of ["ab", "Abc", "a b", "a".repeat(31)]) {
      await assertFails(setDoc(ref, pendingRequest(email, { provider: "password", username })), username);
    }
  });
  test("đọc doc của mình", async () => {
    await assertSucceeds(getDoc(doc(pendingUser(), "accessRequests", "pendingUid")));
    await assertSucceeds(getDoc(doc(user("rejectedUid", "rejected@gmail.com"), "accessRequests", "rejectedUid")));
  });
  test("không đọc doc người khác, không list accessRequests", async () => {
    await assertFails(getDoc(doc(pendingUser(), "accessRequests", "approvedUid")));
    await assertFails(getDocs(collection(pendingUser(), "accessRequests")));
  });
  test("không tự đổi status", async () => {
    await assertFails(updateDoc(doc(pendingUser(), "accessRequests", "pendingUid"), { status: "approved" }));
    await assertFails(updateDoc(doc(user("rejectedUid", "rejected@gmail.com"), "accessRequests", "rejectedUid"),
      { status: "pending" }));
  });
  test("không xoá doc của mình", async () => {
    await assertFails(deleteDoc(doc(pendingUser(), "accessRequests", "pendingUid")));
  });
  test("vẫn là khách: get guests/{code} đúng code, không list guests", async () => {
    const db = pendingUser();
    await assertSucceeds(getDoc(doc(db, "guests", GUEST_CODE)));
    await assertFails(getDocs(collection(db, "guests")));
  });
  test("vẫn là khách: tạo/sửa rsvp, đọc và tạo wishes", async () => {
    const db = pendingUser();
    await assertSucceeds(setDoc(doc(db, "rsvp", GUEST_CODE), validRsvp({ count: 3 })));
    await assertSucceeds(updateDoc(doc(db, "rsvp", GUEST_CODE), { count: 4, updatedAt: serverTimestamp() }));
    await assertSucceeds(addDoc(collection(db, "rsvp"), walkInRsvp()));
    await assertSucceeds(getDocs(collection(db, "wishes")));
    await assertSucceeds(addDoc(collection(db, "wishes"), validWish()));
  });
  test("không đọc rsvp, accessRequests của người khác; không sửa/xoá wishes", async () => {
    const db = pendingUser();
    await assertFails(getDoc(doc(db, "rsvp", GUEST_CODE)));
    await assertFails(getDocs(collection(db, "rsvp")));
    await assertFails(getDoc(doc(db, "accessRequests", "approvedUid")));
    await assertFails(updateDoc(doc(db, "wishes", "w1"), { message: "đổi" }));
    await assertFails(deleteDoc(doc(db, "wishes", "w1")));
  });
  test("không ghi guests", async () => {
    await assertFails(setDoc(doc(pendingUser(), "guests", MISSING_CODE), { name: "X" }));
  });
});

describe("mustChangePassword", () => {
  const forced = () => user("forcedUid", "forced@thien-phuong-wedding.local");
  test("tự đổi true -> false", async () => {
    await assertSucceeds(updateDoc(doc(forced(), "accessRequests", "forcedUid"), { mustChangePassword: false }));
  });
  test("không đổi false -> true", async () => {
    await assertFails(updateDoc(doc(pendingUser(), "accessRequests", "pendingUid"), { mustChangePassword: true }));
  });
  test("không kèm field khác", async () => {
    await assertFails(updateDoc(doc(forced(), "accessRequests", "forcedUid"),
      { mustChangePassword: false, status: "approved" }));
    await assertFails(updateDoc(doc(forced(), "accessRequests", "forcedUid"),
      { mustChangePassword: false, displayName: "khác" }));
  });
  test("không đổi của người khác", async () => {
    await assertFails(updateDoc(doc(pendingUser(), "accessRequests", "forcedUid"), { mustChangePassword: false }));
  });
});

// ---- Admin và super admin ----

const admins = {
  "admin approved": approvedAdmin,
  "super admin Google email_verified": superGoogle,
  "super admin admin@thien-phuong-wedding.local": superPassword,
};

for (const [label, ctx] of Object.entries(admins)) {
  describe(label, () => {
    test("đọc mọi collection (get và list)", async () => {
      const db = ctx();
      await assertSucceeds(getDoc(doc(db, "guests", GUEST_CODE)));
      await assertSucceeds(getDocs(collection(db, "guests")));
      await assertSucceeds(getDocs(collection(db, "rsvp")));
      await assertSucceeds(getDocs(collection(db, "wishes")));
      await assertSucceeds(getDocs(collection(db, "accessRequests")));
    });
    test("ghi guests, rsvp, xoá lời chúc", async () => {
      const db = ctx();
      await assertSucceeds(setDoc(doc(db, "guests", MISSING_CODE), { name: "Cô chú Hai", side: "bride" }));
      await assertSucceeds(updateDoc(doc(db, "guests", GUEST_CODE), { expectedCount: 4 }));
      await assertSucceeds(setDoc(doc(db, "rsvp", GUEST_CODE), validRsvp({ count: 4 })));
      await assertSucceeds(deleteDoc(doc(db, "rsvp", GUEST_CODE)));
      await assertSucceeds(deleteDoc(doc(db, "wishes", "w1")));
      await assertSucceeds(deleteDoc(doc(db, "guests", GUEST_CODE)));
    });
    test("ghi rsvp sai shape vẫn được (admin không bị validate)", async () => {
      const db = ctx();
      await assertSucceeds(setDoc(doc(db, "rsvp", GUEST_CODE), { count: 99, extra: true }));
      await assertSucceeds(setDoc(doc(db, "rsvp", "adminCreated"), { whatever: 1 }));
      await assertSucceeds(addDoc(collection(db, "wishes"), { name: "", message: "" }));
    });
    test("collection ngoài 4 collection của C5 bị chặn", async () => {
      const db = ctx();
      await assertFails(setDoc(doc(db, "settings", "x"), { a: 1 }));
      await assertFails(getDoc(doc(db, "settings", "x")));
      await assertFails(getDocs(collection(db, "settings")));
      await assertFails(addDoc(collection(db, "other"), { a: 1 }));
    });
    test("duyệt/từ chối yêu cầu, tạo tài khoản mật khẩu", async () => {
      const db = ctx();
      await assertSucceeds(updateDoc(doc(db, "accessRequests", "pendingUid"),
        { status: "approved", decidedAt: Timestamp.now(), decidedBy: "x" }));
      await assertSucceeds(updateDoc(doc(db, "accessRequests", "rejectedUid"), { status: "rejected" }));
      await assertSucceeds(setDoc(doc(db, "accessRequests", "createdUid"), {
        email: "moi@thien-phuong-wedding.local", displayName: "moi", provider: "password",
        username: "moi", status: "approved", mustChangePassword: true, requestedAt: Timestamp.now(),
      }));
    });
  });
}

describe("admin approved nhưng mustChangePassword = true", () => {
  test("vẫn là admin (mustChangePassword chỉ là chốt chặn giao diện)", async () => {
    const db = approvedForcedAdmin();
    await assertSucceeds(getDocs(collection(db, "guests")));
    await assertSucceeds(getDocs(collection(db, "accessRequests")));
    await assertSucceeds(updateDoc(doc(db, "accessRequests", "pendingUid"), { status: "approved" }));
  });
});

describe("không phải super admin", () => {
  test("Google phucanhdn01@gmail.com với email_verified=false", async () => {
    const db = fakeSuperGoogle();
    await assertFails(getDocs(collection(db, "guests")));
    await assertFails(getDocs(collection(db, "accessRequests")));
    await assertFails(updateDoc(doc(db, "accessRequests", "pendingUid"), { status: "approved" }));
  });
  test("email_verified=false vẫn chỉ là người chưa duyệt: tự tạo pending được", async () => {
    await assertSucceeds(setDoc(doc(fakeSuperGoogle(), "accessRequests", "fakeG"), pendingRequest(SUPER_GOOGLE)));
  });
  test("tài khoản bị từ chối không có quyền admin", async () => {
    await assertFails(getDocs(collection(user("rejectedUid", "rejected@gmail.com"), "guests")));
  });
});
