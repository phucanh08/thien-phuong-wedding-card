# CLAUDE.md

Web thiệp cưới di động (tiếng Việt) của **Thiện & Phương**. Port từ mẫu
`https://github.com/phucanh08/wedding-card` (thiệp Phúc Anh & Ngọc). Từ 2026-10-02 chỉ còn một giao diện:
v2, theo mẫu "Nhà Có Hỷ" (`https://vowry.me/template/nha-co-hy/demo/`).

## Chạy local

Web tĩnh, không build. Gốc site là `docs/` (nguồn GitHub Pages, nhánh `feat/thien-phuong-card`).
Tên miền: `https://thien-phuong-weddingcard.anhlp.com` (`docs/CNAME`, DNS Cloudflare chỉ DNS; Human tạo
2026-10-02); `phucanh08.github.io/thien-phuong-wedding-card/…` chuyển 301 sang tên miền, giữ path/query.

```bash
/usr/bin/python3 -m http.server 8080 --directory docs
```

Chạy thiệp (`/`) và trang quản lý (`/admin/`) với Firebase emulator (Auth 9199, Firestore 8282, rules
thật từ `firestore.rules`), một lệnh sau `npm ci`:

```bash
npm run dev            # web ở :8080 (đổi bằng PORT=8162), emulator project demo-thien-phuong
```

Ở localhost/127.0.0.1 thiệp và admin tự nối emulator, không chạm Firebase thật. Firebase web config và
port emulator chỉ khai ở `docs/firebase-shared.js` (port phải khớp `firebase.json`).

Kiểm tra:

```bash
npm test               # rules Firestore trên emulator (cổng 8282)
npm run test:unit      # unit test trang quản lý (node --test, không cần emulator)
```

Máy dev là Apple Silicon **đã cài Rosetta** (2026-10-02): `node`, `npx`, `firebase`, `wrangler`, `gh` là
bản x86_64 và chạy bình thường. Phục vụ web tĩnh vẫn dùng `/usr/bin/python3`.

## Cấu trúc đích

- `docs/index.html` — thiệp duy nhất (mẫu "Nhà Có Hỷ"), **không minify**, mở thẳng ở `/` và
  `/?code=`; lấy nội dung qua `docs/content-loader.js`. Có `<meta name="robots" content="noindex,
  nofollow">` (thiệp riêng tư, Human 2026-10-02) — không bỏ.
- `docs/v2/` — script/CSS/ảnh của thiệp (`card.js`, `v2.js`, `v2.css`, `dresscode.js`,
  `gallery-grid.js`, `assets/`). `docs/v2/index.html` và `docs/v1/index.html` chỉ còn là trang chuyển
  hướng về `/` cho link cũ, giữ `?code=` và `#hash`.
- Trang quản lý xem trước thiệp bằng cách tải `docs/index.html` và chèn `<base>` trỏ gốc site
  (`docs/admin/content-preview.js`).
