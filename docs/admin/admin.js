// Trang quản lý thiệp cưới — đăng nhập và phân quyền theo hợp đồng C5 trong CLAUDE.md.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, initializeAuth, inMemoryPersistence, connectAuthEmulator,
  onAuthStateChanged, signInWithPopup, GoogleAuthProvider,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword, signOut,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc,
  collection, onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// Web config là public theo thiết kế của Firebase; quyền nằm ở firestore.rules.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCbKOo2igl5jHWg791u_5wBHpF9ugqeFwo",
  authDomain: "thien-phuong-wedding-1025.firebaseapp.com",
  projectId: "thien-phuong-wedding-1025",
  storageBucket: "thien-phuong-wedding-1025.firebasestorage.app",
  messagingSenderId: "630659527776",
  appId: "1:630659527776:web:c42178613083d09f34ff05",
};

// Chạy trên localhost/127.0.0.1 thì dùng emulator, không bao giờ chạm Firebase thật.
const EMULATOR_HOSTS = ["localhost", "127.0.0.1"];
const AUTH_EMULATOR_PORT = 9199;
const FIRESTORE_EMULATOR_PORT = 8282;
const USE_EMULATOR = EMULATOR_HOSTS.includes(location.hostname);

const USERNAME_DOMAIN = "thien-phuong-wedding.local";
const USERNAME_PATTERN = /^[a-z0-9._-]{3,30}$/;
const SUPER_ADMIN_GOOGLE_EMAIL = "phucanhdn01@gmail.com";
const SUPER_ADMIN_PASSWORD_EMAIL = `admin@${USERNAME_DOMAIN}`;
const MIN_PASSWORD_LENGTH = 8;
const SECTIONS = ["khach-moi", "xac-nhan", "thong-ke", "quan-tri"];

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);
if (USE_EMULATOR) {
  connectAuthEmulator(auth, `http://${location.hostname}:${AUTH_EMULATOR_PORT}`, { disableWarnings: true });
  connectFirestoreEmulator(db, location.hostname, FIRESTORE_EMULATOR_PORT);
}

// App phụ chỉ để tạo user mới: createUser tự đăng nhập user đó trên app phụ,
// nên admin trên app chính không bị đăng xuất.
let creatorAuth = null;
function getCreatorAuth() {
  if (!creatorAuth) {
    const creatorApp = initializeApp(FIREBASE_CONFIG, "account-creator");
    creatorAuth = initializeAuth(creatorApp, { persistence: inMemoryPersistence });
    if (USE_EMULATOR) {
      connectAuthEmulator(creatorAuth, `http://${location.hostname}:${AUTH_EMULATOR_PORT}`, { disableWarnings: true });
    }
  }
  return creatorAuth;
}

const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  access: null,        // doc accessRequests/{uid} hoặc null
  unsubscribeRequests: null,
};

// ---------- Tiện ích ----------

function usernameToEmail(username) {
  return `${username}@${USERNAME_DOMAIN}`;
}

function emailToUsername(email) {
  const suffix = `@${USERNAME_DOMAIN}`;
  return email && email.endsWith(suffix) ? email.slice(0, -suffix.length) : null;
}

function providerOf(user) {
  return user.providerData.some((p) => p.providerId === "password") ? "password" : "google";
}

function isSuperAdmin(user) {
  return (user.email === SUPER_ADMIN_GOOGLE_EMAIL && user.emailVerified)
    || user.email === SUPER_ADMIN_PASSWORD_EMAIL;
}

function accountLabel(user) {
  return emailToUsername(user.email) || user.email || user.uid;
}

function showView(id) {
  for (const view of document.querySelectorAll(".view")) {
    view.hidden = view.id !== id;
  }
}

function showMessage(el, text, kind = "danger") {
  el.textContent = text;
  el.className = `alert alert-${kind} py-2 small`;
  el.hidden = !text;
}

function setBusy(button, busy) {
  button.disabled = busy;
}

