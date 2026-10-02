// Firestore cho thiệp: chào khách theo ?code=, xác nhận tham dự (rsvp), sổ lưu bút (wishes).
// Hợp đồng dữ liệu (collection/field/kiểu/độ dài): CLAUDE.md mục C5.
// Dùng chung cho mọi phiên bản thiệp:
//  - v1: module tự gắn vào form có id cố định (#rsvp-form, #wish-form...); trang thiếu id nào thì bỏ qua phần đó.
//  - Trang khác (v2) gọi sendRsvp / sendWish và nghe hai sự kiện trên document:
//    'wedding:guest'  detail = khách theo ?code= (doc guests + code) hoặc null, phát sau khi tra xong;
//    'wedding:wishes' detail = lời chúc (mới nhất trước, tối đa WISHES_SHOWN), phát mỗi lần sổ thay đổi.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
    addDoc,
    collection,
    connectFirestoreEmulator,
    doc,
    getDoc,
    getFirestore,
    limit,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    setDoc
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { FIREBASE_CONFIG, FIRESTORE_EMULATOR_PORT, USE_EMULATOR } from './firebase-shared.js';

const GUEST_CODE_PATTERN = /^[a-z2-9]{8}$/;
const WISH_NAME_MAX = 60;
const WISH_MESSAGE_MAX = 500;
const RSVP_COUNT_MAX = 20;
export const WISHES_SHOWN = 200;
const LOOKUP_TIMEOUT_MS = 6000;
const LOOKUP_RETRY_TIMEOUT_MS = 4000;
const WRITE_TIMEOUT_MS = 8000;
const ATTENDING_BY_OPTION = { Y: 'yes', N: 'no', none: 'maybe' };
const ATTENDING_VALUES = ['yes', 'no', 'maybe'];

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
// Mở thiệp ở localhost / 127.0.0.1 thì nối Firestore emulator.
if (USE_EMULATOR) {
    connectFirestoreEmulator(db, '127.0.0.1', FIRESTORE_EMULATOR_PORT);
}

// ===== Chào khách =====
// Firestore không tới được thì get/set chờ mãi -> mọi lời gọi mạng đều có hạn chót.
function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Chỉ đọc guests/{code}. Trả { guest } (guest = null nếu code lạ/không có) hoặc { failed: true }
// khi tra cứu lỗi: "không tồn tại" và "không tra được" phải tách bạch để RSVP không ghi nhầm thành bản không mã.
async function lookupGuest(code, timeoutMs) {
    if (!code || !GUEST_CODE_PATTERN.test(code)) return { guest: null };
    try {
        const snapshot = await withTimeout(getDoc(doc(db, 'guests', code)), timeoutMs);
        return { guest: snapshot.exists() ? { code: snapshot.id, ...snapshot.data() } : null };
    } catch (error) {
        console.warn('Không đọc được thông tin khách mời:', error);
        return { failed: true };
    }
}

// Khách tra xong (hoặc tra lại được khi gửi RSVP): chào trên trang v1 rồi báo cho trang khác.
function setGuest(guest) {
    currentGuest = guest;
    if (guest) greetGuest(guest);
    document.dispatchEvent(new CustomEvent('wedding:guest', { detail: guest }));
}

// Phần chào khách của v1; phần tử nào trang không có thì bỏ qua.
function greetGuest(guest) {
    const fullName = [guest.salutation, guest.name].filter(Boolean).join(' ');
    const confirmTitle = document.getElementById('title-confirm-id');
    if (confirmTitle) {
        confirmTitle.textContent =
            `Trân trọng kính mời ${fullName} đến tham dự buổi tiệc chung vui cùng gia đình chúng tôi!`;
    }
    // Lời mời đích danh ngay trên thân thiệp (mục Lời ngỏ); không có tên thì giữ lời mời chung.
    const cardGreeting = document.getElementById('invitation-guest');
    if (cardGreeting && fullName) {
        cardGreeting.textContent = `Trân trọng kính mời ${fullName}`;
        cardGreeting.hidden = false;
    }

    const rsvpName = document.getElementById('guest-name');
    if (rsvpName && !rsvpName.value.trim()) rsvpName.value = (guest.name || '').slice(0, WISH_NAME_MAX);
    const wishName = document.getElementById('name-comment');
    if (wishName && !wishName.value.trim()) wishName.value = (guest.name || '').slice(0, WISH_NAME_MAX);

    // Khách có danh sách sự kiện được mời: chỉ hiện các sự kiện đó, chọn sẵn.
    // Danh sách không khớp sự kiện nào (dữ liệu sai) thì giữ nguyên, hiện tất cả sự kiện.
    const invited = Array.isArray(guest.invitedEvents) ? guest.invitedEvents : [];
    const choices = Array.from(document.querySelectorAll('#rsvp-form input[name="events"]'));
    if (choices.some(input => invited.includes(input.value))) {
        choices.forEach(input => {
            const isInvited = invited.includes(input.value);
            input.checked = isInvited;
            // Nhãn có class d-flex (display:flex !important) nên ẩn phải kèm !important mới thắng.
            const choice = input.closest('.rsvp-event-choice');
            if (isInvited) choice.style.removeProperty('display');
            else choice.style.setProperty('display', 'none', 'important');
        });
    }
    if (typeof validateSendConfirmBtn === 'function') validateSendConfirmBtn();
}

