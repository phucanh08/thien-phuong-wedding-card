// Chặn phóng cả trang (chụm hai ngón, chạm đúp): trang nào nạp file này thì chỉ ảnh phóng được,
// qua pinch-zoom.js. Nạp sớm trong <head>, cùng meta viewport "maximum-scale=1,user-scalable=no".
// - Chrome/Android và webview tôn trọng giới hạn viewport: meta viewport là đủ.
// - Safari iOS bỏ qua user-scalable=no: touch-action không có pinch-zoom trên <html> (WebKit từ iOS 13)
//   bỏ chụm và chạm đúp phóng trang; gesturestart/gesturechange (chỉ WebKit có) chặn thêm phần còn lại.
// Sự kiện chạm vẫn tới JS như thường (touch-action chỉ bỏ hành vi mặc định của trình duyệt), nên
// pinch-zoom.js vẫn nhận cử chỉ chụm trên ảnh; cuộn dọc/ngang vẫn để trình duyệt xử lý.
(function () {
    document.documentElement.style.touchAction = 'pan-x pan-y';

    function block(e) { e.preventDefault(); }
    document.addEventListener('gesturestart', block, { passive: false });
    document.addEventListener('gesturechange', block, { passive: false });
})();
