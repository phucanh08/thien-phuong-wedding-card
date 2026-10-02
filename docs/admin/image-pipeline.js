// Xử lý ảnh ngay trên máy admin trước khi tải lên (C6): đọc ảnh (EXIF xoay đúng chiều),
// cắt theo tỉ lệ ô, thu nhỏ bản lớn/bản nhỏ, mã hoá WebP ≤ 2 MB.

// Tỉ lệ rộng/cao của khung theo loại ô; null = giữ tỉ lệ gốc (không cắt, chỉ thu nhỏ).
export const SLOT_ASPECTS = {
  portrait: 2 / 3,
  cover: 2 / 3,
  event: 7 / 6,
  story: 2 / 3,
  album: null,
  qr: 1,
};

export const LARGE_MAX_EDGE = 1600;
export const SMALL_MAX_EDGE = 600;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const DEFAULT_QUALITY = 0.75;
// QR phải còn quét được: nén nhẹ hơn ảnh thường.
const QR_QUALITY = 0.92;
const MIN_QUALITY = 0.3;
const QUALITY_STEP = 0.1;
// iOS Safari từ chối canvas lớn hơn ~16,7 triệu điểm ảnh.
const MAX_CANVAS_AREA = 16_000_000;

// Encoder WebP dự phòng (libwebp biên dịch WASM, gói @jsquash/webp — repackage từ Squoosh).
// Safari/iOS không mã hoá được WebP qua canvas.toBlob nên chỉ nạp khi thật sự cần.
const WEBP_WASM_ENCODER_URL = "https://cdn.jsdelivr.net/npm/@jsquash/webp@1.5.0/codec/enc/webp_enc.js";
// Theo struct WebPConfig (encode.h), giống defaultOptions của @jsquash/webp/meta.js.
const WEBP_WASM_OPTIONS = {
  quality: 75, target_size: 0, target_PSNR: 0, method: 4, sns_strength: 50,
  filter_strength: 60, filter_sharpness: 0, filter_type: 1, partitions: 0, segments: 4,
  pass: 1, show_compressed: 0, preprocessing: 0, autofilter: 0, partition_limit: 0,
  alpha_compression: 1, alpha_filtering: 1, alpha_quality: 100, lossless: 0, exact: 0,
  image_hint: 0, emulate_jpeg_size: 0, thread_level: 0, low_memory: 0, near_lossless: 100,
  use_delta_palette: 0, use_sharp_yuv: 0,
};

export class ImageReadError extends Error {}

function isHeic(file) {
  return /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name || "");
}

// Trả về { image, width, height, release } với width/height đã theo chiều EXIF.
// <img> và drawImage tự áp EXIF Orientation (Chrome 81+, Safari 13.1+).
export async function loadImageFile(file) {
  if (!file) throw new ImageReadError("Chưa chọn ảnh.");
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    if (isHeic(file)) {
      throw new ImageReadError(
        "Trình duyệt này không đọc được ảnh HEIC. Hãy chọn ảnh từ Thư viện ảnh trên iPhone " +
        "(máy tự đổi sang JPEG), hoặc đổi ảnh sang JPEG/PNG rồi chọn lại.");
    }
    throw new ImageReadError("Không đọc được tệp này. Hãy chọn ảnh JPEG, PNG hoặc WebP.");
  }
  return {
    image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    release: () => URL.revokeObjectURL(url),
  };
}

// Vùng cắt lớn nhất đúng tỉ lệ, đặt giữa ảnh. aspect null → cả ảnh.
export function centerCrop(width, height, aspect) {
  if (!aspect) return { x: 0, y: 0, width, height };
  let w = width;
  let h = w / aspect;
  if (h > height) {
    h = height;
    w = h * aspect;
  }
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

function outputSize(crop, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(crop.width, crop.height));
  return {
    width: Math.max(1, Math.round(crop.width * scale)),
    height: Math.max(1, Math.round(crop.height * scale)),
  };
}

function newCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function drawScaled(source, sx, sy, sw, sh, width, height) {
  const canvas = newCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);
  return canvas;
}

// Cắt vùng crop (toạ độ ảnh gốc) rồi thu nhỏ để cạnh dài ≤ maxEdge.
// Thu nhỏ từng nửa một để tránh răng cưa khi giảm nhiều lần.
export function renderCrop(source, crop, maxEdge) {
  const { width, height } = outputSize(crop, maxEdge);
  let factor = 1;
  while (width * factor * 2 <= crop.width && height * factor * 2 <= crop.height &&
         width * height * factor * factor * 4 <= MAX_CANVAS_AREA) {
    factor *= 2;
  }
  let canvas = drawScaled(source, crop.x, crop.y, crop.width, crop.height, width * factor, height * factor);
  while (factor > 1) {
    factor /= 2;
    canvas = drawScaled(canvas, 0, 0, canvas.width, canvas.height, width * factor, height * factor);
  }
  return canvas;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

let nativeWebP = null; // null = chưa biết; false sau lần canvas trả về loại khác WebP.
let wasmEncoder = null;

async function loadWasmEncoder() {
  if (!wasmEncoder) {
    wasmEncoder = import(WEBP_WASM_ENCODER_URL)
      .then((mod) => mod.default({ noInitialRun: true }))
      .catch((err) => {
        wasmEncoder = null;
        throw new Error("Không tải được bộ mã hoá WebP (kiểm tra kết nối mạng).", { cause: err });
      });
  }
  return wasmEncoder;
}

async function encodeWithWasm(canvas, quality) {
  const encoder = await loadWasmEncoder();
  const { data, width, height } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  const bytes = encoder.encode(data, width, height, { ...WEBP_WASM_OPTIONS, quality: Math.round(quality * 100) });
  if (!bytes) throw new Error("Mã hoá WebP thất bại.");
  return new Blob([bytes], { type: "image/webp" });
}

// Mã hoá WebP bằng canvas nếu trình duyệt hỗ trợ, không thì dùng encoder WASM.
export async function encodeWebP(canvas, quality = DEFAULT_QUALITY) {
  if (nativeWebP !== false) {
    const blob = await canvasToBlob(canvas, "image/webp", quality);
    if (blob && blob.type === "image/webp") {
      nativeWebP = true;
      return blob;
    }
    nativeWebP = false;
  }
  return encodeWithWasm(canvas, quality);
}

// Giảm chất lượng dần tới khi file ≤ 2 MB.
export async function encodeWithinLimit(canvas, quality = DEFAULT_QUALITY) {
  for (let q = quality; q >= MIN_QUALITY - 1e-9; q -= QUALITY_STEP) {
    const blob = await encodeWebP(canvas, q);
    if (blob.size <= MAX_IMAGE_BYTES) return blob;
  }
  throw new Error("Ảnh quá chi tiết, không nén được dưới 2 MB.");
}

// Tạo bản lớn (≤ 1600px) và bản nhỏ (≤ 600px) WebP từ vùng cắt.
export async function makeImageVariants(source, crop, { kind } = {}) {
  const quality = kind === "qr" ? QR_QUALITY : DEFAULT_QUALITY;
  const largeCanvas = renderCrop(source, crop, LARGE_MAX_EDGE);
  const full = { x: 0, y: 0, width: largeCanvas.width, height: largeCanvas.height };
  const smallCanvas = renderCrop(largeCanvas, full, SMALL_MAX_EDGE);
  const large = await encodeWithinLimit(largeCanvas, quality);
  const small = await encodeWithinLimit(smallCanvas, quality);
  return {
    large: { blob: large, width: largeCanvas.width, height: largeCanvas.height },
    small: { blob: small, width: smallCanvas.width, height: smallCanvas.height },
  };
}
