// Hộp chọn ảnh cho một ô nội dung: chọn ảnh → khung cắt tự đặt giữa theo tỉ lệ ô → admin
// chỉnh → xác nhận → tạo WebP bản lớn/bản nhỏ trên máy → tải lên Storage → onUploaded(kết quả).
import {
  SLOT_ASPECTS, loadImageFile, makeImageVariants, ImageReadError,
} from "./image-pipeline.js";
import { createImageCropper } from "./image-cropper.js";
import { uploadImagePair } from "./image-upload.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

// kind: một khoá của SLOT_ASPECTS (portrait, cover, event, story, album, qr).
export function createImagePicker({ container, storage, kind, onUploaded }) {
  if (!(kind in SLOT_ASPECTS)) throw new Error(`Loại ô ảnh không hợp lệ: ${kind}`);

  const root = el("div", "image-picker d-flex flex-column gap-3");
  const input = el("input", "form-control");
  input.type = "file";
  input.accept = "image/*";
  const error = el("div", "alert alert-danger mb-0");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const stage = el("div");
  const actions = el("div", "image-picker-actions");
  const confirmBtn = el("button", "btn btn-rose", "Dùng ảnh này");
  confirmBtn.type = "button";
  const resetBtn = el("button", "btn btn-outline-secondary", "Đặt lại khung");
  resetBtn.type = "button";
  actions.append(resetBtn, confirmBtn);
  actions.hidden = true;
  const status = el("div", "small text-secondary text-center");
  status.setAttribute("aria-live", "polite");
  root.append(input, error, stage, actions, status);
  container.append(root);

  let loaded = null;
  let cropper = null;
  let busy = false;

  function showError(message) {
    error.textContent = message;
    error.hidden = !message;
  }

  function clear() {
    cropper?.destroy();
    cropper = null;
    loaded?.release();
    loaded = null;
    actions.hidden = true;
  }

  function setBusy(value, message = "") {
    busy = value;
    input.disabled = value;
    confirmBtn.disabled = value;
    resetBtn.disabled = value;
    status.textContent = message;
  }

  input.addEventListener("change", async () => {
    clear();
    showError("");
    status.textContent = "";
    const file = input.files[0];
    if (!file) return;
    try {
      loaded = await loadImageFile(file);
    } catch (err) {
      showError(err instanceof ImageReadError ? err.message : "Không đọc được ảnh.");
      input.value = "";
      return;
    }
    cropper = createImageCropper({ container: stage, loaded, aspect: SLOT_ASPECTS[kind] });
    resetBtn.hidden = !SLOT_ASPECTS[kind];
    actions.hidden = false;
  });

  resetBtn.addEventListener("click", () => cropper?.reset());

  confirmBtn.addEventListener("click", async () => {
    if (!loaded || busy) return;
    showError("");
    setBusy(true, "Đang nén ảnh…");
    try {
      const variants = await makeImageVariants(loaded.image, cropper.getCrop(), { kind });
      status.textContent = "Đang tải lên…";
      const urls = await uploadImagePair(storage, { large: variants.large.blob, small: variants.small.blob });
      setBusy(false, "Đã tải ảnh lên.");
      onUploaded?.({ ...urls, variants });
    } catch (err) {
      console.warn("Xử lý/tải ảnh thất bại", err);
      setBusy(false);
      showError(`Không tải được ảnh: ${err.message}`);
    }
  });

  return {
    getCrop: () => cropper?.getCrop() ?? null,
    destroy() {
      clear();
      root.remove();
    },
  };
}
