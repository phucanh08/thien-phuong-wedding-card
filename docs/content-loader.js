// Nạp nội dung thiệp: bản đã xuất bản siteContent/published (CLAUDE.md mục 6), không được thì
// dùng docs/wedding-data.js (dự phòng). Dùng chung cho mọi phiên bản thiệp (/v1/, /v2/...).
//
//   const { data, source } = await loadWeddingContent();  // source: 'published' | 'fallback'
//
// Chỉ reject khi cả wedding-data.js cũng không nạp được. Cả trang phải dùng đúng một `data` trả về,
// không trộn hai nguồn. `data` đã qua normalize(): đủ shape WEDDING_DATA, URL/màu sai đã bị bỏ.
// Đọc qua Firestore REST (một fetch) thay vì SDK: không phải tải SDK trước khi vẽ thiệp, và không
// đụng instance Firestore của firebase-config.js (nối emulator chỉ được làm một lần).
import { FIREBASE_CONFIG, FIRESTORE_EMULATOR_PORT, USE_EMULATOR } from './firebase-shared.js';

const TIMEOUT_MS = 2500;
const FALLBACK_SCRIPT = new URL('./wedding-data.js', import.meta.url).href;

const FIRESTORE_ORIGIN = USE_EMULATOR
    ? `http://127.0.0.1:${FIRESTORE_EMULATOR_PORT}`
    : 'https://firestore.googleapis.com';
// Không gắn ?key=: rules cho ai cũng get siteContent/published, khỏi phụ thuộc giới hạn của API key
const PUBLISHED_URL = `${FIRESTORE_ORIGIN}/v1/projects/${FIREBASE_CONFIG.projectId}`
    + '/databases/(default)/documents/siteContent/published';

// wedding-data.js trang đã nạp sẵn, lấy lúc module chạy: trang sẽ ghi đè window.WEDDING_DATA bằng
// nội dung đang dùng, gọi lại loadWeddingContent() vẫn phải ra đúng bản dự phòng
let fallbackData = window.WEDDING_DATA || null;

export async function loadWeddingContent({ timeoutMs = TIMEOUT_MS } = {}) {
    try {
        const data = await fetchPublished(timeoutMs);
        const problem = findMissingField(data);
        if (!problem) return { data: normalize(data), source: 'published' };
        console.warn('Bản xuất bản thiếu dữ liệu, dùng nội dung dự phòng:', problem);
    } catch (error) {
        console.warn('Không đọc được bản xuất bản, dùng nội dung dự phòng:', error.message);
    }
    return { data: normalize(await loadFallback()), source: 'fallback' };
}

async function fetchPublished(timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(PUBLISHED_URL, { signal: controller.signal, cache: 'no-store' });
        // 404: chưa xuất bản lần nào
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const doc = await response.json();
        const data = doc.fields && doc.fields.data;
        if (!data) throw new Error('doc không có field data');
        return decodeValue(data);
    } catch (error) {
        throw controller.signal.aborted ? new Error(`quá ${timeoutMs}ms`) : error;
    } finally {
        clearTimeout(timer);
    }
}

// Firestore REST trả giá trị có kiểu ({ stringValue }, { mapValue: { fields } }...) -> JS thường.
function decodeValue(value) {
    if ('mapValue' in value) {
        const fields = value.mapValue.fields || {};
        return Object.fromEntries(Object.entries(fields).map(([key, v]) => [key, decodeValue(v)]));
    }
    if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue);
    if ('integerValue' in value) return Number(value.integerValue);
    if ('doubleValue' in value) return Number(value.doubleValue);
    if ('nullValue' in value) return null;
    if ('stringValue' in value) return value.stringValue;
    if ('booleanValue' in value) return value.booleanValue;
    if ('timestampValue' in value) return value.timestampValue;
    return undefined;
}

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// Bản xuất bản hợp lệ (CLAUDE.md mục 6): chỉ cần tên ngắn hai bên, ngày cưới và mỗi sự kiện có
// key/title/startISO. Mảng được rỗng; field khác thiếu thì normalize() điền mặc định.
// Trả tên field hỏng đầu tiên, hoặc null nếu hợp lệ.
function findMissingField(data) {
    const isText = v => typeof v === 'string' && v.trim() !== '';
    const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
    const checks = [
        ['data', () => isObject(data)],
        ['couple.groom.shortName', () => isText(data.couple.groom.shortName)],
        ['couple.bride.shortName', () => isText(data.couple.bride.shortName)],
        ['wedding.dateISO', () => isDate(data.wedding.dateISO)],
        ['events', () => data.events == null || (Array.isArray(data.events) && data.events.every(e =>
            isObject(e) && isText(e.key) && isText(e.title) && isDate(e.startISO)))]
    ];
    for (const [field, ok] of checks) {
        try {
            if (!ok()) return field;
        } catch {
            return field;
        }
    }
    return null;
}

