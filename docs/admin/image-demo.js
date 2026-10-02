// Trang thử module ảnh (image-demo.html): đăng nhập rồi chọn/cắt/tải ảnh cho từng loại ô.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, connectAuthEmulator, onAuthStateChanged, signInWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  FIREBASE_CONFIG, AUTH_EMULATOR_PORT, USE_EMULATOR,
} from "../firebase-shared.js";
import { createImagePicker } from "./image-picker.js";

const USERNAME_DOMAIN = "thien-phuong-wedding.local";

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
if (USE_EMULATOR) {
  connectAuthEmulator(auth, `http://${location.hostname}:${AUTH_EMULATOR_PORT}`, { disableWarnings: true });
}

const $ = (id) => document.getElementById(id);
let picker = null;

function formatBytes(n) {
  return `${(n / 1024).toFixed(1)} KB`;
}

function showResult(result) {
  const { large, small } = result.variants;
  const rows = [
    ["Key", `${result.keys.large}, ${result.keys.small}`],
    ["Bản lớn", `${large.width}×${large.height}, ${formatBytes(large.blob.size)}`],
    ["Bản nhỏ", `${small.width}×${small.height}, ${formatBytes(small.blob.size)}`],
    ["URL bản lớn", result.large],
    ["URL bản nhỏ", result.small],
  ];
  const list = $("demo-result-list");
  list.replaceChildren(...rows.flatMap(([k, v]) => {
    const dt = document.createElement("dt");
    dt.className = "col-sm-3";
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.className = "col-sm-9 text-break";
    dd.textContent = v;
    return [dt, dd];
  }));
  $("demo-large").src = result.large;
  $("demo-small").src = result.small;
  $("demo-result").hidden = false;
}

function mountPicker() {
  picker?.destroy();
  $("demo-result").hidden = true;
  picker = createImagePicker({
    container: $("demo-picker"),
    getIdToken: () => auth.currentUser.getIdToken(),
    kind: $("demo-kind").value,
    onUploaded: showResult,
  });
  window.imageDemo = { picker };
}

$("demo-kind").addEventListener("change", mountPicker);

$("demo-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const user = $("demo-user").value.trim();
  const email = user.includes("@") ? user : `${user.toLowerCase()}@${USERNAME_DOMAIN}`;
  $("demo-login-error").textContent = "";
  try {
    await signInWithEmailAndPassword(auth, email, $("demo-pass").value);
  } catch {
    $("demo-login-error").textContent = "Sai tên đăng nhập hoặc mật khẩu.";
  }
});

onAuthStateChanged(auth, (user) => {
  $("demo-login").hidden = !!user;
  $("demo-main").hidden = !user;
  if (user) {
    $("demo-who").textContent = user.email || user.uid;
    if (!picker) mountPicker();
  }
});
