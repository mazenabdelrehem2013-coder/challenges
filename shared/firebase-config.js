// Your Firebase project's web settings. Copy them from the Firebase console:
// Project settings > General > Your apps > Web app > "firebaseConfig".
// These values are not secret (every web app ships them); firestore.rules protects the data.
export const firebaseConfig = {
  apiKey: 'AIzaSyAc0ggZ4LSM5PY4fW56WFadLU0Gth2_qoY',
  authDomain: 'sunna-muslim.firebaseapp.com',
  projectId: 'sunna-muslim',
  storageBucket: 'sunna-muslim.firebasestorage.app',
  messagingSenderId: '288970394324',
  appId: '1:288970394324:web:b6e4d7933baedd1c898941',
};

// To try things on the local emulators instead (`npm run emulators`, then `npm run seed`), start the
// phone app with EXPO_PUBLIC_USE_EMULATORS=1 or the dashboard with VITE_USE_EMULATORS=1.
export const usingEmulators = !firebaseConfig.apiKey;
export const emulatorProject = 'demo-challenges';
