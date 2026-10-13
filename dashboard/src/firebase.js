import { initializeApp, deleteApp } from 'firebase/app';
import * as fs from 'firebase/firestore';
import {
  getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail,
} from 'firebase/auth';
import { createBackend } from '../../shared/client.js';
import { firebaseConfig, usingEmulators as noProject, emulatorProject } from '../../shared/firebase-config.js';

// Your Firebase project (shared/firebase-config.js), or the local emulators with VITE_USE_EMULATORS=1.
const usingEmulators = noProject || import.meta.env.VITE_USE_EMULATORS === '1';
const config = usingEmulators ? { apiKey: 'demo-key', projectId: emulatorProject, authDomain: 'localhost' } : firebaseConfig;
const host = import.meta.env.VITE_EMULATOR_HOST || '127.0.0.1';

function connect(app) {
  const db = fs.getFirestore(app);
  const auth = getAuth(app);
  if (usingEmulators) {
    fs.connectFirestoreEmulator(db, host, 8080);
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  }
  return { db, auth };
}

export const app = initializeApp(config);
export const { db, auth } = connect(app);
export const backend = createBackend({ fs, db, auth });

// Make a sign-in for someone else. Creating a user signs into it, so this uses a
// second, throwaway Firebase app and the dashboard stays signed in as you.
export async function createLogin(email, password) {
  const temp = initializeApp(config, `create-${Date.now()}`);
  try {
    const { auth: tempAuth } = connect(temp);
    const cred = await createUserWithEmailAndPassword(tempAuth, email, password);
    await signOut(tempAuth);
    return cred.user.uid;
  } finally {
    await deleteApp(temp);
  }
}

export function sendReset(email) {
  return sendPasswordResetEmail(auth, email);
}

// Firebase's sign-in errors, in plain words.
export function authMessage(err) {
  const code = err?.code || '';
  if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(code)) return 'Wrong email or password';
  if (code.includes('email-already-in-use')) return 'That email is already registered';
  if (code.includes('weak-password')) return 'The password needs at least 6 characters';
  if (code.includes('too-many-requests')) return 'Too many attempts, try again in a few minutes';
  if (code.includes('operation-not-allowed')) return 'Turn on Email/Password sign-in in the Firebase console (Authentication > Sign-in method)';
  return err?.message || 'Something went wrong';
}
