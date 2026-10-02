// Chọn ảnh album cho lưới (băng ảnh mục Album) và ảnh bìa "With you" của thiệp v2. Script thường, nạp
// trước card.js; hàm thuần (không đụng DOM) để test được bằng node (tests/unit/v2-gallery-grid.test.mjs).
(function (root) {
    'use strict';

    // Ảnh ở lưới v2: [{ item, index }], index là chỉ số trong album (lightbox mở toàn album theo chỉ số
    // này). Ảnh `featuredV2` (ô "Lưới v2" của trang quản lý); chưa ảnh nào có thì như lưới v1 (v1/index.html):
    // ảnh `featured`, không có thì 6 ảnh đầu. Dữ liệu cũ không có featuredV2 vì vậy hiện như trước.
    function gridItems(gallery) {
        const entries = gallery.map((item, index) => ({ item, index }));
        const chosenV2 = entries.filter(x => x.item.featuredV2 === true);
        if (chosenV2.length) return chosenV2;
        const featured = entries.filter(x => x.item.featured);
        return featured.length ? featured : entries.slice(0, 6);
    }

    // Ba ảnh bìa [lớn, nhỏ trái, nhỏ phải]: wedding.coverImages[i] nếu có, không thì lấy từ lưới v2
    // (ảnh lớn dùng bản large, hai ảnh nhỏ dùng bản small; lưới ít ảnh thì lặp ảnh đầu). Album rỗng
    // (C6 cho phép) mà ô không có coverImages -> '' (ô để trống).
    function coverSources(gallery, coverImages) {
        const custom = Array.isArray(coverImages) ? coverImages.filter(u => typeof u === 'string' && u) : [];
        const grid = gridItems(gallery);
        return [0, 1, 2].map(i => {
            if (custom[i]) return custom[i];
            const entry = grid[i] || grid[0];
            if (!entry) return '';
            return i === 0 ? entry.item.large : entry.item.small;
        });
    }

    root.v2GalleryGrid = { gridItems, coverSources };
})(window);
