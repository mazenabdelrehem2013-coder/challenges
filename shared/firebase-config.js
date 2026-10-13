// Your Firebase project's web settings. Copy them from the Firebase console:
// Project settings > General > Your apps > Web app > "firebaseConfig".
// These values are not secret (every web app ships them); firestore.rules protects the data.
export const firebaseConfig = {
  apiKey: 'AIzaSyBLMEavYIf7BvC3Gag18Lc1ONuzs6Qs1rU',
  authDomain: 'employee-challenges.firebaseapp.com',
  projectId: 'employee-challenges',
  storageBucket: 'employee-challenges.firebasestorage.app',
  messagingSenderId: '217775328448',
  appId: '1:217775328448:web:fa165a7bd14523a0933125',
};

// To try things on the local emulators instead (`npm run emulators`, then `npm run seed`), start the
// phone app with EXPO_PUBLIC_USE_EMULATORS=1 or the dashboard with VITE_USE_EMULATORS=1.
export const usingEmulators = !firebaseConfig.apiKey;
export const emulatorProject = 'demo-challenges';
