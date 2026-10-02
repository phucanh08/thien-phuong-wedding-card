# CLAUDE.md

Web thiệp cưới di động (tiếng Việt) của **Thiện & Phương**. Port từ mẫu
`https://github.com/phucanh08/wedding-card` (thiệp Phúc Anh & Ngọc, giao diện template135).

## Chạy local

Web tĩnh, không build. Gốc site là `docs/` (nguồn GitHub Pages).

```bash
/usr/bin/python3 -m http.server 8080 --directory docs
```

Máy dev là Apple Silicon không có Rosetta: `node`, `npx`, `gh`, python của pyenv đều là bản x86_64
và báo "bad CPU type". Dùng `/usr/bin/python3`, `/usr/bin/ruby`, `sips`, `git`, `curl`.

## Cấu trúc đích

- `docs/index.html` — trang duy nhất, **không minify** (dễ sửa).
- `docs/wedding-data.js` — **nguồn nội dung duy nhất**: tên, gia đình, sự kiện, ngân hàng, album,
  chuyện tình, nhạc. Markup đọc từ đây; không hard-code nội dung trong `index.html`.
- `docs/firebase-config.js` — cấu hình Firestore (`guests`, `rsvp`, `wishes`).
- `docs/assets/` — ảnh `.webp`/placeholder, nhạc.

## Boundary — phải có ruling trước khi đổi

1. **Firebase thật**: không dùng project `wedding-card-cdcce` của mẫu. Project mới do Human tạo;
   chưa có config thật thì RSVP/lời chúc phải tắt nhẹ nhàng (không lỗi console chặn trang).
   Không tạo/sửa project Firebase, không deploy `firestore.rules` khi chưa có lệnh Human.
2. **Schema dữ liệu**: shape của `wedding-data.js` và các collection Firestore là contract giữa
   markup và dữ liệu — đổi shape cần ruling của Lead.
3. **Không còn nội dung của mẫu**: không chữ, ảnh, QR, tên miền (`CNAME`), nhạc riêng của
   Phúc Anh–Ngọc. Nội dung Thiện–Phương chưa có → placeholder đánh dấu `TODO`.
4. **External side effect** (push, GitHub Pages, tên miền, Firebase): chỉ Lead/Human làm,
   writer không làm.
5. **Hợp đồng dữ liệu Firestore** (project `thien-phuong-wedding-1025`, `(default)`,
   `asia-southeast1`). Thiệp (`docs/index.html`), trang quản lý (`docs/admin/`) và
   `firestore.rules` cùng tuân theo; đổi tên collection/field/quyền cần ruling của Lead + Human.

   | Collection | Doc id | Field |
   |---|---|---|
   | `guests` | `code`: 8 ký tự `[a-z2-9]` ngẫu nhiên, dùng trong link `?code=` | `name` string (tên hiện trên thiệp), `salutation` string? (vd "Anh", "Cô chú"), `side` `"groom"\|"bride"`, `group` string, `phone` string?, `invitedEvents` string[] (key event trong `wedding-data.js`), `expectedCount` int ≥ 1, `note` string?, `createdAt`/`updatedAt` timestamp, `createdBy` email |
   | `rsvp` | `code` của khách; khách không có code → auto id | `code` string\|null, `name` string (bắt buộc khi `code` null), `attending` `"yes"\|"no"\|"maybe"`, `count` int 0–20, `events` string[], `note` string? ≤ 500, `updatedAt` timestamp |
   | `wishes` | auto id | `name` string ≤ 60, `message` string ≤ 500, `code` string\|null, `createdAt` timestamp |
   | `accessRequests` | `uid` Firebase Auth | `email`, `displayName`, `status` `"pending"\|"approved"\|"rejected"`, `requestedAt`, `decidedAt`?, `decidedBy`? |

   Quyền:
   - **Super admin**: `request.auth.token.email == "phucanhdn01@gmail.com"` và `email_verified`.
   - **Admin**: super admin, hoặc `accessRequests/{uid}.status == "approved"`. Admin đọc/ghi mọi
     collection (kể cả xoá lời chúc, duyệt/từ chối yêu cầu).
   - **Người đăng nhập chưa được duyệt**: chỉ tạo/đọc `accessRequests/{uid}` của chính mình với
     `status: "pending"`; không tự đổi `status`; không đọc dữ liệu khác.
   - **Khách (không đăng nhập)**: `get` một `guests/{code}` (không `list`); tạo/sửa `rsvp/{code}`
     khi `guests/{code}` tồn tại, tạo `rsvp/{autoId}` khi `code == null` và có `name`; đọc và tạo
     `wishes` (không sửa/xoá); field validate đúng kiểu và độ dài như bảng.
   - Link `?code=` không tồn tại hoặc không có: thiệp chào chung, **không** tự tạo `guests`.
   - Số mâm = làm tròn lên (tổng `count` của RSVP `attending == "yes"` có event đó) / 10.
