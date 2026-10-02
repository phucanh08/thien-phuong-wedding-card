// Chọn ảnh album cho lưới (băng ảnh mục Album) và ảnh bìa "With you" của thiệp v2. Script thường, nạp
// trước card.js; hàm thuần (không đụng DOM) để test được bằng node (tests/unit/v2-gallery-grid.test.mjs).
(function (root) {
    'use strict';

    // Ảnh ở lưới: [{ item, index }], index là chỉ số trong album (lightbox mở toàn album theo chỉ số này).
    // Ảnh `featured`; không ảnh nào featured thì 6 ảnh đầu.
    function gridItems(gallery) {
        const featured = gallery.map((item, index) => ({ item, index })).filter(x => x.item.featured);
        return featured.length ? featured : gallery.slice(0, 6).map((item, index) => ({ item, index }));
    }

    // Ba ảnh bìa [lớn, nhỏ trái, nhỏ phải]: wedding.coverImages[i] nếu có, không thì lấy từ lưới
    // (ảnh lớn dùng bản large, hai ảnh nhỏ dùng bản small; lưới ít ảnh thì lặp ảnh đầu).
    function coverSources(gallery, coverImages) {
        const custom = Array.isArray(coverImages) ? coverImages.filter(u => typeof u === 'string' && u) : [];
        const grid = gridItems(gallery);
        return [0, 1, 2].map(i => {
            if (custom[i]) return custom[i];
            const entry = grid[i] || grid[0];
            return i === 0 ? entry.item.large : entry.item.small;
        });
    }

    root.v2GalleryGrid = { gridItems, coverSources };
})(window);
