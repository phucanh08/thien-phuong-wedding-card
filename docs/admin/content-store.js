// Vòng đời bản nội dung thiệp theo C6 (CLAUDE.md mục 6):
//   siteContent/draft      { data, updatedAt, updatedBy }   bản nháp, chỉ admin đọc/ghi
//   siteContent/published  { data, updatedAt, updatedBy }   bản khách thấy, không bao giờ xoá
//   siteContentHistory/*   { data, publishedAt, publishedBy } bản published cũ, chỉ thêm mới
import {
  doc, collection, getDoc, getDocs, setDoc, runTransaction, query, orderBy, limit, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const HISTORY_LIMIT = 30;

// Firestore không nhận undefined; data luôn là bản sao thuần JSON, không dính object đang sửa.
function plain(data) {
  return JSON.parse(JSON.stringify(data));
}

export function createContentStore({ db, getUser }) {
  const draftRef = doc(db, "siteContent", "draft");
  const publishedRef = doc(db, "siteContent", "published");
  const historyCol = collection(db, "siteContentHistory");

  function email() {
    const user = getUser();
    if (!user || !user.email) throw new Error("Chưa đăng nhập.");
    return user.email;
  }

  // Bản để sửa: nháp nếu có, không thì bản đang xuất bản, không thì wedding-data.js (lần đầu).
  async function load() {
    const [draft, published] = await Promise.all([getDoc(draftRef), getDoc(publishedRef)]);
    const meta = {
      draft: draft.exists() ? draft.data() : null,
      published: published.exists() ? published.data() : null,
    };
    if (meta.draft) return { data: plain(meta.draft.data), origin: "draft", ...meta };
    if (meta.published) return { data: plain(meta.published.data), origin: "published", ...meta };
    if (!window.WEDDING_DATA) throw new Error("Không nạp được wedding-data.js.");
    return { data: plain(window.WEDDING_DATA), origin: "file", ...meta };
  }

  async function saveDraft(data) {
    await setDoc(draftRef, { data: plain(data), updatedAt: serverTimestamp(), updatedBy: email() });
  }

  // Một transaction: bản published cũ (nếu có) sang lịch sử, ghi published mới, nháp = bản vừa
  // xuất bản (để mở lại trình sửa thấy đúng nội dung khách đang thấy).
  async function publish(data) {
    const by = email();
    const content = plain(data);
    await runTransaction(db, async (tx) => {
      const current = await tx.get(publishedRef);
      if (current.exists()) {
        const old = current.data();
        tx.set(doc(historyCol), {
          data: old.data,
          publishedAt: old.updatedAt ?? serverTimestamp(),
          publishedBy: by,
        });
      }
      tx.set(publishedRef, { data: content, updatedAt: serverTimestamp(), updatedBy: by });
      tx.set(draftRef, { data: content, updatedAt: serverTimestamp(), updatedBy: by });
    });
  }

  async function listHistory() {
    const snap = await getDocs(query(historyCol, orderBy("publishedAt", "desc"), limit(HISTORY_LIMIT)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  // Khôi phục = xuất bản lại data của bản lịch sử; bản lịch sử giữ nguyên.
  async function restore(historyId) {
    const snap = await getDoc(doc(historyCol, historyId));
    if (!snap.exists()) throw new Error("Không tìm thấy bản lịch sử.");
    const data = snap.data().data;
    await publish(data);
    return plain(data);
  }

  return { load, saveDraft, publish, listHistory, restore };
}
