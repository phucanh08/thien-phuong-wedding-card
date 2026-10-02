// Khung cắt ảnh: khung cố định theo tỉ lệ ô, admin kéo ảnh để chọn vùng và thu phóng
// (con lăn chuột, chụm hai ngón, thanh trượt, phím mũi tên/+/-).
// Vùng cắt giữ theo toạ độ ảnh gốc nên không phụ thuộc kích thước khung trên màn hình.
import { centerCrop } from "./image-pipeline.js";

const MAX_ZOOM = 4;
const PREVIEW_MAX_EDGE = 1200;
const KEY_STEP_PX = 10;

function makePreview(image, width, height) {
  const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// loaded: kết quả loadImageFile. aspect: rộng/cao, null = không cắt.
export function createImageCropper({ container, loaded, aspect, onChange }) {
  const { width: imgW, height: imgH } = loaded;
  const base = centerCrop(imgW, imgH, aspect);
  const locked = !aspect;
  let zoom = 1;
  let crop = { ...base };

  const root = document.createElement("div");
  root.className = "image-cropper";
  const frame = document.createElement("div");
  frame.className = "image-cropper-frame";
  frame.style.setProperty("--crop-aspect", String(aspect || imgW / imgH));
  frame.tabIndex = 0;
  frame.setAttribute("role", "application");
  frame.setAttribute("aria-label", locked
    ? "Ảnh giữ nguyên khung"
    : "Kéo ảnh để chọn vùng cắt; phím mũi tên để dịch, + và - để thu phóng");
  const preview = makePreview(loaded.image, imgW, imgH);
  preview.className = "image-cropper-image";
  frame.append(preview);

  const zoomLabel = document.createElement("label");
  zoomLabel.className = "image-cropper-zoom";
  zoomLabel.textContent = "Thu phóng";
  const zoomInput = document.createElement("input");
  zoomInput.type = "range";
  zoomInput.className = "form-range";
  zoomInput.min = "1";
  zoomInput.max = String(MAX_ZOOM);
  zoomInput.step = "0.01";
  zoomInput.value = "1";
  zoomLabel.append(zoomInput);
  zoomLabel.hidden = locked;
  if (locked) frame.classList.add("is-locked");

  root.append(frame, zoomLabel);
  container.append(root);

  function clampCrop() {
    crop.x = Math.min(Math.max(crop.x, 0), imgW - crop.width);
    crop.y = Math.min(Math.max(crop.y, 0), imgH - crop.height);
  }

  // Điểm ảnh màn hình ứng với một điểm ảnh gốc.
  function displayScale() {
    return frame.getBoundingClientRect().width / crop.width;
  }

  function render() {
    const s = displayScale();
    if (!Number.isFinite(s) || s <= 0) return;
    preview.style.width = `${imgW * s}px`;
    preview.style.height = `${imgH * s}px`;
    preview.style.transform = `translate(${-crop.x * s}px, ${-crop.y * s}px)`;
  }

  function changed() {
    render();
    if (onChange) onChange(getCrop());
  }

  function panBy(dxScreen, dyScreen) {
    const s = displayScale();
    crop.x -= dxScreen / s;
    crop.y -= dyScreen / s;
    clampCrop();
    changed();
  }

  // Thu phóng quanh một điểm của khung (toạ độ tỉ lệ 0..1), mặc định giữa khung.
  function setZoom(next, fx = 0.5, fy = 0.5) {
    next = Math.min(Math.max(next, 1), MAX_ZOOM);
    const ax = crop.x + crop.width * fx;
    const ay = crop.y + crop.height * fy;
    zoom = next;
    crop.width = base.width / zoom;
    crop.height = base.height / zoom;
    crop.x = ax - crop.width * fx;
    crop.y = ay - crop.height * fy;
    clampCrop();
    zoomInput.value = String(zoom);
    changed();
  }

  // Kéo / chụm bằng pointer events (chuột, cảm ứng, bút).
  const pointers = new Map();
  let pinchStart = null;

  function framePoint(e) {
    const rect = frame.getBoundingClientRect();
    return { fx: (e.clientX - rect.left) / rect.width, fy: (e.clientY - rect.top) / rect.height };
  }

  function pinchInfo() {
    const [a, b] = [...pointers.values()];
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      mid: { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 },
    };
  }

  frame.addEventListener("pointerdown", (e) => {
    if (locked) return;
    frame.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) pinchStart = { ...pinchInfo(), zoom };
    e.preventDefault();
  });

  frame.addEventListener("pointermove", (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      panBy(dx, dy);
    } else if (pointers.size === 2 && pinchStart) {
      const now = pinchInfo();
      const { fx, fy } = framePoint(now.mid);
      setZoom(pinchStart.zoom * (now.dist / pinchStart.dist), fx, fy);
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
  }
  frame.addEventListener("pointerup", endPointer);
  frame.addEventListener("pointercancel", endPointer);

  frame.addEventListener("wheel", (e) => {
    if (locked) return;
    e.preventDefault();
    const { fx, fy } = framePoint(e);
    setZoom(zoom * Math.exp(-e.deltaY * 0.002), fx, fy);
  }, { passive: false });

  frame.addEventListener("keydown", (e) => {
    if (locked) return;
    const moves = {
      ArrowLeft: [KEY_STEP_PX, 0], ArrowRight: [-KEY_STEP_PX, 0],
      ArrowUp: [0, KEY_STEP_PX], ArrowDown: [0, -KEY_STEP_PX],
    };
    if (moves[e.key]) panBy(...moves[e.key]);
    else if (e.key === "+" || e.key === "=") setZoom(zoom * 1.1);
    else if (e.key === "-") setZoom(zoom / 1.1);
    else return;
    e.preventDefault();
  });

  zoomInput.addEventListener("input", () => setZoom(Number(zoomInput.value)));

  const resizeObserver = new ResizeObserver(render);
  resizeObserver.observe(frame);
  render();

  function getCrop() {
    return { ...crop };
  }

  return {
    getCrop,
    reset() {
      zoom = 1;
      crop = { ...base };
      zoomInput.value = "1";
      changed();
    },
    destroy() {
      resizeObserver.disconnect();
      root.remove();
    },
  };
}
