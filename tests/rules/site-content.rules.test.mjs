// Test hợp đồng C6 (CLAUDE.md) phần Firestore: siteContent và siteContentHistory.
// Chạy: npm test  (firebase emulators:exec đặt FIRESTORE_EMULATOR_HOST).
// RULES_FILE cho phép chạy cùng bộ test với file rules khác (proof RED/MUTATE).
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
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
  writeBatch,
} from "firebase/firestore";

const RULES_FILE = process.env.RULES_FILE ?? "firestore.rules";
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8282").split(":");

const SUPER_GOOGLE = "phucanhdn01@gmail.com";
const SUPER_PASSWORD = "admin@thien-phuong-wedding.local";
const EDITOR = "editor@thien-phuong-wedding.local";

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
    await setDoc(doc(db, "accessRequests", "approvedUid"), accessRequest(EDITOR, "approved"));
    await setDoc(doc(db, "accessRequests", "pendingUid"), accessRequest("pending@gmail.com", "pending"));
    await setDoc(doc(db, "accessRequests", "rejectedUid"), accessRequest("rejected@gmail.com", "rejected"));
    await setDoc(doc(db, "siteContent", "published"), content(SUPER_GOOGLE));
    await setDoc(doc(db, "siteContent", "draft"), content(SUPER_GOOGLE));
    await setDoc(doc(db, "siteContentHistory", "h1"), history(SUPER_GOOGLE));
  });
});

// ---- Ngữ cảnh ----

const guest = () => env.unauthenticatedContext().firestore();
const user = (uid, email, emailVerified = true) =>
  env.authenticatedContext(uid, { email, email_verified: emailVerified }).firestore();
const pendingUser = () => user("pendingUid", "pending@gmail.com");
const rejectedUser = () => user("rejectedUid", "rejected@gmail.com");
const newcomer = () => user("newUid", "new@gmail.com");
const fakeSuperGoogle = () => user("fakeG", SUPER_GOOGLE, false);

// ---- Dữ liệu hợp lệ ----

function accessRequest(email, status) {
  return {
    email,
    displayName: "x",
    provider: "google",
    status,
    mustChangePassword: false,
    requestedAt: Timestamp.now(),
  };
}

const weddingData = () => ({ couple: { groom: "Thiện", bride: "Phương" }, events: [{ key: "ceremony" }] });

function content(email, over = {}) {
  return { data: weddingData(), updatedAt: serverTimestamp(), updatedBy: email, ...over };
}

function history(email, over = {}) {
  return { data: weddingData(), publishedAt: serverTimestamp(), publishedBy: email, ...over };
}

// Đọc doc bỏ qua rules (xem trạng thái thật sau khi ghi).
async function readRaw(path) {
  let snap;
  await env.withSecurityRulesDisabled(async (c) => {
    snap = await getDoc(doc(c.firestore(), ...path));
  });
  return snap;
}

// Bản lịch sử đúng C6: chép published hiện có, publishedAt = updatedAt cũ, publishedBy = người ghi.
async function publishedCopy(email) {
  const { data, updatedAt } = (await readRaw(["siteContent", "published"])).data();
  return { data, publishedAt: updatedAt, publishedBy: email };
}

const seedPublished = (value) => env.withSecurityRulesDisabled((c) =>
  setDoc(doc(c.firestore(), "siteContent", "published"), value));

// Xuất bản như trình sửa nội dung: một batch chép published cũ sang lịch sử và ghi bản mới.
function publishBatch(db, historyDoc, newContent) {
  const batch = writeBatch(db);
  batch.set(doc(collection(db, "siteContentHistory")), historyDoc);
  batch.set(doc(db, "siteContent", "published"), newContent);
  return batch.commit();
}

// ---- Không phải admin ----

const nonAdmins = {
  "khách": [guest, null],
  "người đăng nhập chưa duyệt": [pendingUser, "pending@gmail.com"],
  "người đăng nhập chưa có yêu cầu": [newcomer, "new@gmail.com"],
  "tài khoản bị từ chối": [rejectedUser, "rejected@gmail.com"],
  "Google phucanhdn01@gmail.com với email_verified=false": [fakeSuperGoogle, SUPER_GOOGLE],
};

