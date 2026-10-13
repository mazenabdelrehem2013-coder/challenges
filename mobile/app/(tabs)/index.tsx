import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChallengeCard } from '@/components/ChallengeCard';
import { Avatar, Button, Card, ErrorText, Heading, Muted, Title } from '@/components/ui';
import { api, type Challenge, type Me } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { ago, colors, STATUS_LABEL } from '@/lib/theme';

interface Feed {
  me: Me;
  invites: Challenge[];
  activity: { id: string; kind: string; text: string; challengeId: string | null; createdAt: string }[];
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Home() {
  const feed = useApi<Feed>('/feed');
  const mine = useApi<Challenge[]>('/challenges');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function answer(c: Challenge, accept: boolean) {
    setBusy(c.id);
    try {
      await api(`/challenges/${c.id}/${accept ? 'accept' : 'decline'}`, { method: 'POST' });
      setError('');
      await Promise.all([feed.reload(), mine.reload()]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const me = feed.data?.me;
  const live = (mine.data || []).filter((c) => c.status === 'active');
  const waiting = (mine.data || []).filter((c) => ['pending_approval', 'invited'].includes(c.status) && c.myResponse !== 'pending');
  const refreshing = feed.refreshing || mine.refreshing;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 14 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { feed.refresh(); mine.refresh(); }} />}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ gap: 2, flexShrink: 1 }}>
            <Muted style={{ fontSize: 14 }}>{greeting()}{me ? `, ${me.name.split(' ')[0]}` : ''}</Muted>
            <Title>Your challenges</Title>
          </View>
          {me && (
            <View style={{ backgroundColor: colors.goldSoft, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 }}>
              <Text style={{ color: colors.goldInk, fontWeight: '700', fontSize: 15 }}>{me.points.toLocaleString()} pts</Text>
            </View>
          )}
        </View>

        <ErrorText error={error || feed.error || mine.error} />

        {(feed.data?.invites || []).map((c) => (
          <Card key={c.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Avatar name={c.createdBy.name} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, color: colors.ink }}>
                  <Text style={{ fontWeight: '700' }}>{c.createdBy.name.split(' ')[0]}</Text> challenged {c.scope === 'team' ? 'your team' : 'you'}
                </Text>
                <Muted>{c.title}</Muted>
              </View>
              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.goldInk }}>+{c.points}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="Accept" onPress={() => answer(c, true)} busy={busy === c.id} style={{ flex: 1 }} />
              <Button title="Decline" kind="secondary" onPress={() => answer(c, false)} disabled={busy === c.id} style={{ flex: 1 }} />
            </View>
          </Card>
        ))}

        {live.map((c) => <ChallengeCard key={c.id} c={c} />)}

        {mine.data && live.length === 0 && !(feed.data?.invites.length) && (
          <Card style={{ alignItems: 'flex-start' }}>
            <Heading>No live challenges yet</Heading>
            <Muted>Pick a colleague, team, department, branch or region and set a goal.</Muted>
            <Button title="Challenge someone" onPress={() => router.push('/new')} />
          </Card>
        )}

        {waiting.length > 0 && <Heading>Waiting to start</Heading>}
        {waiting.map((c) => (
          <Card key={c.id} style={{ paddingVertical: 14 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }} onPress={() => router.push(`/challenge/${c.id}`)}>
              {c.title}
            </Text>
            <Muted>{STATUS_LABEL[c.status]} · {c.sides.map((s) => s.name).join(' vs ')}</Muted>
          </Card>
        ))}

        {(feed.data?.activity.length ?? 0) > 0 && <Heading>Happening around you</Heading>}
        {(feed.data?.activity || []).slice(0, 12).map((a) => (
          <Card key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}>
            <View
              style={{
                width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                backgroundColor: a.kind === 'badge' ? colors.accentSoft : a.kind === 'result' ? colors.goodSoft : colors.goldSoft,
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: '700', color: a.kind === 'badge' ? colors.accentInk : a.kind === 'result' ? colors.good : colors.goldInk }}>
                {a.kind === 'badge' ? 'NEW' : a.kind === 'result' ? 'WIN' : 'GO'}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, color: colors.ink }}>{a.text}</Text>
              <Muted>{ago(a.createdAt)}</Muted>
            </View>
          </Card>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
