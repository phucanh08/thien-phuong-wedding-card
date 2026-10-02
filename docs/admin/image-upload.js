// Tải cặp ảnh WebP lên Storage theo C6: content/<uuid>-large.webp và content/<uuid>-small.webp.
import {
  ref, uploadBytes, getDownloadURL,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js";
import { MAX_IMAGE_BYTES } from "./image-pipeline.js";

const CACHE_CONTROL = "public, max-age=31536000, immutable";

async function uploadWebP(storage, path, blob) {
  if (blob.type !== "image/webp") throw new Error("Ảnh tải lên phải là WebP.");
  if (blob.size > MAX_IMAGE_BYTES) throw new Error("Ảnh tải lên phải ≤ 2 MB.");
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, blob, { contentType: "image/webp", cacheControl: CACHE_CONTROL });
  return getDownloadURL(fileRef);
}

// Trả về { id, large, small, paths } với large/small là download URL công khai.
export async function uploadImagePair(storage, { large, small }) {
  const id = crypto.randomUUID();
  const paths = { large: `content/${id}-large.webp`, small: `content/${id}-small.webp` };
  const [largeUrl, smallUrl] = await Promise.all([
    uploadWebP(storage, paths.large, large),
    uploadWebP(storage, paths.small, small),
  ]);
  return { id, large: largeUrl, small: smallUrl, paths };
}
