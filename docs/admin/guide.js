// Mục "Hướng dẫn sử dụng": nhớ tài khoản nào đã vào trang quản lý trên trình duyệt này để tự mở hướng dẫn
// đúng một lần. Chỉ lưu trên máy (localStorage), không ghi Firestore.
const KEY_PREFIX = "thien-phuong-admin-guide-seen:";

// true đúng một lần cho mỗi uid trên mỗi trình duyệt (và ghi nhớ ngay). Không đọc/ghi được storage
// (chế độ riêng tư, bị chặn) → false: thà không tự mở còn hơn mở lại mỗi lần đăng nhập.
export function claimFirstVisit(storage, uid) {
  if (!storage || !uid) return false;
  const key = `${KEY_PREFIX}${uid}`;
  try {
    if (storage.getItem(key) !== null) return false;
    storage.setItem(key, "1");
    return true;
  } catch {
    return false;
  }
}

// Chỉ truy cập `localStorage` đã có thể ném lỗi (cookie bị chặn): trả null thay vì làm hỏng đăng nhập.
export function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
