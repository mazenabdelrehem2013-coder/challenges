import React, { useEffect, useState, useCallback } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { api } from './api.js';
import { auth, backend, authMessage } from './firebase.js';
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
  const [state, setState] = useState('checking'); // checking | setup | signed-out | no-account | ready
  const [pending, setPending] = useState(0);
  const [tick, setTick] = useState(0);
  const page = useHash();

  useEffect(
    () =>
      onAuthStateChanged(auth, async (user) => {
        if (!user || user.isAnonymous) {
          const { claimed } = await backend.setupState().catch(() => ({ claimed: true }));
          setMe(null);
          return setState(claimed ? 'signed-out' : 'setup');
        }
        try {
          setMe(await api('/me'));
          setState('ready');
        } catch {
          setMe(null);
          setState('no-account');
        }
      }),
    []
  );

  // There is no server, so finished challenges are scored from here: when the
  // dashboard opens and every minute while it stays open.
  useEffect(() => {
    if (state !== 'ready' || me?.role === 'employee') return undefined;
    let stopped = false;
    const run = async () => {
      try {
        const done = await backend.settleDue(await backend.me());
        if (done.length && !stopped) setTick((t) => t + 1);
      } catch {
        /* try again next minute */
      }
    };
    run();
    const timer = setInterval(run, 60000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [state, me?.id, me?.role]);

  const refreshPending = useCallback(() => {
    api('/admin/overview').then((o) => setPending(o.pendingApprovals)).catch(() => {});
  }, []);
  useEffect(() => {
    if (me && me.role !== 'employee') refreshPending();
  }, [me, page, tick, refreshPending]);

  if (state === 'checking') return null;
  if (state === 'setup') return <Setup />;
  if (state === 'signed-out') return <Login />;
  if (state === 'no-account' || me?.role === 'employee') {
    return (
      <div className="login">
        <div className="card">
          <h2>This dashboard is for managers and HR</h2>
          <p className="muted">{me ? 'Use the phone app to take part in challenges.' : 'This sign-in has no dashboard access. Ask HR to add you.'}</p>
          <button onClick={() => signOut(auth)}>Sign out</button>
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
          <button className="small" onClick={() => signOut(auth)}>Sign out</button>
        </div>
      </nav>
      <main>
        <Page key={tick} me={me} isStaff={isStaff} onChange={refreshPending} />
      </main>
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      setError(authMessage(err));
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

// First run on a new Firebase project: whoever fills this in becomes the admin.
function Setup() {
  const [f, setF] = useState({ name: '', company: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (f.password.length < 8) throw new Error('Use a password with at least 8 characters');
      await createUserWithEmailAndPassword(auth, f.email.trim(), f.password);
      await backend.claimOwner({ name: f.name, company: f.company || 'Head office' });
      window.location.reload();
    } catch (err) {
      setError(authMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h1>Set up Challenges</h1>
        <p className="muted">You're the first one here. Create the admin account; you can add HR and managers next.</p>
        {error && <div className="error" role="alert">{error}</div>}
        <label className="field">Your name<input value={f.name} onChange={set('name')} required /></label>
        <label className="field">Main office or branch name<input value={f.company} onChange={set('company')} placeholder="e.g. Cairo" /></label>
        <label className="field">Email<input type="email" autoComplete="username" value={f.email} onChange={set('email')} required /></label>
        <label className="field">Password<input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} minLength={8} required /></label>
        <button className="primary" disabled={busy}>{busy ? 'Setting up…' : 'Create admin account'}</button>
      </form>
    </div>
  );
}