// ===== Xác nhận tham dự =====
function showRsvpMessage(form, type, text) {
    const success = form.querySelector('.message-success');
    const error = form.querySelector('.message-error');
    success.style.display = type === 'success' ? '' : 'none';
    error.style.display = type === 'error' ? '' : 'none';
    (type === 'success' ? success : error).querySelector('span').textContent = text;
}

// Kiểm rồi ghi một bản xác nhận (C5). Trả { ok, message } để trang tự hiện thông báo.
// onSending: gọi ngay trước khi ghi (đã qua kiểm tra), để trang khoá nút gửi.
export async function sendRsvp({ name, attending, count, events }, onSending) {
    await guestReady;
    if (rsvpAnonymousSent) return { ok: true, message: 'Bạn đã xác nhận rồi, cảm ơn bạn!' };
    name = (name || '').trim();
    if (!name || !ATTENDING_VALUES.includes(attending)) {
        return { ok: false, message: 'Vui lòng nhập tên và cho chúng tôi biết bạn có tham dự không.' };
    }
    if (name.length > WISH_NAME_MAX) return { ok: false, message: `Tên tối đa ${WISH_NAME_MAX} ký tự.` };
    if (attending !== 'yes') count = 0;
    else if (!(Number.isInteger(count) && count >= 1 && count <= RSVP_COUNT_MAX)) {
        return { ok: false, message: 'Vui lòng chọn số người đi cùng.' };
    }
    events = attending === 'no' || !Array.isArray(events) ? [] : events;

    if (onSending) onSending();
    try {
        // Lần tra đầu lỗi: thử lại; vẫn lỗi thì báo khách chứ không ghi bản không mã.
        if (guestLookupFailed) {
            const retry = await lookupGuest(guestId, LOOKUP_RETRY_TIMEOUT_MS);
            if (retry.failed) {
                return { ok: false, message: 'Không kết nối được máy chủ, bạn vui lòng thử lại sau ít phút.' };
            }
            guestLookupFailed = false;
            setGuest(retry.guest);
        }
        await writeRsvp(name, attending, count, events);
        return { ok: true, message: 'Cảm ơn bạn đã xác nhận, hẹn gặp bạn trong ngày vui!' };
    } catch (error) {
        console.error('Không gửi được xác nhận tham dự:', error);
        return { ok: false, message: 'Có lỗi xảy ra, bạn vui lòng thử lại.' };
    }
}

async function writeRsvp(name, attending, count, events) {
    const data = {
        code: currentGuest ? currentGuest.code : null,
        name,
        attending,
        count,
        events,
        updatedAt: serverTimestamp()
    };

    // Khách có code: một doc rsvp/{code}, gửi lại thì ghi đè. Khách không có code: một doc mới
    // (ref giữ lại để thử lại sau timeout không đẻ thêm doc), và chỉ gửi được một lần (rules chỉ cho create).
    const ref = currentGuest ? doc(db, 'rsvp', currentGuest.code) : (anonymousRsvpRef ||= doc(collection(db, 'rsvp')));
    await withTimeout(setDoc(ref, data), WRITE_TIMEOUT_MS);
    if (!currentGuest) rsvpAnonymousSent = true;
}

