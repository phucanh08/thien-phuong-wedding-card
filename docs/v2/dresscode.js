// Gom hàng Dresscode của thiệp v2. Script thường, nạp trước card.js; hàm thuần (không đụng DOM) để test
// được bằng node (tests/unit/v2-dresscode.test.mjs).
(function (root) {
    'use strict';

    const COLOR = /^#[0-9a-f]{3,8}$/i;

    // events: các lễ theo thứ tự Timeline. Trả [{ title, colors }]: mã màu sai bị bỏ, lễ không còn màu nào
    // thì không có hàng. Mọi lễ còn lại cùng một bộ màu (cùng màu, cùng thứ tự, không phân biệt hoa thường)
    // -> một hàng duy nhất, title = null (như mẫu: một hàng chấm màu, không ghi tên lễ); khác nhau thì
    // mỗi lễ một hàng kèm tên lễ.
    function dressRows(events) {
        const rows = events
            .map(event => ({
                title: event.title,
                colors: Array.isArray(event.dressCode)
                    ? event.dressCode.filter(color => typeof color === 'string' && COLOR.test(color))
                    : []
            }))
            .filter(row => row.colors.length);
        if (!rows.length) return [];
        const key = row => row.colors.map(color => color.toLowerCase()).join(',');
        return rows.every(row => key(row) === key(rows[0])) ? [{ title: null, colors: rows[0].colors }] : rows;
    }

    root.v2Dresscode = { dressRows };
})(window);
