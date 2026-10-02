// Chụm hai ngón lên một ảnh của thiệp → riêng ảnh đó phóng theo ngón tay, nổi trên nền tối;
// buông tay → ảnh trượt về đúng chỗ cũ (kiểu Instagram). Không giữ zoom: muốn xem lâu thì chạm ảnh
// album mở LightGallery như cũ.
// - Một ngón: không chặn gì (cuộn trang, chạm mở lightbox như cũ).
// - Hai ngón mà không ngón nào chạm ảnh: không chặn, trình duyệt phóng cả trang như bình thường.
// - Ảnh gốc giữ nguyên trong layout (chỉ ẩn đi); thứ phóng to là bản sao position:fixed gắn vào body,
//   nên transform của AOS hay overflow:hidden của khung ảnh không cắt được nó.
// - Trong LightGallery: hai ngón trên ảnh đang xem cũng dùng cách trên thay cho zoom của lg-zoom
//   (zoom đó không theo ngón tay và giữ ảnh phóng sau khi buông, làm vuốt chuyển ảnh thành kéo ảnh).
//   Một ngón (vuốt chuyển ảnh, vuốt dọc đóng, chạm) vẫn để LightGallery xử lý.
// Ảnh nhận cử chỉ: chọn theo class của v1, hoặc ảnh có thuộc tính data-pinch-zoom (v2). File gắn vào ảnh có sẵn
// lúc nó chạy, nên trang nạp file này sau khi đã vẽ ảnh.
(function () {
    var TARGETS = '.main_image img, .member-image img, #photoGalleryContainer img, '
        + '.timeline-card .img-holder img, .event-item .image-wrap, [data-pinch-zoom]';
    var MAX_SCALE = 4;
    var RETURN_MS = 300;

    var tracking = null;   // ảnh dưới ngón đầu tiên, giữ tới khi nhấc hết ngón
    var inLightbox = false; // cử chỉ bắt đầu trong LightGallery
    var swallow = false;   // cử chỉ trong LightGallery đã thành chụm: giấu sự kiện chạm khỏi thư viện
    var session = null;    // cử chỉ chụm đang chạy
    var returning = null;  // bản sao đang trượt về chỗ cũ
    var suppressClickUntil = 0;

    function distance(a, b) { return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
    function midpoint(a, b) { return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }; }
    function findTouch(list, id) {
        for (var i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
        return null;
    }
    function cancel(e) { if (e.cancelable) e.preventDefault(); }

    // Bo góc thường nằm ở khung bao ngoài (.main_image, .img-holder) chứ không ở chính ảnh
    function cornerRadius(el) {
        for (var node = el, i = 0; node && i < 3; node = node.parentElement, i++) {
            var r = getComputedStyle(node).borderRadius;
            if (r && parseFloat(r) > 0) return r;
        }
        return '';
    }

    function makeClone(el, rect) {
        var cs = getComputedStyle(el);
        var clone;
        if (el.tagName === 'IMG') {
            clone = document.createElement('img');
            clone.src = el.currentSrc || el.src;
            clone.alt = '';
            clone.style.objectFit = cs.objectFit;
            clone.style.objectPosition = cs.objectPosition;
        } else {
            // Ảnh sự kiện là background-image của .image-wrap
            clone = document.createElement('div');
            clone.style.backgroundImage = cs.backgroundImage;
            clone.style.backgroundSize = cs.backgroundSize;
            clone.style.backgroundPosition = cs.backgroundPosition;
            clone.style.backgroundRepeat = cs.backgroundRepeat;
            clone.style.backgroundColor = cs.backgroundColor;
        }
        clone.className = 'pz-clone';
        clone.setAttribute('aria-hidden', 'true');
        clone.style.left = rect.left + 'px';
        clone.style.top = rect.top + 'px';
        clone.style.width = rect.width + 'px';
        clone.style.height = rect.height + 'px';
        clone.style.borderRadius = cornerRadius(el);
        return clone;
    }

    function finishReturn() {
        if (!returning) return;
        clearTimeout(returning.timer);
        returning.clone.remove();
        returning.backdrop.remove();
        returning.el.classList.remove('pz-hidden');
        returning = null;
    }

    function begin(el, a, b) {
        finishReturn();
        var rect = el.getBoundingClientRect();
        var d0 = distance(a, b);
        if (!rect.width || !rect.height || !d0) return;
        var backdrop = document.createElement('div');
        backdrop.className = 'pz-backdrop';
        var clone = makeClone(el, rect);
        document.body.appendChild(backdrop);
        document.body.appendChild(clone);
        el.classList.add('pz-hidden');
        if (inLightbox) swallow = true;
        session = { el: el, clone: clone, backdrop: backdrop, rect: rect,
            ids: [a.identifier, b.identifier], d0: d0, p0: midpoint(a, b), moved: false };
    }

    function update(a, b) {
        var s = Math.min(MAX_SCALE, Math.max(1, distance(a, b) / session.d0));
        var p = midpoint(a, b), r = session.rect, p0 = session.p0;
        // Điểm ảnh nằm dưới tâm hai ngón lúc bắt đầu luôn đi theo tâm hai ngón hiện tại
        var tx = p.x - r.left - s * (p0.x - r.left);
        var ty = p.y - r.top - s * (p0.y - r.top);
        session.clone.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0) scale(' + s + ')';
        session.backdrop.style.opacity = Math.min(1, s - 1);
        session.moved = true;
    }

    function end() {
        var sess = session;
        session = null;
        if (sess.moved) suppressClickUntil = Date.now() + 500;
        // Trượt về chỗ ảnh gốc đang đứng lúc buông (phòng khi trang đã cuộn trong lúc chụm)
        var now = sess.el.getBoundingClientRect(), r = sess.rect;
        sess.clone.classList.add('pz-returning');
        sess.backdrop.classList.add('pz-returning');
        sess.clone.style.transform = 'translate3d(' + (now.left - r.left) + 'px,' + (now.top - r.top) + 'px,0) scale('
            + (now.width / r.width) + ')';
        sess.backdrop.style.opacity = 0;
        returning = sess;
        sess.timer = setTimeout(finishReturn, RETURN_MS + 50);
        sess.clone.addEventListener('transitionend', finishReturn, { once: true });
    }

    // Listener của LightGallery nằm trên phần tử của nó; chặn ở capture trên document thì nó không
    // thấy cử chỉ chụm (lg-zoom không bắt đầu, vuốt không chạy theo ngón còn lại). Riêng touchend
    // nhấc ngón cuối vẫn cho qua để thư viện tự dọn trạng thái vuốt của ngón đầu.
    function hide(e) { if (swallow) e.stopPropagation(); }

    function onStart(e) {
        if (session) { cancel(e); hide(e); return; }
        if (tracking && e.touches.length === 2) {
            cancel(e);
            begin(tracking, e.touches[0], e.touches[1]);
        }
        hide(e);
    }

    function onTargetStart(e) {
        if (!tracking) {
            tracking = e.currentTarget;
            listenDocument(true);
        }
        onStart(e);
    }

    function onMove(e) {
        hide(e);
        if (!session) return;
        cancel(e);
        var a = findTouch(e.touches, session.ids[0]), b = findTouch(e.touches, session.ids[1]);
        if (a && b) update(a, b);
    }

    function onEnd(e) {
        if (session && !(findTouch(e.touches, session.ids[0]) && findTouch(e.touches, session.ids[1]))) end();
        if (!e.touches.length) {
            tracking = null;
            inLightbox = swallow = false;
            listenDocument(false);
        } else hide(e);
    }

    // Ngón đầu đặt trong lightbox: ảnh đang xem là ảnh được chụm. Gắn ở capture của .lg-container
    // để chạy trước listener của thư viện trên .lg-outer.
    function onLightboxStart(e) {
        if (tracking) return;
        var img = e.currentTarget.querySelector('.lg-current .lg-image');
        if (!img || !img.complete) return;
        tracking = img;
        inLightbox = true;
        listenDocument(true);
        onStart(e);
    }

    function bindLightbox() {
        document.querySelectorAll('.lg-container').forEach(function (box) {
            if (box.pzBound) return;
            box.pzBound = true;
            box.addEventListener('touchstart', onLightboxStart, { capture: true, passive: false });
        });
    }

    // iOS/WebKit phóng cả trang qua gesture event riêng; chặn khi cử chỉ đã thuộc về một ảnh
    function onGesture(e) { if (tracking) e.preventDefault(); }

    // Listener không-passive trên document chỉ gắn trong lúc có ngón đặt trên ảnh, để lúc khác
    // cuộn trang không phải chờ JS. Capture: ngón thứ hai đặt ở đâu cũng bắt được.
    function listenDocument(on) {
        var method = on ? 'addEventListener' : 'removeEventListener';
        var opts = { capture: true, passive: false };
        document[method]('touchstart', onStart, opts);
        document[method]('touchmove', onMove, opts);
        document[method]('touchend', onEnd, opts);
        document[method]('touchcancel', onEnd, opts);
        document[method]('gesturestart', onGesture, opts);
        document[method]('gesturechange', onGesture, opts);
    }

    // Cử chỉ chụm không được biến thành cú chạm mở LightGallery
    window.addEventListener('click', function (e) {
        if (Date.now() < suppressClickUntil) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);

    function bind() {
        document.querySelectorAll(TARGETS).forEach(function (el) {
            el.addEventListener('touchstart', onTargetStart, { passive: false });
        });
    }

    // LightGallery dựng .lg-container lúc mở lần đầu (ảnh QR thì dựng mới mỗi lần)
    document.addEventListener('lgAfterOpen', bindLightbox, true);

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
    else bind();
})();
