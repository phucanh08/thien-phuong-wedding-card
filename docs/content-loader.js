// Nạp nội dung thiệp: bản đã xuất bản siteContent/published (CLAUDE.md mục 6); đọc không kịp thì bản
// xuất bản gần nhất đã lưu trên máy khách, chưa có bản lưu thì docs/wedding-data.js (dự phòng). Dùng
// cho thiệp (gốc site, docs/index.html) và khung xem trước của trang quản lý.
//
//   const { data, source } = await loadWeddingContent();  // source: 'published' | 'cached' | 'fallback'
//
// Chỉ reject khi cả wedding-data.js cũng không nạp được. Cả trang phải dùng đúng một `data` trả về,
// không trộn các nguồn. `data` đã qua normalize(): đủ shape WEDDING_DATA, URL/màu sai đã bị bỏ.
// Đọc qua Firestore REST (một fetch) thay vì SDK: không phải tải SDK trước khi vẽ thiệp, và không
// đụng instance Firestore của firebase-config.js (nối emulator chỉ được làm một lần). Mỗi lượt mở thiệp
// đọc một lần: thiệp vẽ ngay ở gốc site, không còn trang trung gian đọc trước.
import { FIREBASE_CONFIG, FIRESTORE_EMULATOR_PORT, USE_EMULATOR } from './firebase-shared.js';

const TIMEOUT_MS = 2500;
// Quá thời gian chờ thì thiệp vẽ bằng nguồn khác, nhưng request vẫn chạy tới REFRESH_FACTOR lần thời
// gian chờ để lưu bản mới cho lần sau: máy mạng chậm không bị kẹt mãi ở bản lưu cũ.
const REFRESH_FACTOR = 8;
const FALLBACK_SCRIPT = new URL('./wedding-data.js', import.meta.url).href;

const FIRESTORE_ORIGIN = USE_EMULATOR
    ? `http://127.0.0.1:${FIRESTORE_EMULATOR_PORT}`
    : 'https://firestore.googleapis.com';
// Không gắn ?key=: rules cho ai cũng get siteContent/published, khỏi phụ thuộc giới hạn của API key
const PUBLISHED_URL = `${FIRESTORE_ORIGIN}/v1/projects/${FIREBASE_CONFIG.projectId}`
    + '/databases/(default)/documents/siteContent/published';
// localStorage: bản xuất bản gần nhất đọc được { data, updateTime }
const CACHE_KEY = `weddingCard:published:${FIREBASE_CONFIG.projectId}`;

// wedding-data.js trang đã nạp sẵn, lấy lúc module chạy: trang sẽ ghi đè window.WEDDING_DATA bằng
// nội dung đang dùng, gọi lại loadWeddingContent() vẫn phải ra đúng bản dự phòng
let fallbackData = window.WEDDING_DATA || null;

export async function loadWeddingContent({ timeoutMs = TIMEOUT_MS } = {}) {
    const result = await readPublished(timeoutMs);
    if (result.status === 'published') return { data: normalize(result.data), source: 'published' };
    if (result.status === 'unreachable') {
        const cached = readCache();
        if (cached) {
            console.warn('Không đọc kịp bản xuất bản, dùng bản đã lưu trên máy:', result.reason);
            return { data: normalize(cached.data), source: 'cached' };
        }
    }
    console.warn('Không dùng được bản xuất bản, dùng nội dung dự phòng:', result.reason);
    return { data: normalize(await loadFallback()), source: 'fallback' };
}

// Kết quả đọc bản xuất bản, chờ tối đa timeoutMs:
//   { status: 'published', data, updateTime }  bản hợp lệ (đã lưu lại trên máy)
//   { status: 'missing', reason }              Firestore trả lời: chưa xuất bản / bản hỏng -> dự phòng
//   { status: 'unreachable', reason }          quá giờ, lỗi mạng, lỗi máy chủ -> bản lưu nếu có
async function readPublished(timeoutMs) {
    timeoutMs = Math.round(timeoutMs);
    let timer;
    const late = new Promise(resolve => {
        timer = setTimeout(() => resolve({ status: 'unreachable', reason: `quá ${timeoutMs}ms` }), timeoutMs);
    });
    try {
        return await Promise.race([fetchPublished(timeoutMs * REFRESH_FACTOR), late]);
    } finally {
        clearTimeout(timer);
    }
}

// Không reject. Đọc được bản hợp lệ thì lưu lên máy, kể cả khi người chờ đã thôi chờ.
async function fetchPublished(limitMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limitMs);
    try {
        const response = await fetch(PUBLISHED_URL, { signal: controller.signal, cache: 'no-store' });
        // 404: chưa xuất bản lần nào
        if (response.status === 404) return { status: 'missing', reason: 'HTTP 404' };
        if (!response.ok) return { status: 'unreachable', reason: `HTTP ${response.status}` };
        const doc = await response.json();
        const data = doc.fields && doc.fields.data ? decodeValue(doc.fields.data) : undefined;
        const problem = findMissingField(data);
        if (problem) return { status: 'missing', reason: `bản xuất bản thiếu dữ liệu: ${problem}` };
        const result = { status: 'published', data, updateTime: doc.updateTime };
        saveCache(result);
        return result;
    } catch (error) {
        return { status: 'unreachable', reason: controller.signal.aborted ? `quá ${limitMs}ms` : error.message };
    } finally {
        clearTimeout(timer);
    }
}

// ----- Lưu trên máy khách -----
// Trình duyệt chặn storage (chế độ riêng tư, cấm cookie) hoặc đầy -> coi như không có bản lưu.
// Bản xem trước của trang quản lý (window.__contentPreview, admin/content-preview.js) vẽ bản nháp:
// không đọc/ghi bản lưu của khách.
function storage(name) {
    try {
        return window.__contentPreview ? null : window[name] || null;
    } catch {
        return null;
    }
}

function readJson(store, key) {
    try {
        return store ? JSON.parse(store.getItem(key)) : null;
    } catch {
        return null;
    }
}

function writeJson(store, key, value) {
    try {
        if (store) store.setItem(key, JSON.stringify(value));
    } catch {
        // đầy / bị chặn: bỏ qua
    }
}

const timeOf = value => {
    const ms = typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isNaN(ms) ? null : ms;
};

// Bản lưu qua cùng phép kiểm hợp lệ như bản mới (normalize() chạy lúc dùng).
function readCache() {
    const cached = readJson(storage('localStorage'), CACHE_KEY);
    if (!isObject(cached) || timeOf(cached.updateTime) === null || findMissingField(cached.data)) return null;
    return cached;
}

// updateTime do Firestore đặt mỗi lần ghi published: bản đọc về cũ hơn bản đang lưu (tab khác đã lưu
// bản mới hơn) thì không đè.
function saveCache({ data, updateTime }) {
    const time = timeOf(updateTime);
    const store = storage('localStorage');
    if (time === null || !store) return;
    const cached = readCache();
    if (cached && timeOf(cached.updateTime) > time) return;
    writeJson(store, CACHE_KEY, { data, updateTime });
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
