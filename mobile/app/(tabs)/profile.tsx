import { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar, Button, Card, ErrorText, Heading, Muted, ProgressBar } from '@/components/ui';
import type { Profile as ProfileData } from '@/lib/api';
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

export default function Profile() {
  const { signOut } = useSession();
  const [confirm, setConfirm] = useState(false);
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

            {confirm ? (
              <Card style={{ gap: 10 }}>
                <Text style={{ fontWeight: '700', color: colors.ink }}>Sign out of this phone?</Text>
                <Muted>You joined without a password, so signing out loses this account, its points and badges.</Muted>
                <Button title="Sign out anyway" kind="secondary" onPress={signOut} />
                <Button title="Keep me signed in" onPress={() => setConfirm(false)} />
              </Card>
            ) : (
              <Button title="Sign out" kind="secondary" onPress={() => setConfirm(true)} />
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
