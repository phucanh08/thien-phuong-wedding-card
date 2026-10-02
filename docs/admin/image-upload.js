// Tải ảnh WebP lên Cloudflare R2 qua Worker theo C6: PUT <WORKER_URL>/content/<key> với
// Firebase ID token của admin; URL công khai = đúng URL đó.
import { USE_EMULATOR } from "../firebase-shared.js";
import { MAX_IMAGE_BYTES } from "./image-pipeline.js";

// Worker phục vụ R2. Chạy local thì dùng `wrangler dev` (port mặc định 8787).
export const WORKER_URL = USE_EMULATOR ? "http://127.0.0.1:8787" : "https://thien-phuong-media.phucanhdn01.workers.dev";

const HTTP_ERRORS = {
  401: "Phiên đăng nhập đã hết hạn hoặc chưa đăng nhập. Hãy đăng nhập lại rồi thử lại.",
  403: "Tài khoản này không có quyền tải ảnh (chỉ admin đã được duyệt).",
  413: "Ảnh quá lớn, mỗi ảnh tối đa 2 MB.",
  415: "Sai định dạng tệp, máy chủ chỉ nhận ảnh WebP.",
};

// Tải một blob lên key (dưới content/) và trả URL công khai.
// getIdToken: hàm trả Firebase ID token của admin đang đăng nhập (vd () => auth.currentUser.getIdToken()).
export async function uploadToWorker(blob, key, { getIdToken, workerUrl = WORKER_URL }) {
  if (!workerUrl) throw new Error("Chưa cấu hình địa chỉ Worker tải ảnh.");
  if (!key.startsWith("content/")) throw new Error(`Key phải nằm dưới content/: ${key}`);
  const url = `${workerUrl}/${key}`;
  const token = await getIdToken();
  let response;
  try {
    response = await fetch(url, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": blob.type },
      body: blob,
    });
  } catch (err) {
    throw new Error("Không kết nối được máy chủ ảnh. Kiểm tra mạng rồi thử lại.", { cause: err });
  }
  if (!response.ok) {
    throw new Error(HTTP_ERRORS[response.status] ?? `Máy chủ ảnh trả lỗi ${response.status}. Thử lại sau.`);
  }
  return url;
}

function checkImage(blob) {
  if (blob.type !== "image/webp") throw new Error("Ảnh tải lên phải là WebP.");
  if (blob.size > MAX_IMAGE_BYTES) throw new Error("Ảnh tải lên phải ≤ 2 MB.");
}

// Tải cặp ảnh content/<uuid>-large.webp và content/<uuid>-small.webp.
// Trả về { id, large, small, keys } với large/small là URL công khai.
export async function uploadImagePair({ large, small }, options) {
  checkImage(large);
  checkImage(small);
  const id = crypto.randomUUID();
  const keys = { large: `content/${id}-large.webp`, small: `content/${id}-small.webp` };
  const [largeUrl, smallUrl] = await Promise.all([
    uploadToWorker(large, keys.large, options),
    uploadToWorker(small, keys.small, options),
  ]);
  return { id, large: largeUrl, small: smallUrl, keys };
}
