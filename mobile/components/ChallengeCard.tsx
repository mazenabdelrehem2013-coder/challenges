import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import type { Challenge } from '@/lib/api';
import { colors, fmt, SCOPE_LABEL, STATUS_LABEL, timeLeft } from '@/lib/theme';
import { ProgressBar } from './ui';

// Big card for a live challenge, showing my side against the leader.
export function ChallengeCard({ c }: { c: Challenge }) {
  const mine = c.sides.find((s) => s.sideId === c.mySideId);
  const best = Math.max(...c.sides.map((s) => s.score), 0);
  const leader = c.sides.find((s) => s.score === best && best > 0);
  const highlight = c.official;
  const fg = highlight ? '#FFFFFF' : colors.ink;
  const sub = highlight ? '#E6E4FF' : colors.muted;
  const unit = c.unit ? ` ${c.unit}` : '';

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/challenge/${c.id}`)}
      style={{
        backgroundColor: highlight ? colors.accent : colors.card,
        borderRadius: 20,
        padding: 18,
        gap: 12,
        borderWidth: highlight ? 0 : 1,
        borderColor: colors.line,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 12, fontWeight: '700', letterSpacing: 1, color: sub }}>
          {c.official ? 'OFFICIAL' : c.status === 'active' ? 'LIVE' : STATUS_LABEL[c.status].toUpperCase()}
          {c.scope !== 'person' ? ` · ${c.sides.length} ${SCOPE_LABEL[c.scope].toUpperCase()}` : ''}
        </Text>
        <Text style={{ fontSize: 13, color: sub }}>{c.status === 'completed' ? 'Finished' : timeLeft(c.endsAt)}</Text>
      </View>
      <Text style={{ fontSize: 20, fontWeight: '700', color: fg }}>{c.title}</Text>
      {mine && best > 0 && (
        <>
          <ProgressBar value={mine.score / best} color={colors.gold} track={highlight ? 'rgba(255,255,255,0.3)' : colors.line} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 14, color: fg }}>
              {mine.name === leader?.name ? 'You lead' : `You: ${fmt(mine.score)}${unit}`}
            </Text>
            <Text style={{ fontSize: 14, color: fg }}>
              {leader && mine.name !== leader.name ? `${leader.name}: ${fmt(leader.score)}` : `${fmt(mine.score)}${unit}`}
            </Text>
          </View>
        </>
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 14, color: sub }}>{c.reward || (best === 0 ? 'No progress yet' : '')}</Text>
        <Text style={{ fontSize: 14, fontWeight: '700', color: highlight ? colors.gold : colors.goldInk }}>+{c.points} pts</Text>
      </View>
    </Pressable>
  );
}
