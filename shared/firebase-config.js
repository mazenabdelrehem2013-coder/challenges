// Your Firebase project's web settings. Copy them from the Firebase console:
// Project settings > General > Your apps > Web app > "firebaseConfig".
// These values are not secret (every web app ships them); firestore.rules protects the data.
//
// While apiKey is empty, both apps talk to the local emulators (`npm run emulators`).
export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};

export const usingEmulators = !firebaseConfig.apiKey;
export const emulatorProject = 'demo-challenges';
