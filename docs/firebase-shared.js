// Cấu hình Firebase dùng chung cho thiệp (firebase-config.js) và trang quản lý (admin/admin.js).
// Port emulator phải khớp firebase.json.

// Web config là public theo thiết kế của Firebase; quyền nằm ở firestore.rules.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCbKOo2igl5jHWg791u_5wBHpF9ugqeFwo',
  authDomain: 'thien-phuong-wedding-1025.firebaseapp.com',
  projectId: 'thien-phuong-wedding-1025',
  storageBucket: 'thien-phuong-wedding-1025.firebasestorage.app',
  messagingSenderId: '630659527776',
  appId: '1:630659527776:web:c42178613083d09f34ff05'
};

// Chạy ở localhost / 127.0.0.1 thì dùng emulator, không bao giờ chạm Firebase thật.
export const EMULATOR_HOSTS = ['localhost', '127.0.0.1'];
export const AUTH_EMULATOR_PORT = 9199;
export const FIRESTORE_EMULATOR_PORT = 8282;
export const USE_EMULATOR = EMULATOR_HOSTS.includes(location.hostname);
