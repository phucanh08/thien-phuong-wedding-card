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
