import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Where the back end lives. Set EXPO_PUBLIC_API_URL (or "extra.apiUrl" in app.json)
// to your server's address, e.g. https://challenges.yourcompany.com.
// "same-origin" is for the web version served by the back end itself.
const configuredUrl: string =
  process.env.EXPO_PUBLIC_API_URL || (Constants.expoConfig?.extra?.apiUrl as string) || 'http://localhost:4000';
export const API_URL: string = configuredUrl === 'same-origin' ? '' : configuredUrl;

const TOKEN_KEY = 'challenges-token';
let token: string | null = null;

export const tokenStore = {
  async load() {
    if (Platform.OS === 'web') {
      try { token = localStorage.getItem(TOKEN_KEY); } catch { token = null; }
    } else {
      token = await SecureStore.getItemAsync(TOKEN_KEY);
    }
    return token;
  },
  async save(value: string | null) {
    token = value;
    if (Platform.OS === 'web') {
      try { value ? localStorage.setItem(TOKEN_KEY, value) : localStorage.removeItem(TOKEN_KEY); } catch {}
    } else if (value) {
      await SecureStore.setItemAsync(TOKEN_KEY, value);
    } else {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
    }
  },
};

let onSignedOut: () => void = () => {};
export function setSignedOutHandler(fn: () => void) {
  onSignedOut = fn;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, {
    method: opts.method || 'GET',
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/auth/login') onSignedOut();
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data as T;
}

// --- Shared types (mirror the API) ------------------------------------------

export type Scope = 'person' | 'team' | 'department' | 'branch' | 'region';

export interface Named { id: number; name: string }

export interface Me {
  id: number;
  name: string;
  email: string;
  role: 'employee' | 'manager' | 'hr' | 'admin';
  title: string | null;
  team: Named;
  department: Named;
  branch: Named;
  region: Named;
  points: number;
  level: number;
  levelName: string;
  pointsToNext: number;
  progress: number;
}

export interface Profile extends Me {
  record: { won: number; lost: number; draw: number };
  streak: number;
  badges: { code: string; name: string; description: string; earned: boolean }[];
}

export interface Side {
  sideId: number;
  entityId: number;
  name: string;
  response: 'pending' | 'accepted' | 'declined';
  members: number;
  activeMembers: number;
  total: number;
  score: number;
  people: { id: number; name: string; score: number }[];
}

export interface Challenge {
  id: number;
  title: string;
  description: string | null;
  type: 'fitness' | 'learning' | 'work' | 'custom';
  scope: Scope;
  unit: string | null;
  judging: 'tracked' | 'proof' | 'manager';
  points: number;
  reward: string | null;
  official: boolean;
  status: 'pending_approval' | 'invited' | 'active' | 'completed' | 'rejected' | 'declined' | 'cancelled';
  startsAt: string;
  endsAt: string;
  createdBy: Named;
  rejectionReason: string | null;
  winnerSideId: number | null;
  sides: Side[];
  mySideId: number | null;
  myResponse: 'pending' | 'accepted' | 'declined' | null;
  entries?: { id: number; value: number; note: string | null; status: string; userName: string; createdAt: string }[];
}
