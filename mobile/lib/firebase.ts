import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from 'firebase/app';
import * as FirebaseAuth from 'firebase/auth';
import * as fs from 'firebase/firestore';
import { Platform } from 'react-native';

import { createBackend } from '../../shared/client.js';
import { emulatorProject, firebaseConfig, usingEmulators } from '../../shared/firebase-config.js';

// Connects to your Firebase project (shared/firebase-config.js), or to the local
// emulators while no project is filled in. EXPO_PUBLIC_EMULATOR_HOST picks the
// emulator machine when testing on a phone (defaults to localhost).
const host = process.env.EXPO_PUBLIC_EMULATOR_HOST || '127.0.0.1';

export const app = initializeApp(
  usingEmulators ? { apiKey: 'demo-key', projectId: emulatorProject, authDomain: 'localhost' } : firebaseConfig
);

// Stay signed in between launches, so a player keeps the same account.
export const auth = FirebaseAuth.initializeAuth(app, {
  persistence:
    Platform.OS === 'web'
      ? [FirebaseAuth.indexedDBLocalPersistence, FirebaseAuth.browserLocalPersistence]
      : (FirebaseAuth as any).getReactNativePersistence(AsyncStorage),
});

export const db = Platform.OS === 'web' ? fs.getFirestore(app) : fs.initializeFirestore(app, { experimentalForceLongPolling: true });

if (usingEmulators) {
  FirebaseAuth.connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  fs.connectFirestoreEmulator(db, host, 8080);
}

export const backend = createBackend({ fs, db, auth });
