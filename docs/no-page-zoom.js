// Chặn phóng cả trang (chụm hai ngón, chạm đúp): trang nào nạp file này thì chỉ ảnh phóng được,
// qua pinch-zoom.js. Nạp sớm trong <head>, cùng meta viewport "maximum-scale=1,user-scalable=no".
// - Chrome/Android và webview tôn trọng giới hạn viewport: meta viewport là đủ.
// - Safari iOS bỏ qua user-scalable=no: touch-action không có pinch-zoom trên <html> (WebKit từ iOS 13)
//   bỏ chụm và chạm đúp phóng trang; gesturestart/gesturechange (chỉ WebKit có) chặn thêm phần còn lại.
// Sự kiện chạm vẫn tới JS như thường (touch-action chỉ bỏ hành vi mặc định của trình duyệt), nên
// pinch-zoom.js vẫn nhận cử chỉ chụm trên ảnh; cuộn dọc/ngang vẫn để trình duyệt xử lý.
//
// Chỗ hở không chặn được từ trang (đo trên Safari iOS 26.5 Simulator, 2026-10-03): ngón đặt thêm khi trang
// ĐANG cuộn (vuốt 3–5 ngón đặt lệch nhau, hay chụm lúc trang còn trôi sau cú hất) thì WebKit gửi sự kiện
// chạm không cancelable (hoặc không gửi ngón đó tới trang) và không xét touch-action, nên trang vẫn bị phóng
// và giữ nguyên. Khi đó (scale > 1) thôi chặn, để chụm hai ngón như thường là thu trang về cỡ cũ; về
// scale 1 thì chặn lại. Không có cách nào từ JS tự đưa trang về scale 1 trên Safari (đổi meta viewport
// không tác dụng vì Safari bỏ qua maximum-scale).
(function () {
    var root = document.documentElement;
    var vv = window.visualViewport;

    function zoomed() { return !!vv && vv.scale > 1.01; }
    function sync() { root.style.touchAction = zoomed() ? '' : 'pan-x pan-y'; }
    function block(e) { if (!zoomed()) e.preventDefault(); }

    sync();
    if (vv) vv.addEventListener('resize', sync);
    document.addEventListener('gesturestart', block, { passive: false });
    document.addEventListener('gesturechange', block, { passive: false });
})();
