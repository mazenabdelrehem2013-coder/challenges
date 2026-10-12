import React, { useEffect, useState, useCallback } from 'react';
import { api, auth } from './api.js';
import { Overview, Approvals, Challenges, People, Org, Leaderboard, Reports, Settings } from './pages.jsx';

const PAGES = [
  ['overview', 'Overview', Overview],
  ['challenges', 'Challenges', Challenges],
  ['approvals', 'Approvals', Approvals],
  ['leaderboard', 'Leaderboard', Leaderboard],
  ['people', 'People', People],
  ['org', 'Org chart', Org, true],
  ['reports', 'Reports', Reports],
  ['settings', 'Settings', Settings],
];

function useHash() {
  const read = () => window.location.hash.replace(/^#\/?/, '') || 'overview';
  const [hash, setHash] = useState(read);
  useEffect(() => {
    const on = () => setHash(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export default function App() {
  const [me, setMe] = useState(null);
  const [checking, setChecking] = useState(!!auth.token);
  const [pending, setPending] = useState(0);
  const page = useHash();

  const loadMe = useCallback(async () => {
    if (!auth.token) return setChecking(false);
    try {
      setMe(await api('/me'));
    } catch {
      setMe(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
    const out = () => setMe(null);
    window.addEventListener('signed-out', out);
    return () => window.removeEventListener('signed-out', out);
  }, [loadMe]);

  const refreshPending = useCallback(() => {
    api('/admin/overview').then((o) => setPending(o.pendingApprovals)).catch(() => {});
  }, []);
  useEffect(() => {
    if (me) refreshPending();
  }, [me, page, refreshPending]);

  if (checking) return null;
  if (!me) return <Login onDone={setMe} />;
  if (me.role === 'employee') {
    return (
      <div className="login">
        <div className="card">
          <h2>This dashboard is for managers and HR</h2>
          <p className="muted">Use the phone app to take part in challenges.</p>
          <button onClick={() => { auth.token = null; setMe(null); }}>Sign out</button>
        </div>
      </div>
    );
  }

  const isStaff = me.role === 'hr' || me.role === 'admin';
  const visible = PAGES.filter(([, , , staffOnly]) => !staffOnly || isStaff);
  const current = visible.find(([key]) => key === page) || visible[0];
  const Page = current[2];

  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <span className="brand">Challenges Admin</span>
        {visible.map(([key, label]) => (
          <a key={key} href={`#/${key}`} className={key === current[0] ? 'active' : ''}>
            {label}
            {key === 'approvals' && pending > 0 && <span className="badge-count">{pending}</span>}
          </a>
        ))}
        <div className="who">
          <div><b>{me.name}</b></div>
          <div>{me.role === 'manager' ? `Manager · ${me.department.name}` : me.role.toUpperCase()}</div>
          <button className="small" onClick={() => { auth.token = null; setMe(null); }}>Sign out</button>
        </div>
      </nav>
      <main>
        <Page me={me} isStaff={isStaff} onChange={refreshPending} />
      </main>
    </div>
  );
}

function Login({ onDone }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api('/auth/login', { method: 'POST', body: { email, password } });
      auth.token = res.token;
      onDone(res.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h1>Sign in</h1>
        <p className="muted">Manager and HR dashboard</p>
        {error && <div className="error" role="alert">{error}</div>}
        <label className="field">Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
