import { backend } from './firebase';

// All data goes through the shared Firestore data layer (shared/client.js).
// It answers the same requests the old server did, e.g. api('/challenges').
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  return backend.api<T>(path, opts);
}

// --- Shared types (mirror the API) ------------------------------------------

export type Scope = 'person' | 'team' | 'department' | 'branch' | 'region';

export interface Named { id: string; name: string }

export interface Me {
  id: string;
  name: string;
  email: string | null;
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
  sideId: string;
  entityId: string;
  name: string;
  response: 'pending' | 'accepted' | 'declined';
  members: number;
  activeMembers: number;
  total: number;
  score: number;
  people: { id: string; name: string; score: number }[];
}

export interface Challenge {
  id: string;
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
  winnerSideId: string | null
  result: string | null;
  sides: Side[];
  canModerate: boolean;
  mySideId: string | null;
  myResponse: 'pending' | 'accepted' | 'declined' | null;
  entries?: { id: string; value: number; note: string | null; proofUrl: string | null; status: string; userName: string; createdAt: string }[];
}
