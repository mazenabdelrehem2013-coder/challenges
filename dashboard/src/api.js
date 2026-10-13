// All data goes through the shared Firestore data layer (shared/client.js),
// which answers the same requests the old server did, e.g. api('/admin/users').
import { backend } from './firebase.js';

export function api(path, { method = 'GET', body } = {}) {
  return backend.api(path, { method, body });
}

export function qs(params) {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString();
  return s ? `?${s}` : '';
}
