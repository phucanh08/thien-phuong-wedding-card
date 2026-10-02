// Firestore cho thiệp: chào khách theo ?code=, xác nhận tham dự (rsvp), sổ lưu bút (wishes).
// Hợp đồng dữ liệu (collection/field/kiểu/độ dài): CLAUDE.md mục C5.
// Dùng biến toàn cục guestId / currentGuest / rsvpData khai báo ở đầu index.html.
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

// Web config là public by design; quyền nằm ở firestore.rules.
const firebaseConfig = {
    apiKey: 'AIzaSyCbKOo2igl5jHWg791u_5wBHpF9ugqeFwo',
    authDomain: 'thien-phuong-wedding-1025.firebaseapp.com',
    projectId: 'thien-phuong-wedding-1025',
    storageBucket: 'thien-phuong-wedding-1025.firebasestorage.app',
    messagingSenderId: '630659527776',
    appId: '1:630659527776:web:c42178613083d09f34ff05'
};

// Mở thiệp ở localhost / 127.0.0.1 thì nối Firestore emulator, không chạm dữ liệu thật.
const FIRESTORE_EMULATOR = { host: '127.0.0.1', port: 8282 };

const GUEST_CODE_PATTERN = /^[a-z2-9]{8}$/;
const WISH_NAME_MAX = 60;
const WISH_MESSAGE_MAX = 500;
const RSVP_COUNT_MAX = 20;
const WISHES_SHOWN = 200;
const LOOKUP_TIMEOUT_MS = 6000;
const LOOKUP_RETRY_TIMEOUT_MS = 4000;
const WRITE_TIMEOUT_MS = 8000;
const ATTENDING_BY_OPTION = { Y: 'yes', N: 'no', none: 'maybe' };

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    connectFirestoreEmulator(db, FIRESTORE_EMULATOR.host, FIRESTORE_EMULATOR.port);
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

function greetGuest(guest) {
    const fullName = [guest.salutation, guest.name].filter(Boolean).join(' ');
    document.getElementById('title-confirm-id').textContent =
        `Trân trọng kính mời ${fullName} đến tham dự buổi tiệc chung vui cùng gia đình chúng tôi!`;

    const rsvpName = document.getElementById('guest-name');
    if (!rsvpName.value.trim()) rsvpName.value = guest.name || '';
    const wishName = document.getElementById('name-comment');
    if (!wishName.value.trim()) wishName.value = (guest.name || '').slice(0, WISH_NAME_MAX);

    // Khách có danh sách sự kiện được mời: chỉ hiện các sự kiện đó, chọn sẵn.
    // Danh sách không khớp sự kiện nào (dữ liệu sai) thì giữ nguyên, hiện tất cả sự kiện.
    const invited = Array.isArray(guest.invitedEvents) ? guest.invitedEvents : [];
    const choices = Array.from(document.querySelectorAll('#rsvp-form input[name="events"]'));
    if (choices.some(input => invited.includes(input.value))) {
        choices.forEach(input => {
            const isInvited = invited.includes(input.value);
            input.checked = isInvited;
            input.closest('.rsvp-event-choice').style.display = isInvited ? '' : 'none';
        });
    }
    validateSendConfirmBtn();
}

// ===== Xác nhận tham dự =====
function showRsvpMessage(form, type, text) {
    const success = form.querySelector('.message-success');
    const error = form.querySelector('.message-error');
    success.style.display = type === 'success' ? '' : 'none';
    error.style.display = type === 'error' ? '' : 'none';
    (type === 'success' ? success : error).querySelector('span').textContent = text;
}

