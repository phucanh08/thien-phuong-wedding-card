// Nạp nội dung thiệp: bản đã xuất bản siteContent/published (CLAUDE.md mục 6), không được thì
// dùng docs/wedding-data.js (dự phòng). Dùng chung cho mọi phiên bản thiệp (/v1/, /v2/...).
//
//   const { data, source } = await loadWeddingContent();  // source: 'published' | 'fallback'
//
// Chỉ reject khi cả wedding-data.js cũng không nạp được. Cả trang phải dùng đúng một `data` trả về,
// không trộn hai nguồn.
// Đọc qua Firestore REST (một fetch) thay vì SDK: không phải tải SDK trước khi vẽ thiệp, và không
// đụng instance Firestore của firebase-config.js (nối emulator chỉ được làm một lần).
import { FIREBASE_CONFIG, FIRESTORE_EMULATOR_PORT, USE_EMULATOR } from './firebase-shared.js';

const TIMEOUT_MS = 2500;
const FALLBACK_SCRIPT = new URL('./wedding-data.js', import.meta.url).href;

const FIRESTORE_ORIGIN = USE_EMULATOR
    ? `http://127.0.0.1:${FIRESTORE_EMULATOR_PORT}`
    : 'https://firestore.googleapis.com';
const PUBLISHED_URL = `${FIRESTORE_ORIGIN}/v1/projects/${FIREBASE_CONFIG.projectId}`
    + `/databases/(default)/documents/siteContent/published?key=${FIREBASE_CONFIG.apiKey}`;

export async function loadWeddingContent({ timeoutMs = TIMEOUT_MS } = {}) {
    try {
        const data = await fetchPublished(timeoutMs);
        const problem = findMissingField(data);
        if (!problem) return { data, source: 'published' };
        console.warn('Bản xuất bản thiếu dữ liệu, dùng nội dung dự phòng:', problem);
    } catch (error) {
        console.warn('Không đọc được bản xuất bản, dùng nội dung dự phòng:', error.message);
    }
    return { data: await loadFallback(), source: 'fallback' };
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

// Field bắt buộc của shape WEDDING_DATA (C2): những gì thiệp đọc mà không có giá trị thay thế.
// Field tuỳ chọn chỉ kiểm kiểu khi thiệp duyệt qua nó (invitationText, dressCode là mảng; video có
// youtubeId); facebook, mainImage, note, caption, featured, branch... không kiểm.
// Trả tên field hỏng đầu tiên, hoặc null nếu hợp lệ.
function findMissingField(data) {
    const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
    const isText = v => typeof v === 'string';
    const isDate = v => isText(v) && /^\d{4}-\d{2}-\d{2}/.test(v);
    const optionalList = v => v == null || (Array.isArray(v) && v.every(isText));
    const checks = [
        ['data', () => isObject(data)],
        ['meta', () => ['title', 'description', 'previewImage', 'favicon'].every(k => isText(data.meta[k]))],
        ...['groom', 'bride'].map(side => [`couple.${side}`, () =>
            ['fullName', 'shortName', 'photo', 'father', 'mother', 'bio'].every(k => isText(data.couple[side][k]))]),
        ['wedding.dateISO', () => isDate(data.wedding.dateISO)],
        ['wedding.invitationText', () => optionalList(data.wedding.invitationText)],
        ['events', () => data.events.length > 0 && data.events.every(e =>
            ['key', 'title', 'side', 'venue', 'address', 'mapUrl', 'image'].every(k => isText(e[k]))
            && isDate(e.startISO) && isDate(e.endISO) && optionalList(e.dressCode))],
        ['story', () => Array.isArray(data.story) && data.story.every(s =>
            ['date', 'title', 'text'].every(k => isText(s[k])))],
        ['gallery', () => data.gallery.length > 0 && data.gallery.every(g => isText(g.small) && isText(g.large))],
        ...['groom', 'bride'].map(side => [`donate.${side}`, () =>
            ['bank', 'accountName', 'accountNumber', 'qr'].every(k => isText(data.donate[side][k]))]),
        ['music.src', () => isText(data.music.src)],
        ['video', () => data.video == null || isText(data.video.youtubeId)]
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

// Trang đã nạp sẵn wedding-data.js thì dùng luôn; chưa thì nạp nó.
function loadFallback() {
    if (window.WEDDING_DATA) return Promise.resolve(window.WEDDING_DATA);
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = FALLBACK_SCRIPT;
        script.onload = () => resolve(window.WEDDING_DATA);
        script.onerror = () => reject(new Error('Không nạp được wedding-data.js'));
        document.head.appendChild(script);
    });
}
