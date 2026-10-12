// Tiny API client. The token is kept in localStorage so a refresh keeps you signed in.
const KEY = 'challenges-admin-token';

export const auth = {
  get token() {
    try { return localStorage.getItem(KEY); } catch { return null; }
  },
  set token(v) {
    try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* storage blocked */ }
  },
};

export async function api(path, { method = 'GET', body, raw } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && path !== '/auth/login') {
    auth.token = null;
    window.dispatchEvent(new Event('signed-out'));
  }
  if (raw) {
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Request failed');
    return res;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export function qs(params) {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString();
  return s ? `?${s}` : '';
}