// Form RSVP của v1
async function submitRsvpForm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    await guestReady;
    let sending = false;
    const result = await sendRsvp({
        name: document.getElementById('guest-name').value,
        attending: ATTENDING_BY_OPTION[document.getElementById('attendance_status_id').value],
        count: parseInt(document.getElementById('plus_ones_id').value, 10),
        events: Array.from(form.querySelectorAll('input[name="events"]:checked'), input => input.value)
    }, () => {
        sending = true;
        document.getElementById('send-confirm-btn').disabled = true;
    });
    showRsvpMessage(form, result.ok ? 'success' : 'error', result.message);
    if (sending) validateSendConfirmBtn();
}

// ===== Sổ lưu bút =====
function showWishNote(text) {
    const note = document.getElementById('wish-form-note');
    note.textContent = text;
    note.style.display = text ? '' : 'none';
}

// Kiểm rồi ghi một lời chúc (C5). Trả { ok, message }; onSending như sendRsvp.
export async function sendWish({ name, message }, onSending) {
    await guestReady;
    name = (name || '').trim();
    message = (message || '').trim();
    if (!name) return { ok: false, message: 'Vui lòng nhập tên của bạn.' };
    if (name.length > WISH_NAME_MAX) return { ok: false, message: `Tên tối đa ${WISH_NAME_MAX} ký tự.` };
    if (!message) return { ok: false, message: 'Vui lòng nhập lời chúc.' };
    if (message.length > WISH_MESSAGE_MAX) return { ok: false, message: `Lời chúc tối đa ${WISH_MESSAGE_MAX} ký tự.` };

    if (onSending) onSending();
    try {
        await withTimeout(addDoc(collection(db, 'wishes'), {
            name,
            message,
            code: currentGuest ? currentGuest.code : null,
            createdAt: serverTimestamp()
        }), WRITE_TIMEOUT_MS);
        return { ok: true, message: 'Cảm ơn bạn đã gửi lời chúc!' };
    } catch (error) {
        console.error('Không gửi được lời chúc:', error);
        return { ok: false, message: 'Có lỗi xảy ra, bạn vui lòng thử lại.' };
    }
}

// Form lời chúc của v1
async function submitWishForm(event) {
    event.preventDefault();
    await guestReady;
    const success = document.getElementById('success');
    success.style.display = 'none';

    const button = document.getElementById('btn-submit-comment');
    let sending = false;
    const result = await sendWish({
        name: document.getElementById('name-comment').value,
        message: document.getElementById('detail-comment').value
    }, () => {
        sending = true;
        showWishNote('');
        button.disabled = true;
    });
    if (sending) button.disabled = false;
    if (!result.ok) return showWishNote(result.message);
    document.getElementById('detail-comment').value = '';
    success.textContent = result.message;
    success.style.display = 'block';
}

// Sổ lưu bút của v1
function renderWishes(wishes) {
    const list = document.getElementById('show-comments');
    if (!list) return;
    list.replaceChildren(...wishes.map(wish => {
        const item = document.createElement('div');
        item.className = 'box-comment pb-3';
        const name = document.createElement('h4');
        name.className = 'mt-1';
        name.textContent = wish.name;
        const message = document.createElement('pre');
        message.className = 'm-0';
        message.style.cssText = 'white-space:pre-wrap;word-wrap:break-word;overflow:hidden;font-family:inherit';
        message.textContent = wish.message;
        item.append(name, message);
        return item;
    }));
}

function listenWishes() {
    const wishesQuery = query(collection(db, 'wishes'), orderBy('createdAt', 'desc'), limit(WISHES_SHOWN));
    onSnapshot(wishesQuery,
        snapshot => {
            const wishes = snapshot.docs.map(wishDoc => ({ id: wishDoc.id, ...wishDoc.data() }));
            renderWishes(wishes);
            document.dispatchEvent(new CustomEvent('wedding:wishes', { detail: wishes }));
        },
        error => console.warn('Không tải được sổ lưu bút:', error));
}

// ===== Khởi động =====
// Form gửi trước khi tra xong khách vẫn phải gắn đúng code -> các handler chờ guestReady.
const guestId = (new URLSearchParams(location.search).get('code') || '').trim().toLowerCase() || null;
let currentGuest = null;
let guestLookupFailed = false;
let anonymousRsvpRef = null;
let rsvpAnonymousSent = false;
const guestReady = lookupGuest(guestId, LOOKUP_TIMEOUT_MS).then(result => {
    guestLookupFailed = Boolean(result.failed);
    setGuest(result.guest || null);
});
document.getElementById('rsvp-form')?.addEventListener('submit', submitRsvpForm);
document.getElementById('wish-form')?.addEventListener('submit', submitWishForm);
window.weddingFirestoreReady = true;

listenWishes();