function authErrorMessage(error) {
  switch (error && error.code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-email":
      return "Tên đăng nhập hoặc mật khẩu không đúng.";
    case "auth/too-many-requests":
      return "Thử sai quá nhiều lần. Vui lòng đợi một lúc rồi thử lại.";
    case "auth/popup-blocked":
      return "Trình duyệt chặn cửa sổ đăng nhập Google. Hãy cho phép popup rồi thử lại.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "";
    case "auth/network-request-failed":
      return "Không kết nối được. Kiểm tra mạng rồi thử lại.";
    case "auth/weak-password":
      return `Mật khẩu quá yếu (ít nhất ${MIN_PASSWORD_LENGTH} ký tự).`;
    case "auth/email-already-in-use":
      return "Tên đăng nhập này đã tồn tại.";
    case "auth/requires-recent-login":
      return "Phiên đăng nhập đã cũ. Hãy đăng xuất rồi đăng nhập lại.";
    case "permission-denied":
      return "Không có quyền thực hiện thao tác này.";
    default:
      return "Có lỗi xảy ra. Vui lòng thử lại.";
  }
}

function formatTime(ts) {
  if (!ts || typeof ts.toDate !== "function") return "";
  return ts.toDate().toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

// ---------- Xác định quyền truy cập ----------

function accessRef(uid) {
  return doc(db, "accessRequests", uid);
}

async function createPendingRequest(user) {
  const provider = providerOf(user);
  const data = {
    email: user.email || "",
    displayName: user.displayName || "",
    provider,
    status: "pending",
    mustChangePassword: false,
    requestedAt: serverTimestamp(),
  };
  if (provider === "password") data.username = emailToUsername(user.email) || "";
  await setDoc(accessRef(user.uid), data);
  return data;
}

async function resolveAccess(user) {
  showView("view-loading");
  const snap = await getDoc(accessRef(user.uid));
  state.access = snap.exists() ? snap.data() : null;

  const superAdmin = isSuperAdmin(user);
  const provider = providerOf(user);

  // Mật khẩu tạm (do admin cấp) hoặc super admin mật khẩu chưa có doc → phải đổi mật khẩu trước.
  if (provider === "password") {
    const mustChange = state.access ? state.access.mustChangePassword === true : superAdmin;
    if (mustChange) return showChangePassword(user);
  }

  if (superAdmin) return enterApp(user);

  if (!state.access) state.access = await createPendingRequest(user);

  if (state.access.status === "approved") return enterApp(user);
  return showPending(user, state.access.status);
}

function showPending(user, status) {
  const rejected = status === "rejected";
  $("pending-icon").textContent = rejected ? "⛔" : "⏳";
  $("pending-title").textContent = rejected ? "Yêu cầu truy cập bị từ chối" : "Tài khoản đang chờ duyệt";
  $("pending-text").textContent = rejected
    ? "Quản trị viên đã từ chối yêu cầu truy cập của tài khoản này. Liên hệ cô dâu chú rể nếu cần được cấp quyền."
    : "Yêu cầu truy cập đã được gửi. Khi quản trị viên duyệt, hãy tải lại trang để vào trang quản lý.";
  $("pending-account").textContent = accountLabel(user);
  $("btn-recheck").hidden = rejected;
  showView("view-pending");
}

function showChangePassword(user) {
  $("change-account").textContent = accountLabel(user);
  $("form-change-password").reset();
  showMessage($("change-error"), "");
  showView("view-change-password");
}

// ---------- Khung trang quản lý ----------

function enterApp(user) {
  $("app-account").textContent = accountLabel(user);
  showView("view-app");
  showSection();
  subscribeRequests();
}

function currentSection() {
  const hash = location.hash.replace("#", "");
  return SECTIONS.includes(hash) ? hash : SECTIONS[0];
}

function showSection() {
  const section = currentSection();
  for (const link of document.querySelectorAll(".app-nav a")) {
    const active = link.dataset.section === section;
    link.classList.toggle("active", active);
    if (active) {
      link.setAttribute("aria-current", "page");
      // Trên điện thoại thanh điều hướng cuộn ngang: kéo mục đang mở vào tầm nhìn.
      link.scrollIntoView({ block: "nearest", inline: "nearest" });
    } else {
      link.removeAttribute("aria-current");
    }
  }
  for (const panel of document.querySelectorAll("[data-panel]")) {
    panel.hidden = panel.dataset.panel !== section;
  }
}

window.addEventListener("hashchange", () => {
  if (!$("view-app").hidden) showSection();
});

// ---------- Quản trị viên ----------

const STATUS_LABEL = {
  pending: ["Chờ duyệt", "text-bg-warning"],
  approved: ["Đã duyệt", "text-bg-success"],
  rejected: ["Từ chối", "text-bg-secondary"],
};
const STATUS_ORDER = { pending: 0, approved: 1, rejected: 2 };

function subscribeRequests() {
  if (state.unsubscribeRequests) return;
  state.unsubscribeRequests = onSnapshot(
    collection(db, "accessRequests"),
    (snapshot) => {
      showMessage($("requests-error"), "");
      const items = snapshot.docs.map((d) => ({ uid: d.id, ...d.data() }));
      items.sort((a, b) =>
        (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
        || (b.requestedAt?.toMillis?.() ?? 0) - (a.requestedAt?.toMillis?.() ?? 0));
      renderRequests(items);
    },
    (error) => showMessage($("requests-error"), `Không tải được danh sách: ${authErrorMessage(error)}`),
  );
}

function unsubscribeRequests() {
  if (state.unsubscribeRequests) state.unsubscribeRequests();
  state.unsubscribeRequests = null;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function actionButton(label, className, onClick) {
  const button = el("button", `btn btn-sm ${className}`, label);
  button.type = "button";
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await onClick();
    } catch (error) {
      showMessage($("requests-error"), authErrorMessage(error));
      button.disabled = false;
    }
  });
  return button;
}