async function submitRsvp(event) {
    event.preventDefault();
    const form = event.currentTarget;
    await guestReady;
    if (rsvpAnonymousSent) {
        showRsvpMessage(form, 'success', 'Bạn đã xác nhận rồi, cảm ơn bạn!');
        return;
    }
    const name = document.getElementById('guest-name').value.trim();
    const attending = ATTENDING_BY_OPTION[document.getElementById('attendance_status_id').value];
    if (!name || !attending) {
        showRsvpMessage(form, 'error', 'Vui lòng nhập tên và cho chúng tôi biết bạn có tham dự không.');
        return;
    }

    const count = attending === 'yes' ? parseInt(document.getElementById('plus_ones_id').value, 10) : 0;
    if (attending === 'yes' && !(count >= 1 && count <= RSVP_COUNT_MAX)) {
        showRsvpMessage(form, 'error', 'Vui lòng chọn số người đi cùng.');
        return;
    }
    const events = attending === 'no' ? [] :
        Array.from(form.querySelectorAll('input[name="events"]:checked'), input => input.value);

    const button = document.getElementById('send-confirm-btn');
    button.disabled = true;
    try {
        // Lần tra đầu lỗi: thử lại; vẫn lỗi thì báo khách chứ không ghi bản không mã.
        if (guestLookupFailed) {
            const retry = await lookupGuest(guestId, LOOKUP_RETRY_TIMEOUT_MS);
            if (retry.failed) {
                showRsvpMessage(form, 'error', 'Không kết nối được máy chủ, bạn vui lòng thử lại sau ít phút.');
                return;
            }
            guestLookupFailed = false;
            currentGuest = retry.guest;
            if (currentGuest) greetGuest(currentGuest);
        }
        await writeRsvp(form, name, attending, count, events);
    } catch (error) {
        console.error('Không gửi được xác nhận tham dự:', error);
        showRsvpMessage(form, 'error', 'Có lỗi xảy ra, bạn vui lòng thử lại.');
    } finally {
        validateSendConfirmBtn();
    }
}

async function writeRsvp(form, name, attending, count, events) {
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
    rsvpData = data;
    showRsvpMessage(form, 'success', 'Cảm ơn bạn đã xác nhận, hẹn gặp bạn trong ngày vui!');
}

// ===== Sổ lưu bút =====
function showWishNote(text) {
    const note = document.getElementById('wish-form-note');
    note.textContent = text;
    note.style.display = text ? '' : 'none';
}

async function submitWish(event) {
    event.preventDefault();
    await guestReady;
    const success = document.getElementById('success');
    success.style.display = 'none';

    const name = document.getElementById('name-comment').value.trim();
    const message = document.getElementById('detail-comment').value.trim();
    if (!name) return showWishNote('Vui lòng nhập tên của bạn.');
    if (name.length > WISH_NAME_MAX) return showWishNote(`Tên tối đa ${WISH_NAME_MAX} ký tự.`);
    if (!message) return showWishNote('Vui lòng nhập lời chúc.');
    if (message.length > WISH_MESSAGE_MAX) return showWishNote(`Lời chúc tối đa ${WISH_MESSAGE_MAX} ký tự.`);
    showWishNote('');

    const button = document.getElementById('btn-submit-comment');
    button.disabled = true;
    try {
        await withTimeout(addDoc(collection(db, 'wishes'), {
            name,
            message,
            code: currentGuest ? currentGuest.code : null,
            createdAt: serverTimestamp()
        }), WRITE_TIMEOUT_MS);
        document.getElementById('detail-comment').value = '';
        success.textContent = 'Cảm ơn bạn đã gửi lời chúc!';
        success.style.display = 'block';
    } catch (error) {
        console.error('Không gửi được lời chúc:', error);
        showWishNote('Có lỗi xảy ra, bạn vui lòng thử lại.');
    } finally {
        button.disabled = false;
    }
}

function renderWishes(wishes) {
    const list = document.getElementById('show-comments');
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
        snapshot => renderWishes(snapshot.docs.map(wishDoc => wishDoc.data())),
        error => console.warn('Không tải được sổ lưu bút:', error));
}

// ===== Khởi động =====
// Form gửi trước khi tra xong khách vẫn phải gắn đúng code -> các handler chờ guestReady.
guestId = guestId ? guestId.trim().toLowerCase() : null;
let guestLookupFailed = false;
let anonymousRsvpRef = null;
let rsvpAnonymousSent = false;
const guestReady = lookupGuest(guestId, LOOKUP_TIMEOUT_MS).then(result => {
    guestLookupFailed = Boolean(result.failed);
    currentGuest = result.guest || null;
    if (currentGuest) greetGuest(currentGuest);
});
document.getElementById('rsvp-form').addEventListener('submit', submitRsvp);
document.getElementById('wish-form').addEventListener('submit', submitWish);
window.weddingFirestoreReady = true;

listenWishes();
