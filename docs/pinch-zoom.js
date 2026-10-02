// Chụm hai ngón lên một ảnh của thiệp → riêng ảnh đó phóng theo ngón tay, nổi trên nền tối;
// buông tay → ảnh trượt về đúng chỗ cũ (kiểu Instagram). Không giữ zoom: muốn xem lâu thì chạm ảnh
// album mở LightGallery như cũ.
// - Một ngón: không chặn gì (cuộn trang, chạm mở lightbox như cũ).
// - Hai ngón mà không ngón nào chạm ảnh: không chặn, trình duyệt phóng cả trang như bình thường.
// - Ảnh gốc giữ nguyên trong layout (chỉ ẩn đi); thứ phóng to là bản sao position:fixed gắn vào body,
//   nên transform của AOS hay overflow:hidden của khung ảnh không cắt được nó.
(function () {
    var TARGETS = '.main_image img, .member-image img, #photoGalleryContainer img, '
        + '.timeline-card .img-holder img, .event-item .image-wrap';
    var MAX_SCALE = 4;
    var RETURN_MS = 300;

    var tracking = null;   // ảnh dưới ngón đầu tiên, giữ tới khi nhấc hết ngón
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

    function onStart(e) {
        if (session) { cancel(e); return; }
        if (tracking && e.touches.length === 2) {
            cancel(e);
            begin(tracking, e.touches[0], e.touches[1]);
        }
    }

    function onTargetStart(e) {
        if (!tracking) {
            tracking = e.currentTarget;
            listenDocument(true);
        }
        onStart(e);
    }

    function onMove(e) {
        if (!session) return;
        cancel(e);
        var a = findTouch(e.touches, session.ids[0]), b = findTouch(e.touches, session.ids[1]);
        if (a && b) update(a, b);
    }

    function onEnd(e) {
        if (session && !(findTouch(e.touches, session.ids[0]) && findTouch(e.touches, session.ids[1]))) end();
        if (!e.touches.length) {
            tracking = null;
            listenDocument(false);
        }
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

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
    else bind();
})();