for (const [label, [ctx, email]] of Object.entries(nonAdmins)) {
  describe(`${label}: siteContent`, () => {
    test("get siteContent/published", async () => {
      await assertSucceeds(getDoc(doc(ctx(), "siteContent", "published")));
    });
    test("không get siteContent/draft", async () => {
      await assertFails(getDoc(doc(ctx(), "siteContent", "draft")));
    });
    test("không list siteContent", async () => {
      await assertFails(getDocs(collection(ctx(), "siteContent")));
    });
    test("không ghi siteContent/published (sửa, tạo lại, xoá)", async () => {
      const db = ctx();
      await assertFails(setDoc(doc(db, "siteContent", "published"), content(email)));
      await assertFails(updateDoc(doc(db, "siteContent", "published"), { updatedBy: email }));
      await assertFails(deleteDoc(doc(db, "siteContent", "published")));
      await env.withSecurityRulesDisabled((c) => deleteDoc(doc(c.firestore(), "siteContent", "published")));
      await assertFails(setDoc(doc(db, "siteContent", "published"), content(email)));
    });
    test("không ghi siteContent/draft", async () => {
      const db = ctx();
      await assertFails(setDoc(doc(db, "siteContent", "draft"), content(email)));
      await assertFails(deleteDoc(doc(db, "siteContent", "draft")));
    });
    test("không đọc/ghi siteContentHistory", async () => {
      const db = ctx();
      const copy = await publishedCopy(email);
      await assertFails(getDoc(doc(db, "siteContentHistory", "h1")));
      await assertFails(getDocs(collection(db, "siteContentHistory")));
      await assertFails(addDoc(collection(db, "siteContentHistory"), copy));
      await assertFails(setDoc(doc(db, "siteContentHistory", "h1"), copy));
      await assertFails(deleteDoc(doc(db, "siteContentHistory", "h1")));
    });
    test("không xuất bản bằng batch (lịch sử + published)", async () => {
      const db = ctx();
      await assertFails(publishBatch(db, await publishedCopy(email),
        content(email, { data: { couple: { groom: "X" } } })));
    });
  });
}

// ---- Admin và super admin ----

const admins = {
  "admin approved": [() => user("approvedUid", EDITOR), EDITOR],
  "super admin Google email_verified": [() => user("superG", SUPER_GOOGLE, true), SUPER_GOOGLE],
  "super admin admin@thien-phuong-wedding.local": [() => user("superP", SUPER_PASSWORD, false), SUPER_PASSWORD],
};