function renderRequests(items) {
  const list = $("requests-list");
  list.replaceChildren();

  const pending = items.filter((i) => i.status === "pending").length;
  $("pending-badge").textContent = String(pending);
  $("pending-badge").hidden = pending === 0;
  $("requests-count").textContent = items.length ? `${items.length} tài khoản · ${pending} chờ duyệt` : "";

  if (!items.length) {
    list.append(el("p", "text-secondary small mb-0", "Chưa có yêu cầu truy cập nào."));
    return;
  }

  for (const item of items) {
    const row = el("div", "request-item");
    row.dataset.uid = item.uid;
    row.dataset.status = item.status;

    const info = el("div", "request-info");
    const title = el("div", "name", item.displayName || item.username || item.email || item.uid);
    const [label, badgeClass] = STATUS_LABEL[item.status] || [item.status, "text-bg-light"];
    title.append(" ", el("span", `badge ${badgeClass} align-middle`, label));
    info.append(title);

    const account = item.provider === "password"
      ? `Tên đăng nhập: ${item.username || emailToUsername(item.email) || "?"}`
      : `Google: ${item.email}`;
    const extras = [account];
    if (item.mustChangePassword) extras.push("chưa đổi mật khẩu tạm");
    if (item.requestedAt) extras.push(`gửi ${formatTime(item.requestedAt)}`);
    if (item.decidedBy) extras.push(`xử lý bởi ${emailToUsername(item.decidedBy) || item.decidedBy}`);
    info.append(el("div", "meta", extras.join(" · ")));
    row.append(info);

    // Không tự xử lý chính mình; super admin không phụ thuộc doc nên cũng không có nút.
    const isSelf = state.user && item.uid === state.user.uid;
    const isSuper = item.email === SUPER_ADMIN_PASSWORD_EMAIL || item.email === SUPER_ADMIN_GOOGLE_EMAIL;
    if (!isSelf && !isSuper) {
      const actions = el("div", "request-actions");
      if (item.status !== "approved") {
        actions.append(actionButton(item.status === "rejected" ? "Duyệt lại" : "Duyệt", "btn-success",
          () => decide(item.uid, "approved")));
      }
      if (item.status === "pending") {
        actions.append(actionButton("Từ chối", "btn-outline-danger", () => decide(item.uid, "rejected")));
      }
      if (item.status === "approved") {
        actions.append(actionButton("Thu hồi quyền", "btn-outline-danger", () => {
          if (!confirm("Thu hồi quyền truy cập của tài khoản này?")) return Promise.resolve();
          return decide(item.uid, "rejected");
        }));
      }
      row.append(actions);
    }
    list.append(row);
  }
}

function decide(uid, status) {
  return updateDoc(accessRef(uid), {
    status,
    decidedAt: serverTimestamp(),
    decidedBy: state.user.email,
  });
}