// URL trong dữ liệu chỉ https:/http: hoặc đường dẫn tương đối (C6); giá trị khác -> '' (không hiển thị).
// Parse như trình duyệt (bỏ khoảng trắng, tab trong scheme...) nên "java\tscript:" cũng bị chặn.
// URL thật không chứa nháy, \, <>, ký tự điều khiển; có thì là chuỗi định thoát khỏi thuộc tính/CSS.
function safeUrl(value) {
    if (typeof value !== 'string' || !value.trim() || /["'`<>\\\u0000-\u001f]/.test(value.trim())) return '';
    try {
        return ['https:', 'http:'].includes(new URL(value, 'https://relative.invalid/').protocol) ? value.trim() : '';
    } catch {
        return '';
    }
}

// Đưa dữ liệu về đúng shape WEDDING_DATA mà thiệp đọc: field thiếu/sai kiểu -> mặc định rỗng,
// URL và mã màu sai -> bỏ. Giữ nguyên field lạ. Không sửa object gốc.
function normalize(source) {
    const data = JSON.parse(JSON.stringify(source));
    const text = v => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
    const obj = v => isObject(v) ? v : {};
    const list = v => Array.isArray(v) ? v : [];
    const fill = (target, textKeys, urlKeys = []) => {
        textKeys.forEach(k => { target[k] = text(target[k]); });
        urlKeys.forEach(k => { target[k] = safeUrl(target[k]); });
        return target;
    };

    data.meta = fill(obj(data.meta), ['title', 'description'], ['previewImage', 'favicon']);
    data.couple = obj(data.couple);
    ['groom', 'bride'].forEach(side => {
        const p = data.couple[side] = fill(obj(data.couple[side]),
            ['fullName', 'shortName', 'father', 'mother', 'bio'], ['photo']);
        if (!p.fullName) p.fullName = p.shortName;
        p.facebook = safeUrl(p.facebook) || null;
    });
    data.wedding = fill(obj(data.wedding), ['dateISO', 'lunarText'], ['mainImage', 'invitationImage']);
    data.wedding.invitationText = list(data.wedding.invitationText).map(text);
    data.events = list(data.events).map(e => {
        const event = fill(obj(e), ['key', 'title', 'side', 'venue', 'address', 'startISO', 'endISO', 'lunarText', 'note'],
            ['mapUrl', 'image']);
        event.dressCode = list(event.dressCode).filter(c => typeof c === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(c));
        return event;
    });
    data.story = list(data.story).filter(isObject).map(s => fill(s, ['date', 'title', 'text'], ['image']));
    data.gallery = list(data.gallery).filter(isObject).map(g => fill(g, ['caption'], ['small', 'large']))
        .filter(g => g.small || g.large)
        .map(g => Object.assign(g, { small: g.small || g.large, large: g.large || g.small }));
    data.donate = obj(data.donate);
    ['groom', 'bride'].forEach(side => {
        data.donate[side] = fill(obj(data.donate[side]), ['bank', 'accountName', 'accountNumber', 'branch'], ['qr']);
    });
    data.music = fill(obj(data.music), ['title'], ['src']);
    data.video = isObject(data.video) && typeof data.video.youtubeId === 'string' && data.video.youtubeId
        ? data.video : null;
    return data;
}

// Trang đã nạp sẵn wedding-data.js thì dùng luôn; chưa thì nạp nó (một lần).
function loadFallback() {
    if (fallbackData) return Promise.resolve(fallbackData);
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = FALLBACK_SCRIPT;
        script.onload = () => {
            fallbackData = window.WEDDING_DATA || null;
            if (fallbackData) resolve(fallbackData);
            else reject(new Error('wedding-data.js không có WEDDING_DATA'));
        };
        script.onerror = () => reject(new Error('Không nạp được wedding-data.js'));
        document.head.appendChild(script);
    });
}
