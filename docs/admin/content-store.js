// Vòng đời bản nội dung thiệp theo C6 (CLAUDE.md mục 6):
//   siteContent/draft      { data, updatedAt, updatedBy }   bản nháp, chỉ admin đọc/ghi
//   siteContent/published  { data, updatedAt, updatedBy }   bản khách thấy, không bao giờ xoá
//   siteContentHistory/*   { data, publishedAt, publishedBy } bản published cũ, chỉ thêm mới
import {
  doc, collection, getDoc, getDocs, runTransaction, query, orderBy, limit, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { sameContent, isDraftBehind } from "./content-model.js";

const HISTORY_LIMIT = 30;

// Bản published đã đổi kể từ lúc trình sửa đọc (admin khác vừa xuất bản). published: bản đang xuất
// bản lúc phát hiện ({ data, updatedAt, updatedBy }, null nếu chưa có hoặc đọc không được), để trình
// sửa cho người dùng chọn mở bản đó hay giữ bản của mình.
export class StalePublishError extends Error {
  constructor(published = null) {
    super("Bản xuất bản vừa bị người khác thay đổi.");
    this.code = "content/stale-published";
    this.published = published;
  }
}

// Mốc published không xác định được (vd đọc lại sau khi xuất bản thấy bản của người khác):
// lần xuất bản sau luôn bị coi là cũ, buộc tải lại.
export const UNKNOWN_PUBLISHED = Object.freeze({ unknown: true });

// updatedAt của published: Timestamp, hoặc null khi chưa xuất bản lần nào.
function sameStamp(a, b) {
  if (a === UNKNOWN_PUBLISHED || b === UNKNOWN_PUBLISHED) return false;
  if (!a || !b) return !a && !b;
  return typeof a.isEqual === "function" ? a.isEqual(b) : a.toMillis() === b.toMillis();
}

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
  // fromPublished: bỏ qua nháp, sửa tiếp từ bản đang xuất bản (nếu có).
  // draftBehind: nháp soạn trên bản xuất bản cũ hơn bản đang xuất bản (xem isDraftBehind).
  async function load({ fromPublished = false } = {}) {
    const [draft, published] = await Promise.all([getDoc(draftRef), getDoc(publishedRef)]);
    const meta = {
      draft: draft.exists() ? draft.data() : null,
      published: published.exists() ? published.data() : null,
    };
    meta.draftBehind = isDraftBehind(meta.draft, meta.published);
    if (meta.draft && !(fromPublished && meta.published)) return { data: plain(meta.draft.data), origin: "draft", ...meta };
    if (meta.published) return { data: plain(meta.published.data), origin: "published", ...meta };
    if (!window.WEDDING_DATA) throw new Error("Không nạp được wedding-data.js.");
    return { data: plain(window.WEDDING_DATA), origin: "file", ...meta };
  }

  // Nháp chỉ được ghi khi bản published vẫn là bản nội dung đang sửa dựa trên (expectedUpdatedAt như
  // publish): nếu không, một nháp soạn từ bản cũ sẽ nằm trên máy chủ và người mở trình sửa sau đó
  // xuất bản nó đè bản mới mà không ai được cảnh báo. Transaction: published đổi giữa lúc đọc và lúc
  // ghi thì SDK đọc lại và lần này báo Stale. Cùng bản published thì người lưu sau thắng.
  async function saveDraft(data, expectedUpdatedAt) {
    const by = email();
    const content = plain(data);
    await runTransaction(db, async (tx) => {
      const current = await tx.get(publishedRef);
      const now = current.exists() ? current.data() : null;
      if (!sameStamp(now ? now.updatedAt : null, expectedUpdatedAt)) throw new StalePublishError(now);
      tx.set(draftRef, { data: content, updatedAt: serverTimestamp(), updatedBy: by });
    });
  }

  // Một transaction: bản published cũ (nếu có) chép nguyên sang lịch sử, ghi published mới, nháp =
  // bản vừa xuất bản (để mở lại trình sửa thấy đúng nội dung khách đang thấy). Lần đầu chưa có
  // published thì không ghi lịch sử (rules từ chối cả batch).
  // expectedUpdatedAt: updatedAt của bản published mà nội dung đang sửa dựa trên (null = chưa có).
  // Khác bản trên máy chủ -> StalePublishError, không ghi gì, thay vì đè lên bản admin khác vừa xuất bản.
  // Trả mốc mới cho lần xuất bản sau: updatedAt của bản vừa ghi, hoặc UNKNOWN_PUBLISHED nếu đọc lại
  // đã thấy bản khác.
  async function publish(data, expectedUpdatedAt) {
    const by = email();
    const content = plain(data);
    try {
      await runTransaction(db, async (tx) => {
        const current = await tx.get(publishedRef);
        const old = current.exists() ? current.data() : null;
        if (!sameStamp(old ? old.updatedAt : null, expectedUpdatedAt)) throw new StalePublishError(old);
        if (old) {
          tx.set(doc(historyCol), { data: old.data, publishedAt: old.updatedAt, publishedBy: by });
        }
        tx.set(publishedRef, { data: content, updatedAt: serverTimestamp(), updatedBy: by });
        tx.set(draftRef, { data: content, updatedAt: serverTimestamp(), updatedBy: by });
      });
    } catch (error) {
      // Rules kiểm bản lịch sử khớp published hiện tại: published đổi giữa chừng -> permission-denied.
      if (error && error.code === "permission-denied") {
        const now = await getDoc(publishedRef).catch(() => null);
        if (now && !sameStamp(now.exists() ? now.data().updatedAt : null, expectedUpdatedAt)) {
          throw new StalePublishError(now.exists() ? now.data() : null);
        }
      }
      throw error;
    }
    // Đã xuất bản xong: đọc lại lỗi cũng không coi là xuất bản hỏng.
    try {
      const after = await getDoc(publishedRef);
      const now = after.exists() ? after.data() : null;
      return now && now.updatedBy === by && sameContent(now.data, content) ? now.updatedAt : UNKNOWN_PUBLISHED;
    } catch {
      return UNKNOWN_PUBLISHED;
    }
  }

  async function listHistory() {
    const snap = await getDocs(query(historyCol, orderBy("publishedAt", "desc"), limit(HISTORY_LIMIT)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  // Khôi phục = xuất bản lại data của bản lịch sử; bản lịch sử giữ nguyên.
  // Trả { data, publishedStamp } như publish.
  async function restore(historyId, expectedUpdatedAt) {
    const snap = await getDoc(doc(historyCol, historyId));
    if (!snap.exists()) throw new Error("Không tìm thấy bản lịch sử.");
    const data = snap.data().data;
    const publishedStamp = await publish(data, expectedUpdatedAt);
    return { data: plain(data), publishedStamp };
  }

  return { load, saveDraft, publish, listHistory, restore };
}
