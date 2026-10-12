export const colors = {
  ink: '#101828',
  muted: '#4A5468',
  line: '#E3E6EE',
  lineStrong: '#C9CEDB',
  bg: '#F3F4F8',
  card: '#FFFFFF',
  accent: '#3530C9',
  accentSoft: '#EEEAFF',
  accentInk: '#221E96',
  night: '#14123A',
  gold: '#FFC93C',
  goldSoft: '#FFF4D6',
  goldInk: '#6B4700',
  good: '#11643A',
  goodSoft: '#E4F6EC',
  bad: '#A3170B',
  badSoft: '#FDE8E6',
};

export const SCOPE_LABEL = {
  person: 'People',
  team: 'Teams',
  department: 'Departments',
  branch: 'Branches',
  region: 'Regions',
} as const;

export const SCOPE_SINGULAR = {
  person: 'person',
  team: 'team',
  department: 'department',
  branch: 'branch',
  region: 'region',
} as const;

export const STATUS_LABEL: Record<string, string> = {
  pending_approval: 'Waiting for approval',
  invited: 'Waiting for opponent',
  active: 'Live',
  completed: 'Finished',
  rejected: 'Not approved',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

export const fmt = (n: number) => Math.round(n * 10) / 10 === Math.round(n) ? Math.round(n).toLocaleString() : (Math.round(n * 10) / 10).toLocaleString();

export function timeLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Ended';
  const days = Math.floor(ms / 864e5);
  if (days >= 1) return `${days} day${days > 1 ? 's' : ''} left`;
  const hours = Math.max(1, Math.floor(ms / 36e5));
  return `${hours}h left`;
}

export function ago(sqlOrIso: string) {
  const t = new Date(sqlOrIso.includes('T') ? sqlOrIso : `${sqlOrIso.replace(' ', 'T')}Z`).getTime();
  const mins = Math.floor((Date.now() - t) / 6e4);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
