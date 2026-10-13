import { onAuthStateChanged, signInAnonymously, signOut as fbSignOut } from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Me } from './api';
import { auth, backend } from './firebase';

// Players sign in anonymously: no email or password, just a name and their team.
// Firebase remembers the anonymous account on this device.
interface Session {
  me: Me | null;
  ready: boolean;
  join: (name: string, teamId: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    setMe(await backend.api<Me>('/me'));
  }, []);

  useEffect(
    () =>
      onAuthStateChanged(auth, async (user) => {
        if (user && (await backend.hasPlayer())) {
          try {
            await refresh();
          } catch {
            setMe(null);
          }
        } else setMe(null);
        setReady(true);
      }),
    [refresh]
  );

  const join = useCallback(
    async (name: string, teamId: string) => {
      if (!auth.currentUser) await signInAnonymously(auth);
      await backend.join({ name, teamId });
      await refresh();
    },
    [refresh]
  );

  // Signing out of an anonymous account loses it for good, so the app only offers it with a warning.
  const signOut = useCallback(async () => {
    await fbSignOut(auth);
    setMe(null);
  }, []);

  return <SessionContext.Provider value={{ me, ready, join, signOut, refresh }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession must be inside SessionProvider');
  return s;
}
