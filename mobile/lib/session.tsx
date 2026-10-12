import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, tokenStore, setSignedOutHandler, type Me } from './api';
import { registerForPush } from './push';

interface Session {
  me: Me | null;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  const signOut = useCallback(async () => {
    await tokenStore.save(null);
    setMe(null);
  }, []);

  const refresh = useCallback(async () => {
    setMe(await api<Me>('/me'));
  }, []);

  useEffect(() => {
    setSignedOutHandler(() => { signOut(); });
    (async () => {
      if (await tokenStore.load()) {
        try { await refresh(); } catch { await tokenStore.save(null); }
      }
      setReady(true);
    })();
  }, [refresh, signOut]);

  useEffect(() => {
    if (me) registerForPush().catch(() => {});
  }, [me?.id]);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await api<{ token: string; user: Me }>('/auth/login', { method: 'POST', body: { email, password } });
    await tokenStore.save(res.token);
    setMe(res.user);
  }, []);

  return <SessionContext.Provider value={{ me, ready, signIn, signOut, refresh }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession must be inside SessionProvider');
  return s;
}
