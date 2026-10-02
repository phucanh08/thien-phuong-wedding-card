// Nút X đóng LightGallery trên điện thoại. Bản mobile của thư viện tắt nút đóng (showCloseIcon:false)
// nên chỉ còn vuốt dọc để thoát; ở desktop thư viện đã có .lg-close thì không thêm gì.
// Thư viện không lộ instance ra ngoài, nên đóng bằng phím Esc mà nó đã lắng nghe sẵn trên window.
(function () {
    var X_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">'
        + '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';

    function pressEscape() {
        var e = new Event('keydown', { bubbles: true, cancelable: true });
        // Thư viện đọc e.keyCode; KeyboardEvent dựng tay không đặt được keyCode ở mọi trình duyệt
        Object.defineProperty(e, 'keyCode', { value: 27 });
        Object.defineProperty(e, 'key', { value: 'Escape' });
        window.dispatchEvent(e);
    }

    function addCloseButtons() {
        document.querySelectorAll('.lg-outer').forEach(function (outer) {
            if (outer.querySelector('.lg-close, .lb-close-x')) return;
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'lb-close-x';
            btn.setAttribute('aria-label', 'Đóng');
            btn.innerHTML = X_ICON;
            // Chạm nút không được thành vuốt/chạm ảnh của thư viện
            ['touchstart', 'touchmove', 'touchend', 'mousedown', 'mouseup'].forEach(function (type) {
                btn.addEventListener(type, function (e) { e.stopPropagation(); });
            });
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                pressEscape();
            });
            outer.classList.add('lb-has-close-x');
            outer.appendChild(btn);
        });
    }

    document.addEventListener('lgAfterOpen', addCloseButtons, true);
})();
