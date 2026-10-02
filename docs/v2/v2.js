// Phần cần module của thiệp v2: bản xuất bản (content-loader.js) và Firestore (firebase-config.js), nối vào
// v2/card.js. import() động thay vì import tĩnh: một module tải lỗi thì vào nhánh lỗi ngay, card.js vẽ bằng
// wedding-data.js; còn chính file này không chạy được thì card.js tự nhận ra (xem "Khởi động" ở đó).
window.v2Card.connect({
    content: import('../content-loader.js').then(({ loadWeddingContent }) => loadWeddingContent()),
    firestore: import('../firebase-config.js')
});
