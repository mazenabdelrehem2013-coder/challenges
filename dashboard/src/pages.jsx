import React, { useEffect, useState, useCallback } from 'react';
import { api, qs } from './api.js';
import { backend, createLogin, sendReset, authMessage } from './firebase.js';

const SCOPE_LABEL = { person: 'People', team: 'Teams', department: 'Departments', branch: 'Branches', region: 'Regions' };
const STATUS_LABEL = {
  pending_approval: 'Waiting for approval',
  invited: 'Waiting for opponent',
  active: 'Live',
  completed: 'Finished',
  rejected: 'Rejected',
  declined: 'Declined',
  cancelled: 'Cancelled',
};
const fmt = (n) => Number(n || 0).toLocaleString();
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, error: '' });
  const reload = useCallback(() => {
    fn().then((data) => setState({ data, error: '' }), (err) => setState((s) => ({ ...s, error: err.message })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

function useOrg() {
  return useLoad(() => api('/admin/org'), []).data;
}

function Status({ c }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <span className={`pill ${c.status}`}>{STATUS_LABEL[c.status]}</span>
      {c.official && <span className="pill official">Official</span>}
    </span>
  );
}

function Seg({ options, value, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" className={v === value ? 'on' : ''} aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Filters({ me, value, onChange }) {
  const org = useOrg();
  if (!org) return null;
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const branches = org.branches.filter((b) => !value.regionId || String(b.regionId) === String(value.regionId));
  return (
    <div className="row" style={{ alignItems: 'flex-end' }}>
      <label className="field">Region
        <select value={value.regionId || ''} onChange={(e) => onChange({ ...value, regionId: e.target.value, branchId: '' })}>
          <option value="">All regions</option>
          {org.regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
      <label className="field">Branch
        <select value={value.branchId || ''} onChange={set('branchId')}>
          <option value="">All branches</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </label>
      {me.role !== 'manager' && (
        <label className="field">Department
          <select value={value.departmentId || ''} onChange={set('departmentId')}>
            <option value="">All departments</option>
            {org.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

function Err({ error }) {
  return error ? <div className="error" role="alert">{error}</div> : null;
}

// --- Overview ----------------------------------------------------------------

export function Overview({ me }) {
  const [filter, setFilter] = useState({});
  const [by, setBy] = useState('department');
  const overview = useLoad(() => api(`/admin/overview${qs(filter)}`), [JSON.stringify(filter)]);
  const part = useLoad(() => api(`/admin/participation${qs({ ...filter, by, period: 'month' })}`), [JSON.stringify(filter), by]);
  const official = useLoad(() => api('/challenges?view=manage&status=active'), []);
  const o = overview.data;

  return (
    <>
      <div className="row between">
        <div className="stack" style={{ gap: 2 }}>
          <h1>Overview</h1>
          <span className="muted">Last 30 days{me.role === 'manager' ? ` · ${me.department.name}` : ''}</span>
        </div>
        <Filters me={me} value={filter} onChange={setFilter} />
      </div>
      <Err error={overview.error} />
      {o && (
        <div className="grid-kpi">
          <div className="card kpi"><span className="label">Employees taking part</span><span className="value">{o.participationRate}%</span><span className="sub">{o.participants} of {o.employees} people</span></div>
          <div className="card kpi"><span className="label">Live challenges</span><span className="value">{o.activeChallenges}</span><span className="sub">{o.activeOfficial} official</span></div>
          <div className="card kpi"><span className="label">Points awarded</span><span className="value">{fmt(o.pointsThisMonth)}</span><span className="sub">Last 30 days</span></div>
          <div className="card kpi"><span className="label">Waiting for approval</span><span className="value">{o.pendingApprovals}</span><a className="sub" href="#/approvals">Review now</a></div>
        </div>
      )}
      <div className="split">
        <section className="card wide">
          <h2>Live challenges</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Challenge</th><th>Between</th><th>Ends</th><th>Leader</th></tr></thead>
              <tbody>
                {(official.data || []).slice(0, 8).map((c) => {
                  const lead = [...c.sides].sort((a, b) => b.score - a.score)[0];
                  return (
                    <tr key={c.id}>
                      <td><b>{c.title}</b> {c.official && <span className="pill official">Official</span>}</td>
                      <td>{c.sides.length} {SCOPE_LABEL[c.scope].toLowerCase()}</td>
                      <td>{day(c.endsAt)}</td>
                      <td>{lead && lead.score > 0 ? `${lead.name} (${fmt(lead.score)})` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {official.data?.length === 0 && <span className="muted">No live challenges right now.</span>}
        </section>
        <section className="card">
          <h2>Participation</h2>
          <Seg label="Group by" value={by} onChange={setBy} options={[['department', 'Department'], ['branch', 'Branch'], ['region', 'Region']]} />
          {(part.data || []).map((p) => (
            <div key={p.id} className="stack" style={{ gap: 6 }}>
              <div className="row between" style={{ fontSize: 14 }}><span>{p.name}</span><span className="muted">{p.rate}% · {p.participants}/{p.members}</span></div>
              <div className="bar"><div style={{ width: `${p.rate}%` }} /></div>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

// --- Approvals ---------------------------------------------------------------

export function Approvals({ onChange }) {
  const { data, error, reload } = useLoad(() => api('/admin/approvals'), []);
  const [msg, setMsg] = useState('');
  async function act(path, body) {
    try {
      await api(path, { method: 'POST', body });
      setMsg('');
      reload();
      onChange?.();
    } catch (err) {
      setMsg(err.message);
    }
  }
  return (
    <>
      <h1>Approvals</h1>
      <Err error={error || msg} />
      <section className="card">
        <h2>Challenges waiting for approval</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Challenge</th><th>Between</th><th>Created by</th><th>Points</th><th>Ends</th><th></th></tr></thead>
            <tbody>
              {(data?.challenges || []).map((c) => (
                <tr key={c.id}>
                  <td><b>{c.title}</b><div className="muted">{c.description}</div></td>
                  <td>{c.sides.map((s) => s.name).join(' vs ')}</td>
                  <td>{c.createdBy.name}</td>
                  <td>{c.points}</td>
                  <td>{day(c.endsAt)}</td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                      <button className="good small" onClick={() => act(`/challenges/${c.id}/approve`)}>Approve</button>
                      <button className="small" onClick={() => {
                        const reason = window.prompt('Why are you rejecting this challenge? (optional)');
                        if (reason !== null) act(`/challenges/${c.id}/reject`, { reason });
                      }}>Reject</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data?.challenges.length === 0 && <span className="muted">Nothing waiting. Nice.</span>}
      </section>
      <section className="card">
        <h2>Proof to check</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Who</th><th>Challenge</th><th>Value</th><th>Proof</th><th></th></tr></thead>
            <tbody>
              {(data?.entries || []).map((e) => (
                <tr key={e.id}>
                  <td>{e.userName}</td>
                  <td>{e.challengeTitle}</td>
                  <td>{fmt(e.value)} {e.unit}</td>
                  <td>{e.proofUrl ? <a href={e.proofUrl} target="_blank" rel="noreferrer noopener">Open</a> : '—'} {e.note}</td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                      <button className="good small" onClick={() => act(`/challenges/${e.challengeId}/entries/${e.id}/review`, { decision: 'approved' })}>Accept</button>
                      <button className="small" onClick={() => act(`/challenges/${e.challengeId}/entries/${e.id}/review`, { decision: 'rejected' })}>Reject</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data?.entries.length === 0 && <span className="muted">No proof waiting.</span>}
      </section>
    </>
  );
}

// --- Challenges --------------------------------------------------------------

export function Challenges({ me, onChange }) {
  const [status, setStatus] = useState('active');
  const [creating, setCreating] = useState(false);
  const { data, error, reload } = useLoad(() => api(`/challenges${qs({ view: 'manage', status })}`), [status]);
  const [msg, setMsg] = useState('');

  async function finish(c) {
    let body = {};
    if (c.judging === 'manager') {
      const names = c.sides.map((s, i) => `${i + 1}. ${s.name}`).join('\n');
      const pick = window.prompt(`Who won "${c.title}"? Type the number, or 0 for a draw.\n${names}`);
      if (pick === null) return;
      const i = Number(pick);
      body = { winnerSideId: i === 0 ? null : c.sides[i - 1]?.sideId };
      if (body.winnerSideId === undefined) return setMsg('Please type one of the numbers shown.');
    } else if (!window.confirm(`Finish "${c.title}" now and hand out the points?`)) return;
    try {
      await api(`/challenges/${c.id}/finish`, { method: 'POST', body });
      setMsg('');
      reload();
      onChange?.();
    } catch (err) {
      setMsg(err.message);
    }
  }

  async function cancel(c) {
    if (!window.confirm(`Cancel "${c.title}"? Nobody gets points.`)) return;
    try {
      await api(`/challenges/${c.id}/cancel`, { method: 'POST' });
      reload();
    } catch (err) {
      setMsg(err.message);
    }
  }

  return (
    <>
      <div className="row between">
        <h1>Challenges</h1>
        <button className="primary" onClick={() => setCreating((v) => !v)}>{creating ? 'Close' : '+ New official challenge'}</button>
      </div>
      {creating && <NewOfficial me={me} onCreated={() => { setCreating(false); setStatus('active'); reload(); }} />}
      <Seg label="Status" value={status} onChange={setStatus} options={[
        ['active', 'Live'], ['pending_approval,invited', 'Waiting'], ['completed', 'Finished'], ['rejected,declined,cancelled', 'Closed'],
      ]} />
      <Err error={error || msg} />
      <section className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Challenge</th><th>Level</th><th>Scores</th><th>Ends</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {(data || []).map((c) => (
                <tr key={c.id}>
                  <td><b>{c.title}</b><div className="muted">{c.points} pts{c.reward ? ` · ${c.reward}` : ''} · by {c.createdBy.name}</div></td>
                  <td>{SCOPE_LABEL[c.scope]}</td>
                  <td>{c.sides.map((s) => (
                    <div key={s.sideId} style={{ marginBottom: 6 }}>
                      <div style={{ fontWeight: s.sideId === c.winnerSideId ? 700 : 400 }}>
                        {s.name}: {fmt(s.score)}{s.sideId === c.winnerSideId ? ' 🏆' : ''}
                      </div>
                      {s.people?.length > 0 && (
                        <div className="muted" style={{ fontSize: 12 }}>{s.people.map((p) => `${p.name} ${fmt(p.score)}`).join(' · ')}</div>
                      )}
                    </div>
                  ))}</td>
                  <td>{day(c.endsAt)}</td>
                  <td><Status c={c} /></td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                      {c.status === 'active' && c.canModerate && <button className="small" onClick={() => finish(c)}>{c.judging === 'manager' ? 'Pick winner' : 'Finish now'}</button>}
                      {['active', 'invited', 'pending_approval'].includes(c.status) && c.canModerate && <button className="small" onClick={() => cancel(c)}>Cancel</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data?.length === 0 && <span className="muted">No challenges here.</span>}
      </section>
    </>
  );
}

function NewOfficial({ me, onCreated }) {
  const org = useOrg();
  const isManager = me.role === 'manager';
  const scopes = isManager ? ['person', 'team', 'department'] : ['person', 'team', 'department', 'branch', 'region'];
  const inWeek = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const [f, setF] = useState({ title: '', description: '', type: 'fitness', scope: 'branch', unit: '', judging: 'tracked', points: 300, reward: '', endsAt: inWeek, sides: [] });
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const options = !org ? [] : {
    team: org.teams.filter((t) => !isManager || t.departmentId === me.department.id),
    department: org.departments,
    branch: org.branches,
    region: org.regions,
  }[f.scope] || [];

  function toggle(id) {
    setF({ ...f, sides: f.sides.includes(id) ? f.sides.filter((x) => x !== id) : [...f.sides, id] });
  }

  async function submit(e) {
    e.preventDefault();
    try {
      await api('/challenges', {
        method: 'POST',
        body: { ...f, official: true, points: Number(f.points), endsAt: new Date(`${f.endsAt}T23:59:00`).toISOString() },
      });
      onCreated();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>New official challenge</h2>
      <Err error={error} />
      <div className="form">
        <label className="field full">Title<input value={f.title} onChange={set('title')} required maxLength={120} /></label>
        <label className="field full">Description<textarea value={f.description} onChange={set('description')} maxLength={2000} /></label>
        <label className="field">Between
          <select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value, sides: [] })}>
            {scopes.map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="field">Type
          <select value={f.type} onChange={set('type')}>
            <option value="fitness">Fitness</option><option value="learning">Learning</option><option value="work">Work goal</option><option value="custom">Custom</option>
          </select>
        </label>
        <label className="field">Unit (e.g. steps)<input value={f.unit} onChange={set('unit')} maxLength={40} /></label>
        <label className="field">Winner decided by
          <select value={f.judging} onChange={set('judging')}>
            <option value="tracked">Logged numbers</option><option value="proof">Numbers with photo proof</option><option value="manager">Manager picks</option>
          </select>
        </label>
        <label className="field">Points for winners<input type="number" min="0" value={f.points} onChange={set('points')} /></label>
        <label className="field">Reward (optional)<input value={f.reward} onChange={set('reward')} placeholder="e.g. Extra day off" maxLength={200} /></label>
        <label className="field">Ends on<input type="date" value={f.endsAt} onChange={set('endsAt')} required /></label>
        {f.scope !== 'person' && (
          <fieldset className="full" style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 12 }}>
            <legend className="muted">Who takes part (leave empty for all)</legend>
            <div className="row">
              {options.map((o) => (
                <label key={o.id} className="row" style={{ gap: 6, fontSize: 14 }}>
                  <input type="checkbox" style={{ height: 18 }} checked={f.sides.includes(o.id)} onChange={() => toggle(o.id)} />{o.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {f.scope === 'person' && <p className="muted full">Everyone {isManager ? `in ${me.department.name}` : 'in the company'} takes part individually.</p>}
      </div>
      <div><button className="primary">Launch challenge</button></div>
    </form>
  );
}

// --- Leaderboard -------------------------------------------------------------

export function Leaderboard({ me }) {
  const [scope, setScope] = useState('person');
  const [period, setPeriod] = useState('month');
  const [filter, setFilter] = useState({});
  const { data, error } = useLoad(() => api(`/admin/leaderboard${qs({ ...filter, scope, period })}`), [scope, period, JSON.stringify(filter)]);
  return (
    <>
      <div className="row between">
        <h1>Leaderboard</h1>
        <Filters me={me} value={filter} onChange={setFilter} />
      </div>
      <div className="row">
        <Seg label="Rank" value={scope} onChange={setScope} options={Object.entries(SCOPE_LABEL)} />
        <Seg label="Period" value={period} onChange={setPeriod} options={[['day', 'Today'], ['week', 'This week'], ['month', 'This month'], ['all', 'All time']]} />
      </div>
      <Err error={error} />
      <section className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Name</th><th>{scope === 'person' ? 'Points' : 'Avg points per person'}</th>{scope !== 'person' && <th>People</th>}</tr></thead>
            <tbody>
              {(data || []).map((r) => (
                <tr key={r.id}><td>{r.rank}</td><td>{r.name}</td><td>{fmt(r.score)}</td>{scope !== 'person' && <td>{r.members}</td>}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// --- People ------------------------------------------------------------------

export function People({ me, isStaff }) {
  const org = useOrg();
  const [filter, setFilter] = useState({});
  const [q, setQ] = useState('');
  const { data, error, reload } = useLoad(() => api(`/admin/users${qs({ ...filter, q })}`), [JSON.stringify(filter), q]);
  const [msg, setMsg] = useState('');
  const [adding, setAdding] = useState(false);

  async function update(u, body) {
    try {
      await api(`/admin/users/${u.id}`, { method: 'PATCH', body });
      setMsg(`Saved ${u.name}`);
      reload();
    } catch (err) {
      setMsg(err.message);
    }
  }

  return (
    <>
      <div className="row between">
        <h1>People</h1>
        {isStaff && <button className="primary" onClick={() => setAdding((v) => !v)}>{adding ? 'Close' : '+ Add sign-in'}</button>}
      </div>
      {adding && org && <AddPerson org={org} me={me} onDone={() => { setAdding(false); reload(); }} />}
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field">Search<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" /></label>
        <Filters me={me} value={filter} onChange={setFilter} />
      </div>
      {msg && <div className="notice">{msg}</div>}
      <Err error={error} />
      <section className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Team</th><th>Branch</th><th>Level</th><th>Role</th>{isStaff && <th></th>}</tr></thead>
            <tbody>
              {(data || []).map((u) => (
                <tr key={u.id}>
                  <td><b>{u.name}</b><div className="muted">{u.email}</div></td>
                  <td>
                    {isStaff && org ? (
                      <select aria-label={`Team for ${u.name}`} value={u.team.id} onChange={(e) => update(u, { teamId: e.target.value })}>
                        {org.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    ) : u.team.name}
                  </td>
                  <td>{u.branch.name}<div className="muted">{u.region.name}</div></td>
                  <td>{u.level} · {fmt(u.points)} pts</td>
                  <td>
                    {isStaff ? (
                      <select aria-label={`Role for ${u.name}`} value={u.role} onChange={(e) => update(u, { role: e.target.value })}>
                        <option value="employee">Employee</option><option value="manager">Manager</option>
                        <option value="hr" disabled={me.role !== 'admin'}>HR</option><option value="admin" disabled={me.role !== 'admin'}>Admin</option>
                      </select>
                    ) : u.role}
                  </td>
                  {isStaff && (
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                        {u.email && <button className="small" onClick={() => sendReset(u.email).then(() => setMsg(`Password reset email sent to ${u.email}.`), (err) => setMsg(authMessage(err)))}>Send password reset</button>}
                        {u.id !== me.id && <button className="small" onClick={() => window.confirm(`Deactivate ${u.name}? They won't be able to sign in.`) && update(u, { active: false })}>Deactivate</button>}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function AddPerson({ org, me, onDone }) {
  const [f, setF] = useState({ name: '', email: '', title: '', password: '', role: 'manager', teamId: org.teams[0]?.id || '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    try {
      if (f.password.length < 8) throw new Error('The first password needs at least 8 characters');
      const uid = await createLogin(f.email.trim(), f.password);
      await backend.addPlayer(uid, { ...f, email: f.email.trim() });
      onDone();
    } catch (err) {
      setError(authMessage(err));
    }
  }
  return (
    <form className="card" onSubmit={submit}>
      <h2>Add a sign-in</h2>
      <p className="muted">For managers and HR (and anyone who should use the dashboard). Employees don't need this: they join on the phone app with their name and team.</p>
      <Err error={error} />
      <div className="form">
        <label className="field">Name<input value={f.name} onChange={set('name')} required /></label>
        <label className="field">Email<input type="email" value={f.email} onChange={set('email')} required /></label>
        <label className="field">Job title<input value={f.title} onChange={set('title')} /></label>
        <label className="field">First password<input value={f.password} onChange={set('password')} minLength={8} required /></label>
        <label className="field">Team
          <select value={f.teamId} onChange={set('teamId')}>{org.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        </label>
        <label className="field">Role
          <select value={f.role} onChange={set('role')}>
            <option value="employee">Employee</option><option value="manager">Manager</option>
            {me.role === 'admin' && <><option value="hr">HR</option><option value="admin">Admin</option></>}
          </select>
        </label>
      </div>
      <div><button className="primary">Add sign-in</button></div>
    </form>
  );
}

// --- Org chart ---------------------------------------------------------------

export function Org() {
  const { data: org, reload } = useLoad(() => api('/admin/org'), []);
  const [msg, setMsg] = useState('');
  if (!org) return <h1>Org chart</h1>;
  const regionName = (id) => org.regions.find((r) => r.id === id)?.name;

  async function add(kind, body) {
    try {
      await api(`/admin/org/${kind}`, { method: 'POST', body });
      setMsg('');
      reload();
    } catch (err) {
      setMsg(err.message);
    }
  }

  return (
    <>
      <h1>Org chart</h1>
      <p className="muted">Regions contain branches. Each team belongs to one department in one branch, and each person belongs to one team.</p>
      <Err error={msg} />
      <div className="split">
        <OrgList title="Regions" items={org.regions.map((r) => ({ ...r, sub: `${org.branches.filter((b) => b.regionId === r.id).length} branches` }))}
          onAdd={(name) => add('regions', { name })} />
        <OrgList title="Branches" items={org.branches.map((b) => ({ ...b, sub: regionName(b.regionId) }))}
          extra={[['regionId', 'Region', org.regions]]} onAdd={(name, x) => add('branches', { name, ...x })} />
        <OrgList title="Departments" items={org.departments} onAdd={(name) => add('departments', { name })} />
        <OrgList title="Teams" items={org.teams.map((t) => ({ ...t, sub: `${org.departments.find((d) => d.id === t.departmentId)?.name} · ${org.branches.find((b) => b.id === t.branchId)?.name}` }))}
          extra={[['departmentId', 'Department', org.departments], ['branchId', 'Branch', org.branches]]} onAdd={(name, x) => add('teams', { name, ...x })} />
      </div>
    </>
  );
}

function OrgList({ title, items, extra = [], onAdd }) {
  const [name, setName] = useState('');
  const [sel, setSel] = useState(Object.fromEntries(extra.map(([k, , list]) => [k, list[0]?.id])));
  return (
    <section className="card">
      <h2>{title}</h2>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onAdd(name.trim(), sel); setName(''); } }}>
        <input aria-label={`New ${title.toLowerCase()} name`} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        {extra.map(([k, label, list]) => (
          <select key={k} aria-label={label} value={sel[k] ?? ''} onChange={(e) => setSel({ ...sel, [k]: e.target.value })}>
            {list.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        ))}
        <button className="small">Add</button>
      </form>
      <div className="stack" style={{ gap: 6, maxHeight: 320, overflowY: 'auto' }}>
        {items.map((i) => <div key={i.id}><b>{i.name}</b>{i.sub && <div className="muted">{i.sub}</div>}</div>)}
      </div>
    </section>
  );
}

// --- Reports -----------------------------------------------------------------

export function Reports({ me }) {
  const [by, setBy] = useState('department');
  const [period, setPeriod] = useState('month');
  const [filter, setFilter] = useState({});
  const { data, error } = useLoad(() => api(`/admin/participation${qs({ ...filter, by, period })}`), [by, period, JSON.stringify(filter)]);
  const [msg, setMsg] = useState('');

  async function download() {
    try {
      const csv = await api(`/admin/export.csv${qs({ ...filter, period })}`);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `challenges-report-${period}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setMsg(err.message);
    }
  }

  return (
    <>
      <div className="row between">
        <h1>Reports</h1>
        <button className="primary" onClick={download}>Export people report (CSV)</button>
      </div>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <Filters me={me} value={filter} onChange={setFilter} />
      </div>
      <div className="row">
        <Seg label="Group by" value={by} onChange={setBy} options={[['team', 'Team'], ['department', 'Department'], ['branch', 'Branch'], ['region', 'Region']]} />
        <Seg label="Period" value={period} onChange={setPeriod} options={[['day', 'Today'], ['week', 'This week'], ['month', 'This month'], ['all', 'All time']]} />
      </div>
      <Err error={error || msg} />
      <section className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>People</th><th>Taking part</th><th>Participation</th><th>Points earned</th></tr></thead>
            <tbody>
              {(data || []).map((p) => (
                <tr key={p.id}><td>{p.name}</td><td>{p.members}</td><td>{p.participants}</td><td>{p.rate}%</td><td>{fmt(p.points)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// --- Settings ----------------------------------------------------------------

export function Settings({ isStaff }) {
  const { data, error, reload } = useLoad(() => api('/admin/settings'), []);
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { if (data) setF(data); }, [data]);
  if (!f) return <h1>Settings</h1>;
  async function save(e) {
    e.preventDefault();
    try {
      await api('/admin/settings', { method: 'PUT', body: { ...f, maxPeerPoints: Number(f.maxPeerPoints), participationPoints: Number(f.participationPoints) } });
      setMsg('Saved');
      reload();
    } catch (err) {
      setMsg(err.message);
    }
  }
  return (
    <>
      <h1>Settings</h1>
      <Err error={error} />
      <form className="card" onSubmit={save}>
        {msg && <div className="notice">{msg}</div>}
        <div className="form">
          <label className="field">Employee challenges need approval
            <select disabled={!isStaff} value={f.approvalMode} onChange={(e) => setF({ ...f, approvalMode: e.target.value })}>
              <option value="groups">Only department, branch and region challenges</option>
              <option value="all">All of them</option>
              <option value="none">None</option>
            </select>
          </label>
          <label className="field">Most points an employee can put at stake
            <input disabled={!isStaff} type="number" min="0" value={f.maxPeerPoints} onChange={(e) => setF({ ...f, maxPeerPoints: e.target.value })} />
          </label>
          <label className="field">Points for finishing any challenge
            <input disabled={!isStaff} type="number" min="0" value={f.participationPoints} onChange={(e) => setF({ ...f, participationPoints: e.target.value })} />
          </label>
        </div>
        {isStaff ? <div><button className="primary">Save settings</button></div> : <p className="muted">Only HR can change these.</p>}
      </form>
    </>
  );
}