for (const [label, [ctx, email]] of Object.entries(admins)) {
  describe(`${label}: siteContent`, () => {
    test("đọc published, draft và list siteContent", async () => {
      const db = ctx();
      await assertSucceeds(getDoc(doc(db, "siteContent", "published")));
      await assertSucceeds(getDoc(doc(db, "siteContent", "draft")));
      await assertSucceeds(getDocs(collection(db, "siteContent")));
    });
    test("ghi draft và published với updatedBy là email của mình", async () => {
      const db = ctx();
      await assertSucceeds(setDoc(doc(db, "siteContent", "draft"), content(email)));
      await assertSucceeds(setDoc(doc(db, "siteContent", "published"), content(email)));
      await assertSucceeds(updateDoc(doc(db, "siteContent", "published"),
        { data: { tuỳ: "ý" }, updatedAt: serverTimestamp(), updatedBy: email }));
    });
    test("tạo mới published/draft khi chưa có", async () => {
      await env.clearFirestore();
      await env.withSecurityRulesDisabled((c) =>
        setDoc(doc(c.firestore(), "accessRequests", "approvedUid"), accessRequest(EDITOR, "approved")));
      const db = ctx();
      await assertSucceeds(setDoc(doc(db, "siteContent", "published"), content(email)));
      await assertSucceeds(setDoc(doc(db, "siteContent", "draft"), content(email)));
    });
    test("xoá draft", async () => {
      await assertSucceeds(deleteDoc(doc(ctx(), "siteContent", "draft")));
    });
    test("chặn updatedBy khác email người ghi", async () => {
      const other = email === EDITOR ? SUPER_GOOGLE : EDITOR;
      const db = ctx();
      await assertFails(setDoc(doc(db, "siteContent", "published"), content(other)));
      await assertFails(setDoc(doc(db, "siteContent", "draft"), content(other)));
      await assertFails(updateDoc(doc(db, "siteContent", "draft"), { data: {}, updatedBy: other }));
    });
    test("chặn ghi đè data mà giữ updatedBy của người khác", async () => {
      // Doc seed có updatedBy = SUPER_GOOGLE; người ghi khác email thì phải tự đặt updatedBy.
      if (email === SUPER_GOOGLE) return;
      await assertFails(updateDoc(doc(ctx(), "siteContent", "draft"), { data: {} }));
    });
    test("chặn thiếu key cấp trên", async () => {
      const db = ctx();
      for (const key of ["data", "updatedAt", "updatedBy"]) {
        const data = content(email);
        delete data[key];
        await assertFails(setDoc(doc(db, "siteContent", "published"), data), `thiếu ${key}`);
        await assertFails(setDoc(doc(db, "siteContent", "draft"), data), `thiếu ${key}`);
      }
    });
    test("chặn key cấp trên lạ", async () => {
      const db = ctx();
      await assertFails(setDoc(doc(db, "siteContent", "published"), content(email, { extra: 1 })));
      await assertFails(setDoc(doc(db, "siteContent", "draft"), content(email, { publishedBy: email })));
    });
    test("không ghi siteContent ngoài published/draft", async () => {
      const db = ctx();
      await assertFails(setDoc(doc(db, "siteContent", "other"), content(email)));
      await assertFails(getDoc(doc(db, "siteContent", "other")));
    });
  });

  describe(`${label}: siteContentHistory`, () => {
    test("đọc (get, list)", async () => {
      const db = ctx();
      await assertSucceeds(getDoc(doc(db, "siteContentHistory", "h1")));
      await assertSucceeds(getDocs(collection(db, "siteContentHistory")));
    });
    test("tạo bản lịch sử với publishedBy là email của mình", async () => {
      await assertSucceeds(addDoc(collection(ctx(), "siteContentHistory"), await publishedCopy(email)));
    });
    test("xoá bản lịch sử", async () => {
      await assertSucceeds(deleteDoc(doc(ctx(), "siteContentHistory", "h1")));
    });
    test("chặn publishedBy khác email người ghi", async () => {
      const other = email === EDITOR ? SUPER_GOOGLE : EDITOR;
      await assertFails(addDoc(collection(ctx(), "siteContentHistory"), await publishedCopy(other)));
    });
    test("chặn thiếu hoặc thừa key cấp trên", async () => {
      const db = ctx();
      const copy = await publishedCopy(email);
      for (const key of ["data", "publishedAt", "publishedBy"]) {
        const data = { ...copy };
        delete data[key];
        await assertFails(addDoc(collection(db, "siteContentHistory"), data), `thiếu ${key}`);
      }
      await assertFails(addDoc(collection(db, "siteContentHistory"), content(email)));
      await assertFails(addDoc(collection(db, "siteContentHistory"), { ...copy, updatedBy: email }));
    });
  });

  // ---- Ràng buộc doc nội dung (C6) ----

  describe(`${label}: ràng buộc doc nội dung C6`, () => {
    const notMaps = ["x", 1, true, null, ["a"]];

    test("data của published/draft phải là map", async () => {
      const db = ctx();
      for (const bad of notMaps) {
        const msg = `data = ${JSON.stringify(bad)}`;
        await assertFails(setDoc(doc(db, "siteContent", "published"), content(email, { data: bad })), msg);
        await assertFails(setDoc(doc(db, "siteContent", "draft"), content(email, { data: bad })), msg);
        await assertFails(updateDoc(doc(db, "siteContent", "draft"),
          { data: bad, updatedAt: serverTimestamp(), updatedBy: email }), msg);
      }
    });

    test("updatedAt của published/draft phải là timestamp (không bắt bằng request.time)", async () => {
      const db = ctx();
      for (const bad of ["2026-10-02T00:00:00Z", 1727827200000, null, { seconds: 1 }]) {
        const msg = `updatedAt = ${JSON.stringify(bad)}`;
        await assertFails(setDoc(doc(db, "siteContent", "published"), content(email, { updatedAt: bad })), msg);
        await assertFails(setDoc(doc(db, "siteContent", "draft"), content(email, { updatedAt: bad })), msg);
      }
      const past = Timestamp.fromDate(new Date("2026-01-01T00:00:00Z"));
      await assertSucceeds(setDoc(doc(db, "siteContent", "draft"), content(email, { updatedAt: past })));
    });

    test("không xoá siteContent/published", async () => {
      await assertFails(deleteDoc(doc(ctx(), "siteContent", "published")));
      assert.ok((await readRaw(["siteContent", "published"])).exists());
    });

    test("data của bản lịch sử phải là map", async () => {
      // published cũ hỏng (ghi trước khi có rules này): chép y nguyên vẫn bị chặn.
      for (const bad of notMaps) {
        await seedPublished(content(SUPER_GOOGLE, { data: bad }));
        await assertFails(addDoc(collection(ctx(), "siteContentHistory"), await publishedCopy(email)),
          `data = ${JSON.stringify(bad)}`);
      }
    });

    test("publishedAt của bản lịch sử phải là timestamp", async () => {
      for (const bad of ["2026-10-01T00:00:00Z", 1727740800000, null]) {
        await seedPublished(content(SUPER_GOOGLE, { updatedAt: bad }));
        await assertFails(addDoc(collection(ctx(), "siteContentHistory"), await publishedCopy(email)),
          `publishedAt = ${JSON.stringify(bad)}`);
      }
    });

    test("bản lịch sử phải chép đúng published hiện có", async () => {
      const db = ctx();
      const copy = await publishedCopy(email);
      await assertFails(addDoc(collection(db, "siteContentHistory"),
        { ...copy, publishedAt: Timestamp.fromMillis(0) }), "publishedAt khác updatedAt cũ");
      await assertFails(addDoc(collection(db, "siteContentHistory"),
        { ...copy, data: { ...copy.data, events: [] } }), "data khác published");
      await assertFails(addDoc(collection(db, "siteContentHistory"), history(email)), "bản tự chế");
      await env.withSecurityRulesDisabled((c) => deleteDoc(doc(c.firestore(), "siteContent", "published")));
      await assertFails(addDoc(collection(db, "siteContentHistory"), copy), "chưa có published");
    });

    test("bản lịch sử chỉ thêm mới, không sửa", async () => {
      const db = ctx();
      const copy = await publishedCopy(email);
      await assertFails(updateDoc(doc(db, "siteContentHistory", "h1"), { publishedBy: email }));
      await assertFails(setDoc(doc(db, "siteContentHistory", "h1"), copy));
      await assertFails(setDoc(doc(db, "siteContentHistory", "h1"), copy, { merge: true }));
      await assertSucceeds(setDoc(doc(db, "siteContentHistory", "mine"), copy));
      await assertFails(setDoc(doc(db, "siteContentHistory", "mine"), copy));
      await assertSucceeds(deleteDoc(doc(db, "siteContentHistory", "mine")));
    });

    test("xuất bản: một batch chép published cũ sang lịch sử và ghi bản mới", async () => {
      const db = ctx();
      const before = (await readRaw(["siteContent", "published"])).data();
      const next = { couple: { groom: "Thiện", bride: "Phương" }, events: [{ key: "ceremony", title: "Lễ" }] };
      await assertSucceeds(publishBatch(db, await publishedCopy(email), content(email, { data: next })));

      const published = (await readRaw(["siteContent", "published"])).data();
      assert.deepEqual(published.data, next);
      assert.equal(published.updatedBy, email);
      let entries;
      await env.withSecurityRulesDisabled(async (c) => {
        entries = (await getDocs(collection(c.firestore(), "siteContentHistory"))).docs
          .filter((d) => d.id !== "h1").map((d) => d.data());
      });
      assert.equal(entries.length, 1);
      assert.deepEqual(entries[0].data, before.data);
      assert.ok(entries[0].publishedAt.isEqual(before.updatedAt));

      // Khách vẫn get được bản mới.
      const seen = await assertSucceeds(getDoc(doc(guest(), "siteContent", "published")));
      assert.deepEqual(seen.data().data, next);
    });

    test("xuất bản: lịch sử phải chép bản trước batch, không phải bản mới hay bản cũ đã lỗi thời", async () => {
      const db = ctx();
      const stale = await publishedCopy(email);
      const next = content(email, { data: { couple: { groom: "Mới" } } });
      await assertFails(publishBatch(db, { ...stale, data: next.data }, next), "chép bản mới");
      await assertSucceeds(publishBatch(db, stale, next));
      // Xuất bản tiếp bằng bản chép cũ (đã bị thay) thì bị chặn.
      await assertFails(publishBatch(db, stale, content(email, { data: { couple: { groom: "Sau" } } })));
    });

    test("khôi phục: xuất bản lại data của một bản lịch sử", async () => {
      const old = { couple: { groom: "Cũ", bride: "Cũ" }, events: [{ key: "ceremony" }], story: [] };
      await env.withSecurityRulesDisabled((c) =>
        setDoc(doc(c.firestore(), "siteContentHistory", "h0"), history(SUPER_GOOGLE, { data: old })));
      const db = ctx();
      const chosen = (await assertSucceeds(getDoc(doc(db, "siteContentHistory", "h0")))).data();
      await assertSucceeds(publishBatch(db, await publishedCopy(email), content(email, { data: chosen.data })));
      assert.deepEqual((await readRaw(["siteContent", "published"])).data().data, old);
      assert.ok((await readRaw(["siteContentHistory", "h0"])).exists(), "bản được khôi phục vẫn còn");
    });
  });
}
