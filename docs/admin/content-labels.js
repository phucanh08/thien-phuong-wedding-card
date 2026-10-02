// Nhãn "hiện ở đâu" cho từng ô của trình sửa nội dung: V1, V2, "V1 · V2", hoặc công dụng nếu ô không
// hiện thành chữ trên thiệp. Bảng này khớp thiệp v1/v2 (docs/v1, docs/v2); đổi thiệp thì sửa bảng này.
// Hàm thuần (không đụng DOM) để test được bằng node.

const BOTH = "V1 · V2";

// Khoá = đường dẫn đã chuẩn hoá (chỉ số mảng và groom/bride của couple/donate thành "*"), khớp theo
// tiền tố dài nhất. Ô không có trong bảng là "V1 · V2".
const RULES = {
  "site.version": { tag: "chọn trang mở từ link gốc" },
  "meta": { tag: "tiêu đề tab / xem trước khi chia sẻ link" },
  "couple.*.fullName": { tag: "tiêu đề tab / xem trước khi chia sẻ link" },
  "couple.*.photo": { tag: "V1" },
  "couple.*.bio": { tag: "V1" },
  "couple.*.facebook": { tag: "V1" },
  "couple.*.address": { tag: BOTH },
  "wedding.lunarText": { tag: "V1" },
  "wedding.rsvpDeadline": { tag: "V2" },
  "wedding.envelopeImage": { tag: "V2" },
  "wedding.coverImages": { tag: "V2" },
  "wedding.thanksText": { tag: "V2" },
  "wedding.introText": { tag: "V2" },
  "wedding.invitationText": { tag: BOTH, note: "v2 dùng lời ngỏ khi “Câu dẫn” để trống" },
  "events.*.endISO": { tag: BOTH, note: "giờ hiện dạng “HH:mm – HH:mm” và dùng cho nút Thêm vào lịch" },
  "events.*.image": { tag: "V1" },
  "gallery.*.featured": { tag: "V1" },
  "gallery.*.featuredV2": { tag: "V2" },
};

export function normalizePath(path) {
  const parts = String(path).split(".");
  return parts.map((part, i) => {
    if (/^\d+$/.test(part)) return "*";
    if (i === 1 && (parts[0] === "couple" || parts[0] === "donate") && (part === "groom" || part === "bride")) return "*";
    return part;
  });
}

// { tag, note? } cho một data-path của trình sửa.
export function whereOf(path) {
  const parts = normalizePath(path);
  for (let n = parts.length; n > 0; n -= 1) {
    const rule = RULES[parts.slice(0, n).join(".")];
    if (rule) return rule;
  }
  return { tag: BOTH };
}