- `docs/wedding-data.js` — nội dung dự phòng (C6): tên, gia đình, sự kiện, ngân hàng, album,
  chuyện tình, nhạc. Markup đọc từ dữ liệu; không hard-code nội dung trong HTML.
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
   | `accessRequests` | `uid` Firebase Auth | `email`, `displayName`, `provider` `"google"\|"password"`, `username` string? (chỉ tài khoản mật khẩu), `status` `"pending"\|"approved"\|"rejected"`, `mustChangePassword` bool, `requestedAt`, `decidedAt`?, `decidedBy`? |

   Đăng nhập trang quản lý **chỉ bằng tên đăng nhập + mật khẩu** (Human 2026-10-02: bỏ Google; Auth
   provider Google đã tắt, Email/Password bật). Trang quản lý không còn nút Google, không tự tạo
   `accessRequests`; người đăng nhập không có doc `approved` (và không phải super admin) → màn "chưa có
   quyền", không đọc dữ liệu. `firestore.rules` **không đổi** theo việc này: giá trị `"google"`,
   `"pending"` và quyền tự tạo doc `pending` vẫn còn ở tầng rules (không còn client nào dùng).
   - **Tên đăng nhập + mật khẩu**: người dùng gõ `username` (`[a-z0-9._-]{3,30}`); app đổi thành
     email ngầm `<username>@thien-phuong-wedding.local`. Admin tạo tài khoản cho người khác ngay
     trong trang quản lý (tạo user Auth bằng một Firebase app phụ để không đăng xuất admin) và
     ghi `accessRequests/{uid}` với `provider: "password"`, `status: "approved"`,
     `mustChangePassword: true`.
   - Tài khoản mặc định `admin` (email ngầm `admin@thien-phuong-wedding.local`) do Lead tạo trực
     tiếp trên Firebase; **mật khẩu không bao giờ nằm trong repo/code/log**.
   - `mustChangePassword == true` (hoặc super admin mật khẩu chưa có doc) → trang quản lý chặn mọi
     màn hình cho tới khi đổi mật khẩu; đổi xong người dùng chỉ được tự sửa field
     `mustChangePassword` của chính mình từ `true` → `false`.

   Quyền:
   - **Super admin**: (`request.auth.token.email == "phucanhdn01@gmail.com"` và `email_verified`)
     hoặc `request.auth.token.email == "admin@thien-phuong-wedding.local"`.
   - **Admin**: super admin, hoặc `accessRequests/{uid}.status == "approved"`. Admin đọc/ghi mọi
     collection (kể cả xoá lời chúc, duyệt/từ chối yêu cầu).
   - **Người đăng nhập chưa được duyệt**: chỉ tạo/đọc `accessRequests/{uid}` của chính mình với
     `status: "pending"`; không tự đổi `status`; không đọc dữ liệu khác.
   - **Khách (không đăng nhập)**: `get` một `guests/{code}` (không `list`); tạo/sửa `rsvp/{code}`
     khi `guests/{code}` tồn tại, tạo `rsvp/{autoId}` khi `code == null` và có `name`; đọc và tạo
     `wishes` (không sửa/xoá); field validate đúng kiểu và độ dài như bảng.
   - Quyền "khách" áp dụng cho **mọi** request (đăng nhập hay không) — người đăng nhập chưa duyệt
     vẫn mở thiệp, gửi RSVP/lời chúc như khách, chỉ không có thêm quyền admin.
   - Timestamp do khách ghi (`rsvp.updatedAt`, `wishes.createdAt`) phải `== request.time`
     (client dùng `serverTimestamp()`); `wishes.name`/`message` không rỗng.
   - `guests` (do trang quản lý tự kiểm, rules không kiểm): `name` 1–60 ký tự sau khi bỏ ký tự
     vô hình, `salutation` ≤ 30, `group` ≤ 60, `phone` ≤ 20, `note` ≤ 500, `expectedCount` số
     nguyên an toàn 1–20 (lưu kiểu integer).
   - `rsvp.name` ≤ 60; `rsvp.events` list ≤ 10 phần tử, mỗi phần tử string ≤ 50;
     `accessRequests.displayName` string hoặc null.
   - `mustChangePassword` là chốt chặn **giao diện**, không phải ranh giới bảo mật (rules không
     kiểm được việc đổi mật khẩu); tài khoản `approved` có quyền admin ngay ở tầng rules.
   - Admin ghi không bị validate shape ở rules (admin là người tin cậy); quyền admin chỉ trên 4
     collection trên, không có catch-all.
   - Link `?code=` không tồn tại hoặc không có: thiệp chào chung, **không** tự tạo `guests`.
   - Số mâm = làm tròn lên (tổng `count` của RSVP `attending == "yes"` có event đó) / 10.
