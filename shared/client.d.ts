// Types for client.js (the Firestore-backed API both apps use).
export class ApiError extends Error {
  status: number;
}
export interface Backend {
  api<T = any>(path: string, opts?: { method?: string; body?: unknown }): Promise<T>;
  me(): Promise<any>;
  join(input: { name: string; teamId: string }): Promise<any>;
  joinOptions(): Promise<{ id: string; name: string; department: string; branch: string }[]>;
  hasPlayer(): Promise<boolean>;
  setupState(): Promise<{ claimed: boolean }>;
  claimOwner(input: { name: string; company?: string }): Promise<any>;
  addPlayer(uid: string, input: Record<string, unknown>): Promise<any>;
  settleDue(viewer: any, now?: Date): Promise<string[]>;
  deleteAccount(): Promise<void>;
  forget(): void;
}
export function createBackend(deps: { fs: any; db: any; auth: any }): Backend;