function randomPassword() {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

$("btn-generate").addEventListener("click", () => {
  $("create-password").value = randomPassword();
});

$("form-create").addEventListener("submit", async (event) => {
  event.preventDefault();
  const result = $("create-result");
  const username = $("create-username").value.trim().toLowerCase();
  const displayName = $("create-name").value.trim();
  const password = $("create-password").value;

  if (!USERNAME_PATTERN.test(username)) {
    return showMessage(result, "Tên đăng nhập 3–30 ký tự, chỉ gồm a–z, 0–9 và dấu . _ -");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return showMessage(result, `Mật khẩu tạm cần ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`);
  }

  const button = $("btn-create");
  setBusy(button, true);
  showMessage(result, "");
  const creator = getCreatorAuth();
  try {
    const email = usernameToEmail(username);
    const credential = await createUserWithEmailAndPassword(creator, email, password);
    if (displayName) await updateProfile(credential.user, { displayName });
    await setDoc(accessRef(credential.user.uid), {
      email,
      displayName,
      provider: "password",
      username,
      status: "approved",
      mustChangePassword: true,
      requestedAt: serverTimestamp(),
      decidedAt: serverTimestamp(),
      decidedBy: state.user.email,
    });
    $("form-create").reset();
    showMessage(result, `Đã tạo tài khoản "${username}". Gửi tên đăng nhập và mật khẩu tạm cho người dùng; họ sẽ phải đổi mật khẩu khi đăng nhập lần đầu.`, "success");
  } catch (error) {
    showMessage(result, authErrorMessage(error));
  } finally {
    await signOut(creator).catch(() => {});
    setBusy(button, false);
  }
});

// ---------- Đăng nhập / đăng xuất / đổi mật khẩu ----------

$("btn-google").addEventListener("click", async () => {
  showMessage($("login-error"), "");
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (error) {
    showMessage($("login-error"), authErrorMessage(error));
  }
});

$("form-login").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("login-error");
  const username = $("login-username").value.trim().toLowerCase();
  const password = $("login-password").value;
  if (!USERNAME_PATTERN.test(username) || !password) {
    return showMessage(error, "Nhập tên đăng nhập và mật khẩu.");
  }
  const button = $("btn-login");
  setBusy(button, true);
  showMessage(error, "");
  try {
    await signInWithEmailAndPassword(auth, usernameToEmail(username), password);
    $("form-login").reset();
  } catch (e) {
    showMessage(error, authErrorMessage(e));
  } finally {
    setBusy(button, false);
  }
});

$("form-change-password").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("change-error");
  const current = $("change-current").value;
  const next = $("change-new").value;
  const confirmNext = $("change-confirm").value;

  if (!current) return showMessage(error, "Nhập mật khẩu hiện tại.");
  if (next.length < MIN_PASSWORD_LENGTH) return showMessage(error, `Mật khẩu mới cần ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`);
  if (next === current) return showMessage(error, "Mật khẩu mới phải khác mật khẩu hiện tại.");
  if (next !== confirmNext) return showMessage(error, "Hai lần nhập mật khẩu mới không khớp.");

  const user = auth.currentUser;
  const button = $("btn-change");
  setBusy(button, true);
  showMessage(error, "");
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current));
    await updatePassword(user, next);
    if (state.access) {
      // Người dùng chỉ được tự sửa đúng field này, true → false.
      await updateDoc(accessRef(user.uid), { mustChangePassword: false });
    } else {
      // Super admin mật khẩu lần đầu: chưa có doc, tạo doc đã duyệt cho chính mình.
      await setDoc(accessRef(user.uid), {
        email: user.email,
        displayName: user.displayName || "",
        provider: "password",
        username: emailToUsername(user.email) || "",
        status: "approved",
        mustChangePassword: false,
        requestedAt: serverTimestamp(),
        decidedAt: serverTimestamp(),
        decidedBy: user.email,
      });
    }
    await resolveAccess(user);
  } catch (e) {
    showMessage(error, e.code === "auth/invalid-credential" || e.code === "auth/wrong-password"
      ? "Mật khẩu hiện tại không đúng."
      : authErrorMessage(e));
  } finally {
    setBusy(button, false);
  }
});

$("btn-recheck").addEventListener("click", () => {
  if (state.user) resolveAccess(state.user).catch(handleResolveError);
});

for (const button of document.querySelectorAll("[data-action=logout]")) {
  button.addEventListener("click", () => signOut(auth));
}

function handleResolveError(error) {
  console.warn("Không xác định được quyền truy cập", error);
  showMessage($("login-error"), authErrorMessage(error));
  signOut(auth);
}

onAuthStateChanged(auth, (user) => {
  state.user = user;
  state.access = null;
  unsubscribeRequests();
  if (!user) {
    showView("view-login");
    return;
  }
  resolveAccess(user).catch(handleResolveError);
});