6. **Hợp đồng nội dung thiệp (CMS)** — nội dung ở Firestore (project C5, gói Spark), ảnh/nhạc ở
   **Cloudflare R2** qua một Cloudflare Worker (Human chọn 2026-10-02 thay Firebase Storage).
   - `siteContent/published` và `siteContent/draft`: `{ data, updatedAt, updatedBy }`; `data` có
     **đúng shape `window.WEDDING_DATA`** (C2, kể cả field tuỳ chọn đã thêm như `featured`,
     `note`, `dressCode`). `siteContentHistory/{autoId}`: bản `published` cũ mỗi lần xuất bản
     (`{ data, publishedAt, publishedBy }`), dùng để khôi phục.
   - `events[].key` **không được sửa** từ trang quản lý (khách tham chiếu qua `invitedEvents`);
     thêm/xoá sự kiện cần ruling Lead.
   - Ảnh/nhạc tải lên: R2 key `content/<uuid>-large.webp`, `content/<uuid>-small.webp`, nhạc
     `content/<uuid>.<mp3|m4a>`; `data` lưu URL công khai do Worker phục vụ
     (`<worker-url>/content/<key>`). Đường dẫn tương đối cũ (`assets/...`) vẫn hợp lệ.
   - Worker: `GET /content/<key>` công khai (cache dài, đúng Content-Type); `PUT /content/<key>`
     và `DELETE /content/<key>` chỉ khi header `Authorization: Bearer <Firebase ID token>` hợp lệ
     (chữ ký Google, `aud`/`iss` = project `thien-phuong-wedding-1025`, chưa hết hạn) **và**
     người đó là admin theo C5 (super admin theo email, hoặc `accessRequests/{uid}.status ==
     "approved"` đọc qua Firestore REST bằng chính token đó); key phải dưới `content/`, đúng loại
     và kích thước; CORS chỉ cho origin của site: `https://thien-phuong-weddingcard.anhlp.com`,
     `https://phucanh08.github.io`, `http://localhost`/`127.0.0.1` (mọi cổng) — `ALLOWED_ORIGIN` trong
     `worker/src/index.ts`; đổi tên miền thì sửa + deploy Worker và thêm authorized domain Firebase Auth.
   - Ảnh: cắt theo tỉ lệ ô (admin kéo chỉnh được), bản lớn cạnh dài ≤ 1600px, bản nhỏ ≤ 600px,
     WebP; mỗi file ảnh ≤ 2 MB, nhạc ≤ 10 MB.
   - Quyền Firestore: ai cũng `get` `siteContent/published`; chỉ admin (C5) đọc/ghi
     `siteContent/draft`, ghi `published`, đọc/ghi `siteContentHistory`. Quyền ghi R2 do Worker
     thực thi như trên.
   - Ràng buộc doc nội dung: `data` là map; `updatedAt`/`publishedAt` kiểu timestamp;
     `siteContent/published` **không được xoá** (muốn quay lại thì khôi phục từ lịch sử);
     `siteContentHistory` chỉ thêm mới, không sửa (xoá được bởi admin). Khi xuất bản, bản
     `published` cũ được chép sang lịch sử với `publishedBy` = **admin đang xuất bản bản mới**
     (người tạo bản sao lưu), `publishedAt` = `updatedAt` cũ của bản đó.
   - Bản xuất bản **hợp lệ** khi `data` có: `couple.groom.shortName`, `couple.bride.shortName`,
     `wedding.dateISO`, và mỗi phần tử `events` có `key`, `title`, `startISO`. Mảng (`events`,
     `story`, `gallery`) được rỗng; object/field khác thiếu → dùng mặc định, **không** coi là hỏng.
     Trình sửa nội dung phải kiểm đúng danh sách này trước khi cho xuất bản.
   - URL trong `data` (ảnh, `mapUrl`, `facebook`, nhạc) chỉ `https:`/`http:` hoặc đường dẫn tương
     đối; `dressCode` chỉ mã màu `#rgb`/`#rrggbb`. Thiệp bỏ qua giá trị sai thay vì hiển thị.
   - Thiệp: dùng `published.data` nếu đọc được trong thời gian chờ ngắn; không được → bản
     `published.data` gần nhất đã lưu trên máy khách (localStorage, theo `updateTime`, bản cũ
     không đè bản mới, qua cùng kiểm hợp lệ/normalize; Human duyệt 2026-10-02); chưa có bản lưu →
     `docs/wedding-data.js` (dự phòng, vẫn giữ trong repo). Mỗi lần vẽ đúng một nguồn
     (`source`: `published` | `cached` | `fallback`), mỗi lượt mở đọc `published` một lần, chờ tối đa
     `TIMEOUT_MS` (2500 ms). Xuất bản đầu tiên = nội dung `wedding-data.js` hiện tại.
   - Chỉ còn một thiệp (Human chọn 2026-10-02), nằm ở gốc site: `/` và `/?code=` vẽ thiệp trực tiếp (URL
     không có `/v2`); link cũ `/v2/…`, `/v1/…` chuyển về `/…`, giữ `?code=`/`#hash`. Field cũ
     `site.version` còn trong data nhưng bị bỏ qua.
   - Field chỉ thiệp v1 cũ dùng (`couple.*.photo`, `couple.*.bio`, `couple.*.facebook`,
     `wedding.lunarText`, `events[].image`, `gallery[].featured`) giữ nguyên trong data. Trang quản lý
     không hiện, không sửa các field này.
   - Album (Human chọn 2026-10-02): một album chung `gallery`. Ô "Hiện ở Album" của trang quản lý ghi
     `featuredV2: true` cho đúng các ảnh hiện ở băng ảnh Album, luôn ≥ 1 ảnh. Không ảnh nào
     `featuredV2` (data cũ) → ảnh `featured: true`; không có → 6 ảnh đầu. Ảnh bìa thiếu
     `wedding.coverImages` → lấy từ băng ảnh Album. "Tất cả hình ảnh"/xem ảnh lớn mở cả album theo
     thứ tự album.
