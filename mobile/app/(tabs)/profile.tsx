import { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar, Button, Card, ErrorText, Field, Heading, Muted, ProgressBar } from '@/components/ui';
import { api, type Profile as ProfileData } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/useApi';
import { colors } from '@/lib/theme';

const BADGE_COLORS: Record<string, [string, string]> = {
  first_win: [colors.goldSoft, colors.goldInk],
  hat_trick: ['#FFE6DA', '#A3360B'],
  streak_master: ['#FFE6DA', '#A3360B'],
  team_player: [colors.goodSoft, colors.good],
  giant_slayer: [colors.accentSoft, colors.accentInk],
  challenger: ['#DCE7FF', '#1D3A8A'],
  marathoner: ['#DCE7FF', '#1D3A8A'],
};

function Stat({ value, label, color = colors.ink }: { value: string; label: string; color?: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 12, alignItems: 'center', gap: 2 }}>
      <Text style={{ fontSize: 20, fontWeight: '700', color }}>{value}</Text>
      <Muted>{label}</Muted>
    </View>
  );
}

function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api('/me/password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      setCurrent('');
      setNext('');
      setOpen(false);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the password');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <View style={{ gap: 8 }}>
        {done && <Muted style={{ textAlign: 'center', color: colors.good }}>Password changed.</Muted>}
        <Button title="Change password" kind="secondary" onPress={() => { setDone(false); setOpen(true); }} />
      </View>
    );
  }
  return (
    <Card style={{ gap: 12 }}>
      <Heading>Change password</Heading>
      <Field label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="password" textContentType="password" />
      <Field label="New password (8+ characters)" value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
      <ErrorText error={error} />
      <Button title="Save new password" onPress={submit} busy={busy} disabled={!current || next.length < 8} />
      <Button title="Cancel" kind="secondary" onPress={() => { setOpen(false); setError(null); }} />
    </Card>
  );
}

export default function Profile() {
  const { signOut } = useSession();
  const { data: p, error, refresh, refreshing } = useApi<ProfileData>('/me');

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <ErrorText error={error} />
        {p && (
          <>
            <View style={{ alignItems: 'center', gap: 6 }}>
              <View style={{ borderWidth: 4, borderColor: colors.accent, borderRadius: 999 }}>
                <Avatar name={p.name} size={84} tint={colors.accentSoft} ink={colors.accentInk} />
              </View>
              <Text style={{ fontSize: 22, fontWeight: '700', color: colors.ink }}>{p.name}</Text>
              <Muted style={{ fontSize: 14 }}>{[p.title, p.team.name].filter(Boolean).join(' · ')}</Muted>
              <Muted>{p.branch.name} · {p.region.name} region</Muted>
              <View style={{ backgroundColor: colors.ink, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 }}>
                <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 13 }}>Level {p.level} · {p.levelName}</Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Stat value={p.points.toLocaleString()} label="Points" />
              <Stat value={`${p.record.won}–${p.record.lost}`} label="Won–lost" />
              <Stat value={`${p.streak}`} label="Win streak" color="#A3360B" />
            </View>

            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '700', fontSize: 13, color: colors.ink }}>Next level</Text>
                <Muted>{p.pointsToNext} pts to Level {p.level + 1}</Muted>
              </View>
              <ProgressBar value={p.progress} height={10} />
            </View>

            <Heading>Badges · {p.badges.filter((b) => b.earned).length} of {p.badges.length}</Heading>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {p.badges.map((b) => {
                const [bg, fg] = BADGE_COLORS[b.code] || [colors.accentSoft, colors.accentInk];
                return (
                  <View
                    key={b.code}
                    accessibilityLabel={`${b.name}: ${b.earned ? 'earned' : 'locked'}. ${b.description}`}
                    style={{ width: '31%', flexGrow: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 16, padding: 12, alignItems: 'center', gap: 6 }}
                  >
                    <View
                      style={{
                        width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center',
                        backgroundColor: b.earned ? bg : '#EEF0F4', borderWidth: b.earned ? 0 : 2, borderStyle: 'dashed', borderColor: '#B8BFCC',
                      }}
                    >
                      <Text style={{ fontSize: 18, fontWeight: '700', color: b.earned ? fg : '#8A93A6' }}>{b.name[0]}</Text>
                    </View>
                    <Text style={{ fontSize: 12, fontWeight: '700', textAlign: 'center', color: b.earned ? colors.ink : '#5B6478' }}>{b.name}</Text>
                    <Text style={{ fontSize: 11, textAlign: 'center', color: colors.muted }}>{b.description}</Text>
                  </View>
                );
              })}
            </View>

            <ChangePassword />
            <Button title="Sign out" kind="secondary" onPress={signOut} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
