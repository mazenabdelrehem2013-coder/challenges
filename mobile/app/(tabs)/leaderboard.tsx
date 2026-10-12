import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar, ErrorText, Muted } from '@/components/ui';
import type { Scope } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { colors, fmt, SCOPE_LABEL } from '@/lib/theme';

interface Row { id: number; name: string; score: number; members: number; rank: number; me: boolean }

const PERIODS = [['week', 'This week'], ['month', 'This month'], ['all', 'All time']] as const;
const PODIUM = [
  { place: 2, height: 72, tint: '#DCE7FF', ink: '#1D3A8A', ring: '#C7CDD9' },
  { place: 1, height: 100, tint: colors.goldSoft, ink: colors.goldInk, ring: colors.gold },
  { place: 3, height: 56, tint: colors.goodSoft, ink: colors.good, ring: '#D9A066' },
];

export default function Leaderboard() {
  const [scope, setScope] = useState<Scope>('person');
  const [period, setPeriod] = useState<(typeof PERIODS)[number][0]>('week');
  const { data, error, refresh, refreshing } = useApi<Row[]>(`/leaderboard?scope=${scope}&period=${period}`);
  const rows = data || [];
  const unit = 'pts';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: colors.night, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }}>
        <View style={{ padding: 20, paddingTop: 12, gap: 16 }}>
          <Text style={{ color: '#FFFFFF', fontSize: 24, fontWeight: '700' }}>Leaderboard</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => (
              <Pressable
                key={s}
                accessibilityRole="button"
                accessibilityState={{ selected: scope === s }}
                onPress={() => setScope(s)}
                style={{ minHeight: 36, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center', backgroundColor: scope === s ? '#FFFFFF' : 'rgba(255,255,255,0.12)' }}
              >
                <Text style={{ color: scope === s ? colors.night : '#FFFFFF', fontWeight: scope === s ? '700' : '500', fontSize: 13 }}>{SCOPE_LABEL[s]}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: 18 }}>
            {PERIODS.map(([p, l]) => (
              <Pressable key={p} accessibilityRole="button" accessibilityState={{ selected: period === p }} onPress={() => setPeriod(p)} style={{ minHeight: 32, justifyContent: 'center' }}>
                <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: period === p ? '700' : '400', opacity: period === p ? 1 : 0.8, borderBottomWidth: period === p ? 2 : 0, borderBottomColor: colors.gold, paddingBottom: 4 }}>{l}</Text>
              </Pressable>
            ))}
          </View>
          {rows.length >= 3 && (
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
              {PODIUM.map((p) => {
                const r = rows[p.place - 1];
                return (
                  <View key={p.place} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
                    <View style={{ borderWidth: 3, borderColor: p.ring, borderRadius: 999 }}>
                      <Avatar name={r.name} size={p.place === 1 ? 62 : 50} tint={p.tint} ink={p.ink} />
                    </View>
                    <Text numberOfLines={1} style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 14 }}>{r.name.split(' ')[0]}</Text>
                    <View style={{ width: '100%', height: p.height, borderTopLeftRadius: 12, borderTopRightRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: p.place === 1 ? colors.gold : 'rgba(255,255,255,0.14)' }}>
                      <Text style={{ fontSize: p.place === 1 ? 26 : 20, fontWeight: '700', color: p.place === 1 ? '#3A2700' : '#FFFFFF' }}>{p.place}</Text>
                      <Text style={{ fontSize: 12, color: p.place === 1 ? '#3A2700' : '#FFFFFF' }}>{fmt(r.score)} {unit}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </SafeAreaView>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 8 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <ErrorText error={error} />
        {rows.slice(rows.length >= 3 ? 3 : 0).map((r) => (
          <View
            key={r.id}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14,
              backgroundColor: r.me ? colors.accentSoft : colors.card, borderWidth: r.me ? 2 : 1, borderColor: r.me ? colors.accent : colors.line,
            }}
          >
            <Text style={{ width: 28, fontWeight: '700', color: colors.muted }}>{r.rank}</Text>
            <Avatar name={r.name} tint="#E9EBF2" ink={colors.ink} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>{r.name}{r.me ? ' (you)' : ''}</Text>
              {scope !== 'person' && <Muted>{r.members} people</Muted>}
            </View>
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>{fmt(r.score)}</Text>
          </View>
        ))}
        {data && rows.length === 0 && <Muted>Nobody has points yet. Be the first.</Muted>}
      </ScrollView>
    </View>
  );
}
