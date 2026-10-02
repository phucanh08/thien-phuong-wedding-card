// Nhãn "dùng làm gì" cho từng ô của trình sửa nội dung: ô không hiện thành chữ trên thiệp có nhãn công
// dụng, vài ô có thêm ghi chú. Ô hiện trên thiệp như bình thường thì không có nhãn. Bảng này khớp thiệp
// (docs/v2); đổi thiệp thì sửa bảng này. Hàm thuần (không đụng DOM) để test được bằng node.

const SHARE = "tiêu đề tab / xem trước khi chia sẻ link";

// Khoá = đường dẫn đã chuẩn hoá (chỉ số mảng và groom/bride của couple/donate thành "*"), khớp theo
// tiền tố dài nhất. Ô không có trong bảng: {} (không nhãn).
const RULES = {
  "meta": { tag: SHARE },
  "couple.*.fullName": { tag: SHARE },
  "wedding.invitationText": { note: "cũng hiện ở chỗ câu dẫn khi “Câu dẫn” để trống" },
  "events.*.endISO": { note: "giờ hiện dạng “HH:mm – HH:mm” và dùng cho nút Thêm vào lịch" },
};

export function normalizePath(path) {
  const parts = String(path).split(".");
  return parts.map((part, i) => {
    if (/^\d+$/.test(part)) return "*";
    if (i === 1 && (parts[0] === "couple" || parts[0] === "donate") && (part === "groom" || part === "bride")) return "*";
    return part;
  });
}

// { tag?, note? } cho một data-path của trình sửa.
export function whereOf(path) {
  const parts = normalizePath(path);
  for (let n = parts.length; n > 0; n -= 1) {
    const rule = RULES[parts.slice(0, n).join(".")];
    if (rule) return rule;
  }
  return {};
}
