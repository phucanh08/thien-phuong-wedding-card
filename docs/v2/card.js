// Thiệp v2 (mẫu "Nhà Có Hỷ"): vẽ nội dung + hiệu ứng, chào tên khách ?code=, xác nhận tham dự và sổ
// lời chúc (Firestore qua firebase-config.js dùng chung với v1), nhạc nền, thêm lễ vào lịch (common/calendar.js).
// Dữ liệu chỉ đưa vào DOM bằng textContent / thuộc tính, không innerHTML.
// Script thường, không phải module: phần cần module (bản xuất bản qua content-loader.js, Firestore) nằm ở
// v2/v2.js và nối vào qua window.v2Card.connect(). Module đó tải lỗi hay trình duyệt không chạy module thì
// thiệp vẫn mở được bằng wedding-data.js (xem "Khởi động" cuối file).
(function () {
    'use strict';

    const LG_SCRIPTS = [
        'templates/template135/lightgallery/lightgallery.umd.js',
        'templates/template135/lightgallery/plugins/lg-zoom.umd.js',
        'templates/template135/lightgallery/plugins/lg-thumbnail.umd.js',
        'templates/template135/lightgallery/plugins/lg-autoplay.umd.js',
        'templates/template135/lightgallery/plugins/lg-fullscreen.umd.js'
    ];
    const LG_LICENSE = '0000-0000-000-0000';
    const TIMELINE_ICONS = ['icon-18', 'icon-19', 'icon-20', 'icon-21'].map(n => `v2/assets/icons/${n}.svg`);
    const MONTH_NAMES = ['Một', 'Hai', 'Ba', 'Tư', 'Năm', 'Sáu', 'Bảy', 'Tám', 'Chín', 'Mười', 'Mười Một', 'Mười Hai'];
    const WEEKDAYS = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
    const DEFAULT_INTRO = 'Hôm nay là ngày chúng mình cùng nắm tay nhau bước vào hành trình của yêu thương và sẻ chia.';
    const DEFAULT_THANKS = 'Cảm ơn quý khách đã hiện diện và gửi đến chúng con những lời chúc tốt đẹp.';
    const AUTO_SCROLL_SPEED = 80; // px/giây (Human duyệt 2026-10-02; mẫu là 120)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    history.scrollRestoration = 'manual';

    // ===== Tiện ích DOM =====
    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function setText(key, value) {
        document.querySelectorAll(`[data-wd="${key}"]`).forEach(node => { node.textContent = value; });
    }

    // Link/ảnh từ dữ liệu: chỉ nhận http(s) hoặc đường dẫn tương đối
    function safeUrl(url) {
        if (typeof url !== 'string' || !url) return '';
        try {
            const parsed = new URL(url, document.baseURI);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : '';
        } catch {
            return '';
        }
    }

    function setImg(img, url, alt) {
        const src = safeUrl(url);
        if (src) img.src = src;
        if (alt != null) img.alt = alt;
    }

    const pad = n => String(n).padStart(2, '0');

    // "2026-10-24T16:30:00+07:00" -> { y, m, d, time: "16:30" }; chỉ có ngày thì time = null.
    // Đọc thẳng từ chuỗi (giờ địa phương của lễ), không đổi múi giờ theo máy khách.
    function parseISO(iso) {
        const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso || '');
        if (!m) return null;
        const y = +m[1], mo = +m[2], d = +m[3];
        return { y, m: mo, d, time: m[4] ? `${m[4]}:${m[5]}` : null, weekday: new Date(Date.UTC(y, mo - 1, d)).getUTCDay() };
    }

    // ===== Meta =====
    function applyMeta(D) {
        const groom = D.couple.groom, bride = D.couple.bride;
        const siteName = 'Lễ cưới: ' + groom.shortName + ' & ' + bride.shortName;
        const set = (selector, value) => {
            const node = document.querySelector(selector);
            if (node) node.setAttribute(node.tagName === 'LINK' ? 'href' : 'content', value);
        };
        const preview = new URL(D.meta.previewImage, document.baseURI).href;
        document.title = D.meta.title;
        set('meta[name="description"]', D.meta.description);
        set('meta[name="keywords"]', 'Wedding,' + groom.fullName + ',' + bride.fullName);
        set('meta[name="application-name"]', D.meta.title);
        set('link[rel="icon"]', D.meta.favicon);
        set('meta[property="og:site_name"]', siteName);
        set('meta[property="og:title"]', siteName);
        set('meta[property="og:description"]', D.meta.description);
        set('meta[property="og:image"]', preview);
        set('meta[name="twitter:title"]', siteName);
        set('meta[name="twitter:description"]', D.meta.description);
        set('meta[name="twitter:image"]', preview);
    }

    // ===== Vẽ thiệp =====
    function render(D) {
        const { groom, bride } = D.couple;
        const wedding = D.wedding;
        const date = parseISO(wedding.dateISO);
        const mainImage = wedding.mainImage || D.meta.previewImage;

        // Phong bì + banner
        setImg(document.querySelector('[data-envelope-photo]'), wedding.envelopeImage || mainImage, '');
        setImg(document.querySelector('[data-wd-img="main"]'), mainImage, `${groom.shortName} & ${bride.shortName}`);
        setText('groom-short', groom.shortName);
        setText('bride-short', bride.shortName);
        setText('date-dots', `${pad(date.d)}.${pad(date.m)}.${date.y}`);

        // Gia đình
        ['groom', 'bride'].forEach(side => {
            const person = D.couple[side];
            setText(`${side}-father`, person.father);
            setText(`${side}-mother`, person.mother);
            setText(`${side}-address`, person.address || '');
        });
        setText('monogram', initial(groom.shortName) + initial(bride.shortName));

        // Lời dẫn, đếm ngược, lịch
        renderIntro(wedding);
        setImg(document.querySelector('[data-wd-img="invitation"]'), wedding.invitationImage || mainImage, 'Ảnh cưới');
        setText('calendar-month', `Tháng ${MONTH_NAMES[date.m - 1]} ${date.y}`);
        renderCalendar(date, D.events);
        startCountdown(date);

        renderEvents(D.events, `Đám cưới ${groom.shortName} và ${bride.shortName}`);
        renderCover(D);
        renderTimeline(D.events);
        renderStory(D.story);
        renderAlbum(D.gallery);
        renderGift(D.donate);
        setText('thanks', typeof wedding.thanksText === 'string' ? wedding.thanksText : DEFAULT_THANKS);

        const audio = document.getElementById('v2-audio');
        const musicSrc = safeUrl(D.music && D.music.src);
        if (musicSrc) {
            audio.src = musicSrc;
            if (D.music.title) audio.title = D.music.title;
        }
    }

    // Có câu dẫn thì dùng câu dẫn; để trống thì hiện lời ngỏ (mỗi phần tử một dòng, như v1);
    // không có cả hai thì như cũ: thiếu key -> câu mặc định, chuỗi rỗng -> ẩn.
    function renderIntro(wedding) {
        const intro = typeof wedding.introText === 'string' ? wedding.introText : null;
        const lines = Array.isArray(wedding.invitationText) ? wedding.invitationText.map(line => typeof line === 'string' ? line : '') : [];
        if ((intro && intro.trim()) || !lines.some(line => line.trim())) {
            setText('intro', intro == null ? DEFAULT_INTRO : intro);
            return;
        }
        document.querySelectorAll('[data-wd="intro"]').forEach(node => {
            node.replaceChildren();
            lines.forEach((line, i) => {
                if (i) node.append(el('br'));
                node.append(document.createTextNode(line));
            });
        });
    }

    function initial(name) {
        return (name || '').trim().charAt(0).toUpperCase();
    }

    function renderCalendar(date, events) {
        const table = document.getElementById('v2-calendar');
        table.replaceChildren();
        const caption = el('caption', 'v2-sr-only', `Tháng ${MONTH_NAMES[date.m - 1]} ${date.y}`);
        caption.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)';
        const head = el('tr');
        ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].forEach(d => head.append(el('th', null, d)));
        const thead = el('thead');
        thead.append(head);
        table.append(caption, thead);

        // Ngày có lễ khác (cùng tháng/năm) được khoanh nhẹ
        const eventDays = new Set((events || []).map(e => parseISO(e.startISO))
            .filter(p => p && p.y === date.y && p.m === date.m && p.d !== date.d).map(p => p.d));

        const body = el('tbody');
        const firstWeekday = new Date(Date.UTC(date.y, date.m - 1, 1)).getUTCDay();
        const offset = (firstWeekday + 6) % 7; // thứ Hai đầu tuần
        const daysInMonth = new Date(Date.UTC(date.y, date.m, 0)).getUTCDate();
        let row = el('tr');
        for (let i = 0; i < offset; i++) row.append(el('td'));
        for (let day = 1; day <= daysInMonth; day++) {
            const cell = el('td');
            if (day === date.d) {
                cell.className = 'is-wedding';
                cell.insertAdjacentHTML('beforeend',
                    '<svg class="v2-calendar__heart" viewBox="0 0 48 44" aria-hidden="true"><path d="M24 41 5.8 23.3C-5.2 12.6 10.5-4.3 24 9.1 37.5-4.3 53.2 12.6 42.2 23.3Z"/></svg>');
                cell.setAttribute('aria-label', `${day} - ngày cưới`);
            } else if (eventDays.has(day)) {
                cell.className = 'is-event';
            }
            cell.append(el('span', null, String(day)));
            row.append(cell);
            if ((offset + day) % 7 === 0) {
                body.append(row);
                row = el('tr');
            }
        }
        if (row.children.length) {
            while (row.children.length < 7) row.append(el('td'));
            body.append(row);
        }
        table.append(body);
    }

    function startCountdown(date) {
        const target = Date.parse(`${date.y}-${pad(date.m)}-${pad(date.d)}T00:00:00+07:00`);
        const nodes = {};
        document.querySelectorAll('[data-cd]').forEach(node => { nodes[node.dataset.cd] = node; });
        const tick = () => {
            let left = Math.max(0, Math.floor((target - Date.now()) / 1000));
            const days = Math.floor(left / 86400); left -= days * 86400;
            const hours = Math.floor(left / 3600); left -= hours * 3600;
            const minutes = Math.floor(left / 60);
            const seconds = left - minutes * 60;
            nodes.days.textContent = pad(days);
            nodes.hours.textContent = pad(hours);
            nodes.minutes.textContent = pad(minutes);
            nodes.seconds.textContent = pad(seconds);
        };
        tick();
        setInterval(tick, 1000);
    }

    // Có giờ kết thúc khác giờ bắt đầu thì hiện khoảng "HH:mm – HH:mm"; kết thúc chỉ có ngày thì như cũ
    function eventTimeText(p, end) {
        if (!p.time) return `${WEEKDAYS[p.weekday]} · Giờ: đang cập nhật`;
        const time = end && end.time && end.time !== p.time ? `${p.time} – ${end.time}` : p.time;
        return `Vào ${time}, ${WEEKDAYS[p.weekday]}`;
    }

    // ===== Thêm vào lịch (common/calendar.js, cùng cấu hình với v1) =====
    // Chỉ gửi giờ khi có đủ giờ bắt đầu và kết thúc: thiếu giờ thì thư viện tạo sự kiện cả ngày.
    function eventCalendarConfig(event, coupleLabel) {
        const start = parseISO(event.startISO);
        if (!start) return null;
        const end = parseISO(event.endISO) || start;
        const isoDate = p => `${p.y}-${pad(p.m)}-${pad(p.d)}`;
        const config = {
            name: `${event.title} (${coupleLabel})`,
            description: 'Cảm ơn bạn đã dành thời gian tham dự đám cưới của chúng tôi!',
            startDate: isoDate(start),
            endDate: isoDate(end),
            location: [event.venue, event.address].filter(Boolean).join(', '),
            options: ['Apple', 'Google', 'iCal', 'Microsoft365', 'MicrosoftTeams', 'Outlook.com', 'Yahoo'],
            timeZone: 'Asia/Ho_Chi_Minh',
            iCalFileName: 'Reminder-Event',
            listStyle: 'modal',
            trigger: 'click'
        };
        if (start.time && end.time) {
            config.startTime = start.time;
            config.endTime = end.time;
        }
        return config;
    }

    let calendarReady;

    function loadCalendar() {
        if (!calendarReady) {
            if (!document.querySelector('link[href="common/calendar.css"]')) {
                const css = el('link');
                css.rel = 'stylesheet';
                css.href = 'common/calendar.css';
                document.head.append(css);
            }
            calendarReady = loadScript('common/calendar.js').then(() => {
                const loaded = typeof window.atcb_action === 'function';
                if (!loaded) calendarReady = null; // lỗi mạng: lần chạm sau thử tải lại
                return loaded;
            });
        }
        return calendarReady;
    }

    async function addToCalendar(config, trigger) {
        if (!(await loadCalendar())) return;
        try {
            window.atcb_action(config, trigger);
        } catch (error) {
            console.warn('Không mở được menu thêm vào lịch:', error);
        }
    }

    function renderEvents(events, coupleLabel) {
        const list = document.getElementById('v2-events');
        list.replaceChildren(...events.map(event => {
            const p = parseISO(event.startISO);
            const card = el('article', 'v2-event');
            card.dataset.reveal = 'fade-up';
            card.dataset.eventKey = event.key;
            card.append(el('p', 'v2-event__side', event.side === 'bride' ? 'Nhà gái' : 'Nhà trai'));
            card.append(el('h3', 'v2-event__name', event.title));
            const time = el('p', 'v2-event__time' + (p.time ? '' : ' is-pending'), eventTimeText(p, parseISO(event.endISO)));
            card.append(time);
            const dateRow = el('div', 'v2-event__date');
            dateRow.append(el('p', 'v2-event__date-side', `Tháng ${p.m}`), el('p', 'v2-event__day', pad(p.d)), el('p', 'v2-event__date-side', `Năm ${p.y}`));
            card.append(dateRow);
            if (event.lunarText) card.append(el('p', 'v2-event__lunar', `(Tức ngày ${event.lunarText})`));
            const venue = el('div', 'v2-event__venue');
            venue.append(el('p', 'v2-event__venue-label', 'Tại:'), el('p', 'v2-event__place', event.venue), el('p', 'v2-event__address', event.address));
            if (event.note) venue.append(el('p', 'v2-event__note', event.note));
            const actions = el('div', 'v2-event__actions');
            const map = el('a', 'v2-event__map', 'Xem bản đồ');
            map.href = safeUrl(event.mapUrl) || '#';
            map.target = '_blank';
            map.rel = 'noopener noreferrer';
            actions.append(map);
            const calendarConfig = eventCalendarConfig(event, coupleLabel);
            if (calendarConfig) {
                const add = el('button', 'v2-event__calendar', 'Thêm vào lịch');
                add.type = 'button';
                add.addEventListener('click', () => addToCalendar(calendarConfig, add));
                actions.append(add);
            }
            venue.append(actions);
            card.append(venue);
            return card;
        }));
    }

    // Ô không có nguồn (album rỗng mà thiếu coverImages): giữ khung nền trống, không hiện ảnh vỡ hay chữ
    // alt; cả ba ô đều trống thì ẩn mục "With you".
    function renderCover(D) {
        const sources = window.v2GalleryGrid.coverSources(D.gallery, D.wedding.coverImages).map(safeUrl);
        document.querySelectorAll('[data-cover]').forEach(img => {
            const src = sources[+img.dataset.cover];
            setImg(img, src, src ? 'Ảnh cưới' : '');
            if (!src) img.style.visibility = 'hidden';
        });
        if (!sources.some(Boolean)) document.querySelector('.v2-cover').hidden = true;
    }

    function renderTimeline(events) {
        const sorted = events.map(event => ({ event, p: parseISO(event.startISO) }))
            .sort((a, b) => sortKey(a.p).localeCompare(sortKey(b.p)));
        const list = document.getElementById('v2-timeline');
        list.replaceChildren(...sorted.map(({ event, p }, i) => {
            const item = el('li', 'v2-timeline__item');
            item.dataset.reveal = 'soft';
            item.style.setProperty('--reveal-delay', `${(i % 4) * 70}ms`);
            const content = el('article', 'v2-timeline__content');
            const meta = el('p', 'v2-timeline__meta', p.time ? `${p.time} ` : '');
            meta.append(el('small', null, `${p.time ? '· ' : ''}${pad(p.d)}/${pad(p.m)}`));
            content.append(meta, el('h3', 'v2-timeline__heading', event.title), el('p', 'v2-timeline__place', event.venue));
            const icon = el('span', 'v2-timeline__icon');
            icon.setAttribute('aria-hidden', 'true');
            const img = el('img');
            img.src = TIMELINE_ICONS[i % TIMELINE_ICONS.length];
            img.alt = '';
            img.width = 68;
            img.height = 68;
            icon.append(img);
            const marker = el('span', 'v2-timeline__marker');
            marker.setAttribute('aria-hidden', 'true');
            item.append(content, marker, icon);
            return item;
        }));

        // Dresscode theo từng lễ, cùng thứ tự Timeline
        const rows = sorted.filter(({ event }) => Array.isArray(event.dressCode) && event.dressCode.length)
            .map(({ event }) => {
                const row = el('div', 'v2-dresscode__row');
                row.dataset.reveal = 'fade-up';
                const palette = el('ul', 'v2-dresscode__palette');
                palette.setAttribute('aria-label', `Màu trang phục: ${event.title}`);
                event.dressCode.forEach(color => {
                    const swatch = el('li', 'v2-dresscode__swatch');
                    if (/^#[0-9a-f]{3,8}$/i.test(color)) swatch.style.setProperty('--swatch', color);
                    swatch.title = color;
                    palette.append(swatch);
                });
                row.append(el('p', 'v2-dresscode__name', event.title), palette);
                return row;
            });
        document.getElementById('v2-dresscode').replaceChildren(...rows);
        document.getElementById('v2-dresscode-wrap').hidden = !rows.length;
    }

    // Có giờ thì theo giờ; lễ chưa có giờ xếp cuối ngày đó
    function sortKey(p) {
        return `${p.y}-${pad(p.m)}-${pad(p.d)} ${p.time || '99:99'}`;
    }

    function renderStory(story) {
        const section = document.getElementById('v2-story-section');
        if (!Array.isArray(story) || !story.length) {
            section.hidden = true;
            return;
        }
        document.getElementById('v2-story').replaceChildren(...story.map(s => {
            const item = el('li', 'v2-story__item');
            item.dataset.reveal = 'fade-up';
            const marker = el('span', 'v2-story__marker');
            marker.setAttribute('aria-hidden', 'true');
            item.append(marker);
            if (s.image) {
                const photo = el('figure', 'v2-story__photo');
                const img = el('img');
                img.loading = 'lazy';
                img.dataset.pinchZoom = '';
                setImg(img, s.image, s.title);
                photo.append(img);
                item.append(photo);
            }
            const text = el('div', 'v2-story__text');
            text.append(el('p', 'v2-story__date', s.date), el('h3', 'v2-story__title', s.title), el('p', 'v2-story__body', s.text));
            item.append(text);
            return item;
        }));
    }

    // ===== Album 3D =====
    let album = null;

    function renderAlbum(gallery) {
        const stage = document.getElementById('v2-album');
        const dots = document.getElementById('v2-album-dots');
        const items = window.v2GalleryGrid.gridItems(gallery);
        // Album rỗng (C6 cho phép): ẩn mục Album như mục Chuyện tình rỗng
        if (!items.length) {
            stage.closest('.v2-album').hidden = true;
            return;
        }
        const slides = items.map(({ item, index }, i) => {
            const slide = el('button', 'v2-album__slide');
            slide.type = 'button';
            slide.dataset.index = String(index);
            slide.setAttribute('aria-label', `Xem ảnh ${i + 1}`);
            const img = el('img');
            img.loading = i < 3 ? 'eager' : 'lazy';
            img.draggable = false;
            img.dataset.pinchZoom = '';
            setImg(img, item.small, '');
            slide.append(img);
            return slide;
        });
        stage.replaceChildren(...slides);
        dots.replaceChildren(...slides.map((_, i) => {
            const dot = el('button', 'v2-album__dot');
            dot.type = 'button';
            dot.setAttribute('aria-label', `Ảnh ${i + 1}`);
            dot.addEventListener('click', () => album.go(i));
            return dot;
        }));
        album = createCarousel(stage, slides, [...dots.children]);
    }

    function createCarousel(stage, slides, dots) {
        let active = 0;
        const n = slides.length;
        const layout = () => {
            slides.forEach((slide, i) => {
                // Khoảng cách vòng tròn ngắn nhất tới ảnh đang chọn
                let off = i - active;
                if (off > n / 2) off -= n;
                if (off < -n / 2) off += n;
                const abs = Math.abs(off);
                const visible = abs <= 1;
                slide.style.transform = off === 0
                    ? 'translateX(0) scale(1)'
                    : `translateX(${Math.sign(off) * (abs === 1 ? 64 : 100)}%) rotateY(${-Math.sign(off) * 38}deg) scale(${abs === 1 ? .82 : .7})`;
                slide.style.opacity = off === 0 ? '1' : visible ? '.42' : '0';
                slide.style.zIndex = String(10 - abs);
                slide.style.pointerEvents = visible ? 'auto' : 'none';
                slide.tabIndex = off === 0 ? 0 : -1;
                slide.classList.toggle('is-active', off === 0);
            });
            dots.forEach((dot, i) => dot.classList.toggle('is-active', i === active));
        };
        const go = i => { active = (i + n) % n; layout(); };

        document.querySelector('.v2-album__nav--prev').addEventListener('click', () => go(active - 1));
        document.querySelector('.v2-album__nav--next').addEventListener('click', () => go(active + 1));
        stage.addEventListener('keydown', e => {
            if (e.key === 'ArrowLeft') go(active - 1);
            if (e.key === 'ArrowRight') go(active + 1);
        });

        // Vuốt ngang để chuyển; chạm (không vuốt) ảnh giữa thì mở lightbox, ảnh bên thì chuyển tới nó.
        // Ngón thứ hai đặt xuống (ở đâu cũng được) là chụm ảnh (pinch-zoom.js): không vuốt, không mở lightbox.
        let startX = null, startY = 0, swiped = false;
        stage.addEventListener('pointerdown', e => {
            if (!e.isPrimary) return;
            startX = e.clientX; startY = e.clientY; swiped = false;
        });
        window.addEventListener('pointerdown', e => { if (!e.isPrimary && startX != null) swiped = true; }, true);
        stage.addEventListener('pointermove', e => {
            if (startX == null || swiped || !e.isPrimary) return;
            const dx = e.clientX - startX;
            if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - startY)) {
                swiped = true;
                go(active + (dx < 0 ? 1 : -1));
            }
        });
        stage.addEventListener('pointerup', () => { startX = null; });
        stage.addEventListener('pointercancel', () => { startX = null; });
        stage.addEventListener('click', e => {
            const slide = e.target.closest('.v2-album__slide');
            if (!slide || swiped) return;
            const i = slides.indexOf(slide);
            if (i !== active) go(i);
            else openGallery(+slide.dataset.index);
        });
        layout();
        return { go };
    }

    // ===== LightGallery (vendor dùng lại, không sửa) =====
    let galleryData = [];
    let mainGallery = null;
    let lgReady = null;

    function loadScript(src) {
        return new Promise(resolve => {
            const script = document.createElement('script');
            script.async = false;
            script.src = src;
            script.onload = script.onerror = resolve;
            document.body.appendChild(script);
        });
    }

    function loadLightGallery() {
        if (!lgReady) lgReady = Promise.all(LG_SCRIPTS.map(loadScript)).then(() => typeof window.lightGallery === 'function');
        return lgReady;
    }

    async function openGallery(index) {
        if (!(await loadLightGallery())) return;
        if (!mainGallery) {
            mainGallery = window.lightGallery(document.getElementById('v2-lightgallery'), {
                plugins: [window.lgZoom, window.lgThumbnail, window.lgAutoplay, window.lgFullscreen],
                dynamic: true,
                dynamicEl: galleryData,
                download: false,
                preload: 2,
                appendSubHtmlTo: '.lg-item',
                actualSize: true,
                enableZoomAfter: 300,
                licenseKey: LG_LICENSE
            });
        }
        mainGallery.openGallery(index);
    }

    async function openSingleImage(src) {
        if (!(await loadLightGallery())) return;
        const host = document.createElement('div');
        document.body.appendChild(host);
        const single = window.lightGallery(host, {
            plugins: [window.lgZoom],
            dynamic: true,
            dynamicEl: [{ src, thumb: src }],
            download: false,
            actualSize: true,
            enableZoomAfter: 300,
            licenseKey: LG_LICENSE
        });
        host.addEventListener('lgAfterClose', () => {
            single.destroy();
            host.remove();
        }, { once: true });
        single.openGallery(0);
    }

    function setGalleryData(gallery) {
        galleryData = gallery.map(item => {
            const entry = { src: safeUrl(item.large), thumb: safeUrl(item.small) };
            if (item.caption) {
                // subHtml là HTML của thư viện: dựng bằng DOM rồi lấy outerHTML để caption đã được escape
                const wrap = el('div', 'lg-sub-html');
                wrap.append(el('h4', null, item.caption));
                entry.subHtml = wrap.outerHTML;
            }
            return entry;
        });
    }

    // ===== Hộp mừng cưới =====
    const COPY_ICONS = '<svg class="is-idle" width="13" height="13" viewBox="0 0 12 12" fill="none" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M3 8V2.8C3 2.36 3.36 2 3.8 2H8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>'
        + '<svg class="is-done" width="13" height="13" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const DOWNLOAD_ICON = '<svg width="12" height="12" viewBox="0 0 11 11" fill="none" aria-hidden="true"><path d="M5.5 1v6M5.5 7L3 4.5M5.5 7L8 4.5M2 9.5h7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    function renderGift(donate) {
        const cards = ['groom', 'bride'].filter(side => donate && donate[side]).map(side => {
            const b = donate[side];
            const card = el('article', 'v2-gift__card');
            card.dataset.reveal = 'fade-up';
            card.append(el('p', 'v2-gift__role', side === 'groom' ? 'Đến chú rể' : 'Đến cô dâu'));
            const qrButton = el('button', 'v2-gift__qr');
            qrButton.type = 'button';
            qrButton.setAttribute('aria-label', `Phóng to mã QR ${side === 'groom' ? 'chú rể' : 'cô dâu'}`);
            const qr = el('img', 'qr-code-image');
            qr.loading = 'lazy';
            setImg(qr, b.qr, `${side}_qr_donate`);
            qrButton.append(qr);
            const download = el('a', 'v2-gift__download');
            download.href = safeUrl(b.qr) || '#';
            download.setAttribute('download', `qr-${side === 'groom' ? 'chu-re' : 'co-dau'}`);
            download.insertAdjacentHTML('beforeend', DOWNLOAD_ICON);
            download.append(el('span', null, 'Tải QR'));
            const number = el('p', 'v2-gift__number');
            number.append(el('span', null, `STK: ${b.accountNumber}`));
            const copy = el('button', 'v2-gift__copy');
            copy.type = 'button';
            copy.setAttribute('aria-label', 'Sao chép số tài khoản');
            copy.insertAdjacentHTML('beforeend', COPY_ICONS);
            copy.addEventListener('click', () => copyText(b.accountNumber, copy));
            number.append(copy);
            card.append(qrButton, download, el('p', 'v2-gift__bank', b.bank), number, el('p', 'v2-gift__name', b.accountName));
            if (b.branch) card.append(el('p', 'v2-gift__name', b.branch));
            qrButton.addEventListener('click', () => { if (qr.src) openSingleImage(qr.src); });
            return card;
        });
        document.getElementById('v2-gift').replaceChildren(...cards);
    }

    async function copyText(text, button) {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            const area = el('textarea');
            area.value = text;
            area.style.cssText = 'position:fixed;opacity:0';
            document.body.append(area);
            area.select();
            document.execCommand('copy');
            area.remove();
        }
        button.classList.add('is-copied');
        setTimeout(() => button.classList.remove('is-copied'), 1800);
    }

    // ===== Hiệu ứng vào khung (chạy lại khi cuộn lên/xuống, như AOS once:false) =====
    let revealObserver = null;

    function observeReveals() {
        const targets = document.querySelectorAll('[data-reveal]');
        if (reducedMotion || !('IntersectionObserver' in window)) {
            targets.forEach(node => node.classList.add('is-in'));
            return;
        }
        if (!revealObserver) {
            revealObserver = new IntersectionObserver(entries => {
                entries.forEach(entry => entry.target.classList.toggle('is-in', entry.isIntersecting));
            }, { rootMargin: '0px 0px -30px 0px' });
        }
        targets.forEach(node => revealObserver.observe(node));
    }

    // ===== Nhạc =====
    const music = document.getElementById('v2-music');
    const audio = document.getElementById('v2-audio');

    function playMusic() {
        if (!audio.src) return;
        const playing = audio.play();
        if (playing) playing.catch(() => {});
    }

    const musicButton = music.querySelector('button');

    // Trạng thái nút theo sự kiện của <audio> (không theo lần chạm): play() bị trình duyệt từ chối thì nút vẫn "tắt"
    function showMusicState() {
        const playing = !audio.paused;
        music.classList.toggle('is-playing', playing);
        musicButton.setAttribute('aria-pressed', String(playing));
    }

    musicButton.addEventListener('click', () => {
        if (audio.paused) playMusic(); else audio.pause();
    });
    audio.addEventListener('play', showMusicState);
    audio.addEventListener('pause', showMusicState);

    // ===== Tự cuộn chậm sau khi mở phong bì; dừng ngay khi khách tự thao tác =====
    // Nghe thao tác từ lúc thiệp hiện ra và cuộn được (armAutoScroll), không đợi tới lúc bắt đầu cuộn:
    // khách chạm/vuốt trong khoảng chờ đó thì tự cuộn không chạy nữa. Đã dừng thì không chạy lại.
    let autoScrollArmed = false;
    let autoScrollFrame = 0;
    const STOP_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'];

    function armAutoScroll() {
        if (reducedMotion) return;
        autoScrollArmed = true;
        STOP_EVENTS.forEach(type => window.addEventListener(type, stopAutoScroll, { capture: true, passive: true }));
    }

    function stopAutoScroll() {
        if (!autoScrollArmed) return;
        autoScrollArmed = false;
        cancelAnimationFrame(autoScrollFrame);
        autoScrollFrame = 0;
        STOP_EVENTS.forEach(type => window.removeEventListener(type, stopAutoScroll, true));
    }

    function startAutoScroll() {
        if (!autoScrollArmed || autoScrollFrame) return;
        let last = performance.now();
        let y = window.scrollY;
        const step = now => {
            y += AUTO_SCROLL_SPEED * Math.min(now - last, 100) / 1000;
            last = now;
            const max = document.documentElement.scrollHeight - window.innerHeight;
            window.scrollTo(0, Math.min(y, max));
            autoScrollFrame = requestAnimationFrame(step);
            if (y >= max) stopAutoScroll();
        };
        autoScrollFrame = requestAnimationFrame(step);
    }

    // ===== Mở phong bì =====
    const envelope = document.getElementById('v2-envelope');
    const card = document.getElementById('v2-card');
    const dock = document.getElementById('v2-dock');
    let opened = false;

    async function openEnvelope() {
        if (opened) return;
        opened = true;
        playMusic(); // trong chính cử chỉ chạm (iOS chỉ cho phát ở đây)
        await contentReady;
        if (audio.paused) playMusic();
        const wait = ms => new Promise(resolve => setTimeout(resolve, reducedMotion ? 0 : ms));

        envelope.classList.add('is-opening');
        await wait(2400);

        // Trả trang về đầu, hiện nội dung sau lớp phong bì đang mờ dần, ảnh bay vào banner
        window.scrollTo(0, 0);
        card.classList.add('is-entering');
        document.documentElement.classList.remove('v2-locked');
        armAutoScroll();
        flyPhotoToBanner();
        envelope.classList.add('is-handoff');
        requestAnimationFrame(() => requestAnimationFrame(() => {
            card.classList.add('is-shown');
            card.classList.remove('is-entering');
        }));
        music.hidden = false;
        dock.hidden = false;
        dock.classList.add('is-entering');
        requestAnimationFrame(() => requestAnimationFrame(() => dock.classList.remove('is-entering')));
        await wait(1100);

        envelope.classList.add('is-done');
        startAutoScroll();
    }

    function flyPhotoToBanner() {
        const photo = envelope.querySelector('.v2-envelope__photo');
        const banner = document.querySelector('.v2-couple__banner');
        const from = photo.getBoundingClientRect();
        const to = banner.getBoundingClientRect();
        if (reducedMotion || !from.width || !to.width) return;
        const flyer = el('div', 'v2-handoff-photo');
        const img = el('img');
        img.src = photo.querySelector('img').src;
        img.alt = '';
        flyer.append(img);
        Object.assign(flyer.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` });
        flyer.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
        document.body.append(flyer);
        flyer.getBoundingClientRect();
        flyer.style.transform = 'none';
        flyer.style.borderRadius = '0';
        setTimeout(() => { flyer.style.opacity = '0'; }, 950);
        setTimeout(() => flyer.remove(), 1400);
    }

    document.getElementById('v2-envelope-open').addEventListener('click', openEnvelope);

    dock.querySelector('.v2-dock__switch').addEventListener('click', event => {
        const collapsed = dock.classList.toggle('is-collapsed');
        event.currentTarget.setAttribute('aria-expanded', String(!collapsed));
        event.currentTarget.setAttribute('aria-label', collapsed ? 'Mở thanh hành động' : 'Thu gọn');
    });

    // ===== Bottom sheet (sổ lời chúc, xác nhận tham dự) =====
    const sheetBackdrop = document.getElementById('v2-sheet-backdrop');
    let openSheetEl = null;
    let sheetOpener = null;

    function openSheet(sheet) {
        if (openSheetEl === sheet) return;
        if (openSheetEl) closeSheet(true);
        stopAutoScroll();
        openSheetEl = sheet;
        sheetOpener = document.activeElement;
        sheetBackdrop.hidden = false;
        sheet.hidden = false;
        document.documentElement.classList.add('v2-sheet-open');
        sheet.getBoundingClientRect();
        sheetBackdrop.classList.add('is-open');
        sheet.classList.add('is-open');
        sheet.focus({ preventScroll: true });
        if (sheet === guestbook) scrollWishesToEnd();
    }

    function closeSheet(instant) {
        const sheet = openSheetEl;
        if (!sheet) return;
        openSheetEl = null;
        sheet.classList.remove('is-open');
        sheetBackdrop.classList.remove('is-open');
        document.documentElement.classList.remove('v2-sheet-open');
        const hide = () => {
            if (openSheetEl === sheet) return;
            sheet.hidden = true;
            if (!openSheetEl) sheetBackdrop.hidden = true;
        };
        if (instant || reducedMotion) hide(); else setTimeout(hide, 320);
        if (sheetOpener && sheetOpener.focus) sheetOpener.focus({ preventScroll: true });
    }

    sheetBackdrop.addEventListener('click', () => closeSheet());
    document.querySelectorAll('[data-sheet-close]').forEach(button => button.addEventListener('click', () => closeSheet()));
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && openSheetEl) closeSheet();
    });
    dock.querySelector('[data-action="guestbook"]').addEventListener('click', () => openSheet(guestbook));
    dock.querySelector('[data-action="rsvp"]').addEventListener('click', () => openSheet(rsvpSheet));

    function setStatus(node, state, text) {
        node.dataset.state = state;
        node.textContent = text;
    }

    // ===== Khách theo ?code=, gửi RSVP / lời chúc (firebase-config.js phát wedding:guest, wedding:wishes) =====
    const NAME_MAX = 60;
    const MESSAGE_MAX = 500;
    const COUNT_MAX = 20;
    const OFFLINE_TEXT = 'Chưa kết nối được, bạn vui lòng thử lại sau ít phút nhé!';
    let guest = null;

    function guestFullName(g) {
        return g ? [g.salutation, g.name].filter(Boolean).join(' ').trim() : '';
    }

    function prefillName(input, g) {
        if (g && g.name && !input.value.trim()) input.value = String(g.name).slice(0, NAME_MAX);
    }

    function applyGuest(g) {
        guest = g || null;
        const fullName = guestFullName(guest);
        if (fullName) document.querySelectorAll('[data-guest-name]').forEach(node => { node.textContent = fullName; });
        prefillName(rsvpForm.elements.namedItem('name'), guest);
        prefillName(wishForm.elements.namedItem('name'), guest);
        // wedding:guest có thể tới muộn: không đè số người khách đã tự chỉnh
        const expected = guest && Number(guest.expectedCount);
        if (!countEdited && Number.isInteger(expected) && expected >= 1) countInput.value = String(Math.min(expected, COUNT_MAX));
        applyInvites();
        updateRsvpSubmit();
        updateWishSubmit();
    }

    // --- Xác nhận tham dự ---
    const rsvpSheet = document.getElementById('v2-rsvp');
    const rsvpForm = rsvpSheet.querySelector('[data-rsvp-form]');
    const rsvpEvents = rsvpForm.querySelector('[data-rsvp-events]');
    const rsvpCount = rsvpForm.querySelector('[data-rsvp-count]');
    const countInput = rsvpForm.elements.namedItem('count');
    const rsvpSubmit = rsvpForm.querySelector('[type="submit"]');
    const rsvpStatus = rsvpForm.querySelector('[data-rsvp-status]');
    let rsvpSending = false;
    let countEdited = false;

    function renderRsvpContent(D) {
        const deadline = rsvpForm.querySelector('[data-rsvp-deadline]');
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(D.wedding.rsvpDeadline || '');
        deadline.textContent = m ? `Vui lòng phản hồi trước ngày ${m[3]}.${m[2]}.${m[1]} để chúng tôi kịp chuẩn bị chu đáo.` : '';
        deadline.hidden = !m;

        rsvpForm.querySelector('[data-rsvp-event-list]').replaceChildren(...D.events.map(event => {
            const label = el('label', 'v2-choice v2-choice--check');
            const input = el('input');
            input.type = 'checkbox';
            input.name = 'events';
            input.value = event.key;
            label.append(input, el('span', null, event.title));
            return label;
        }));
        applyInvites();
        updateRsvpSubmit();
    }

    function eventInputs() {
        return [...rsvpForm.querySelectorAll('input[name="events"]')];
    }

    // Khách có code: chỉ hiện lễ được mời, chọn sẵn. Danh sách không khớp lễ nào (dữ liệu sai) thì hiện tất cả như v1.
    function applyInvites() {
        const invited = guest && Array.isArray(guest.invitedEvents) ? guest.invitedEvents : [];
        const inputs = eventInputs();
        if (!inputs.some(input => invited.includes(input.value))) return;
        inputs.forEach(input => {
            input.checked = invited.includes(input.value);
            input.closest('label').hidden = !input.checked;
        });
    }

    function rsvpInput() {
        const attending = (rsvpForm.querySelector('input[name="attending"]:checked') || {}).value || '';
        const count = Number(countInput.value);
        const events = eventInputs().filter(input => input.checked && !input.closest('label').hidden).map(input => input.value);
        return { name: rsvpForm.elements.namedItem('name').value.trim(), attending, count, events };
    }

    function updateRsvpSubmit() {
        const { name, attending, count, events } = rsvpInput();
        const hasEvents = eventInputs().some(input => !input.closest('label').hidden);
        rsvpEvents.hidden = !hasEvents || !(attending === 'yes' || attending === 'maybe');
        rsvpCount.hidden = attending !== 'yes';
        const valid = name.length > 0 && name.length <= NAME_MAX && Boolean(attending)
            && (attending !== 'yes' || (Number.isInteger(count) && count >= 1 && count <= COUNT_MAX && (!hasEvents || events.length > 0)));
        rsvpSubmit.disabled = rsvpSending || !valid;
    }

    rsvpForm.addEventListener('click', event => {
        const step = event.target.closest('[data-step]');
        if (!step) return;
        const current = Number(countInput.value);
        const next = (Number.isInteger(current) ? current : 1) + Number(step.dataset.step);
        countInput.value = String(Math.min(COUNT_MAX, Math.max(1, next)));
        countInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    rsvpForm.addEventListener('input', event => {
        if (event.target === countInput) countEdited = true;
        if (!rsvpSending) setStatus(rsvpStatus, '', '');
        updateRsvpSubmit();
    });
    rsvpForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (rsvpSubmit.disabled) return;
        // Khoá nút ngay (trước khi chờ module Firestore): chạm đúp lúc module chưa sẵn sàng không gửi hai lần
        const input = rsvpInput();
        rsvpSending = true;
        updateRsvpSubmit();
        setStatus(rsvpStatus, 'pending', 'Đang gửi…');
        const firestore = await firestoreReady;
        if (!firestore) {
            rsvpSending = false;
            setStatus(rsvpStatus, 'error', OFFLINE_TEXT);
            return updateRsvpSubmit();
        }
        const result = await firestore.sendRsvp(input);
        rsvpSending = false;
        setStatus(rsvpStatus, result.ok ? 'success' : 'error', result.message);
        updateRsvpSubmit();
    });

    // --- Sổ lời chúc ---
    const guestbook = document.getElementById('v2-guestbook');
    const wishForm = guestbook.querySelector('[data-wish-form]');
    const wishList = guestbook.querySelector('[data-wish-list]');
    const wishSubmit = wishForm.querySelector('[type="submit"]');
    const wishStatus = wishForm.querySelector('[data-wish-status]');
    const wishNodes = new Map();
    let wishesLoaded = false;
    let wishSending = false;

    function scrollWishesToEnd() {
        wishList.scrollTop = wishList.scrollHeight;
    }

    // detail: mới nhất trước, tối đa WISHES_SHOWN. Hiện kiểu chat: cũ ở trên, mới ở dưới; lời chúc mới trượt vào.
    async function renderWishes(wishes) {
        const firestore = await firestoreReady;
        const max = firestore ? firestore.WISHES_SHOWN : Infinity;
        const atEnd = wishList.scrollHeight - wishList.scrollTop - wishList.clientHeight < 40;
        const nodes = [...wishes].reverse().map(wish => {
            let item = wishNodes.get(wish.id);
            if (!item) {
                item = el('li', 'v2-wish' + (wishesLoaded ? ' is-new' : ''));
                item.append(el('p', 'v2-wish__name', wish.name), el('p', 'v2-wish__message', wish.message));
                wishNodes.set(wish.id, item);
            }
            return item;
        });
        const keep = new Set(wishes.map(wish => wish.id));
        [...wishNodes.keys()].forEach(id => { if (!keep.has(id)) wishNodes.delete(id); });
        wishList.replaceChildren(...nodes);
        wishesLoaded = true;

        const count = wishes.length >= max ? `${max}+` : String(wishes.length);
        guestbook.querySelector('[data-wish-title]').textContent = `${count} Lời chúc`;
        guestbook.querySelector('[data-wish-empty]').hidden = wishes.length > 0;
        const badge = dock.querySelector('[data-wish-count]');
        badge.textContent = count;
        badge.hidden = wishes.length === 0;
        if (atEnd || !openSheetEl) scrollWishesToEnd();
    }

    function updateWishSubmit() {
        const name = wishForm.elements.namedItem('name').value;
        const message = wishForm.elements.namedItem('message').value;
        const valid = name.trim().length > 0 && name.length <= NAME_MAX && message.trim().length > 0 && message.length <= MESSAGE_MAX;
        wishSubmit.disabled = wishSending || !valid;
    }

    wishForm.addEventListener('input', () => {
        if (!wishSending) setStatus(wishStatus, '', '');
        updateWishSubmit();
    });
    wishForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (wishSubmit.disabled) return;
        // Khoá nút ngay (trước khi chờ module Firestore): chạm đúp lúc module chưa sẵn sàng không gửi hai lần
        const messageInput = wishForm.elements.namedItem('message');
        const wish = { name: wishForm.elements.namedItem('name').value, message: messageInput.value };
        wishSending = true;
        updateWishSubmit();
        setStatus(wishStatus, 'pending', 'Đang gửi…');
        const firestore = await firestoreReady;
        if (!firestore) {
            wishSending = false;
            setStatus(wishStatus, 'error', OFFLINE_TEXT);
            return updateWishSubmit();
        }
        const result = await firestore.sendWish(wish);
        wishSending = false;
        if (result.ok) {
            messageInput.value = '';
            scrollWishesToEnd();
        }
        setStatus(wishStatus, result.ok ? 'success' : 'error', result.message);
        updateWishSubmit();
    });

    // Nghe trước khi nạp module để không lỡ sự kiện đầu. Module lỗi (mất mạng, CDN) thì thiệp vẫn chạy,
    // chỉ RSVP / lời chúc báo chưa kết nối.
    document.addEventListener('wedding:guest', event => applyGuest(event.detail));
    document.addEventListener('wedding:wishes', event => renderWishes(event.detail));
    let resolveFirestore;
    const firestoreReady = new Promise(resolve => { resolveFirestore = resolve; });

    // ===== Khởi động =====
    // Nội dung (bản xuất bản hoặc dự phòng, không trộn) đến từ v2/v2.js. Module đó hay content-loader.js /
    // firebase-shared.js tải lỗi, trình duyệt không chạy module, hay quá BOOT_DEADLINE_MS chưa có nội dung
    // -> vẽ bằng wedding-data.js đã nạp ở <head>, để phong bì luôn mở được.
    const BOOT_DEADLINE_MS = 4000; // > thời gian chờ bản xuất bản của content-loader.js (2.5s)
    // Chụm ảnh (pinch-zoom.js) gắn vào ảnh có sẵn lúc nó chạy -> nạp sau khi vẽ, như v1
    const GESTURE_SCRIPTS = ['pinch-zoom.js', 'lightbox-close.js'];
    let resolveContent;
    const contentReady = new Promise(resolve => { resolveContent = resolve; });
    let booted = false;
    let connected = false;

    function boot(data, source) {
        if (booted) return;
        booted = true;
        clearTimeout(deadline);
        window.WEDDING_DATA = data;
        document.documentElement.dataset.contentSource = source;
        try {
            applyMeta(data);
            setGalleryData(data.gallery);
            render(data);
            renderRsvpContent(data);
        } catch (error) {
            console.error('Không vẽ được thiệp:', error);
        }
        observeReveals();
        GESTURE_SCRIPTS.forEach(loadScript);
        // Nạp sẵn LightGallery khi rảnh để lần chạm ảnh đầu tiên mở ngay
        (window.requestIdleCallback || setTimeout)(() => { loadLightGallery(); loadCalendar(); });
        resolveContent();
    }

    function bootFallback(reason) {
        if (booted) return;
        console.warn('Không nạp được nội dung thiệp, dùng nội dung dự phòng:', reason);
        boot(window.WEDDING_DATA, 'fallback');
    }

    function moduleFailed(reason) {
        bootFallback(reason);
        resolveFirestore(null);
    }

    const deadline = setTimeout(() => bootFallback(`quá ${BOOT_DEADLINE_MS}ms`), BOOT_DEADLINE_MS);
    if (!('noModule' in HTMLScriptElement.prototype)) moduleFailed('trình duyệt không chạy module');
    // Module script chạy xong trước sự kiện load: tới load mà chưa nối thì v2/v2.js đã không chạy được
    window.addEventListener('load', () => { if (!connected) moduleFailed('v2/v2.js không chạy'); });

    // v2/v2.js gọi: content -> { data, source } của loadWeddingContent(), firestore -> module firebase-config.js
    window.v2Card = {
        connect({ content, firestore }) {
            connected = true;
            content.then(({ data, source }) => boot(data, source), bootFallback);
            firestore.then(resolveFirestore, error => {
                console.warn('Không nạp được Firestore, tắt RSVP / lời chúc:', error);
                resolveFirestore(null);
            });
        }
    };
})();
