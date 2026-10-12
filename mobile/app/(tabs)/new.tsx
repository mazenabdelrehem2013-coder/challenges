import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Chip, ErrorText, Field, Label, Muted, Title } from '@/components/ui';
import { api, type Challenge, type Named, type Scope } from '@/lib/api';
import { colors, SCOPE_LABEL, SCOPE_SINGULAR } from '@/lib/theme';

const TYPES = [['fitness', 'Fitness'], ['learning', 'Learning'], ['work', 'Work goal'], ['custom', 'Custom']] as const;
const JUDGING = [['tracked', 'Logged numbers'], ['proof', 'Photo proof'], ['manager', 'Manager']] as const;
const DURATIONS = [[3, '3 days'], [7, '1 week'], [14, '2 weeks'], [30, '1 month']] as const;

export default function NewChallenge() {
  const [scope, setScope] = useState<Scope>('person');
  const [targets, setTargets] = useState<{ mine: Named; targets: Named[] } | null>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Named[]>([]);
  const [type, setType] = useState<(typeof TYPES)[number][0]>('fitness');
  const [title, setTitle] = useState('');
  const [unit, setUnit] = useState('');
  const [days, setDays] = useState<number>(7);
  const [points, setPoints] = useState('150');
  const [judging, setJudging] = useState<(typeof JUDGING)[number][0]>('tracked');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPicked([]);
    setQuery('');
  }, [scope]);

  useEffect(() => {
    const t = setTimeout(() => {
      api<{ mine: Named; targets: Named[] }>(`/challenges/targets?scope=${scope}&q=${encodeURIComponent(query)}`)
        .then(setTargets)
        .catch((err) => setError(err.message));
    }, 200);
    return () => clearTimeout(t);
  }, [scope, query]);

  function toggle(t: Named) {
    setPicked((p) => (p.some((x) => x.id === t.id) ? p.filter((x) => x.id !== t.id) : [...p, t]));
  }

  async function send() {
    setBusy(true);
    setError('');
    try {
      const c = await api<Challenge>('/challenges', {
        method: 'POST',
        body: {
          title,
          type,
          scope,
          unit: unit || undefined,
          judging,
          points: Number(points) || 0,
          opponents: picked.map((p) => p.id),
          endsAt: new Date(Date.now() + days * 864e5).toISOString(),
        },
      });
      setTitle('');
      setPicked([]);
      router.push(`/challenge/${c.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const needsApproval = ['department', 'branch', 'region'].includes(scope);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 18 }} keyboardShouldPersistTaps="handled">
          <Title>New challenge</Title>

          <View style={{ gap: 8 }}>
            <Label>Challenge between</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => (
                <Chip key={s} label={SCOPE_LABEL[s]} selected={scope === s} onPress={() => setScope(s)} />
              ))}
            </View>
          </View>

          <View style={{ gap: 8 }}>
            <Field
              label={scope === 'person' ? 'Who are you challenging?' : `Your ${SCOPE_SINGULAR[scope]} (${targets?.mine.name ?? '…'}) vs.`}
              placeholder={`Search ${SCOPE_LABEL[scope].toLowerCase()}`}
              value={query}
              onChangeText={setQuery}
            />
            {picked.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {picked.map((p) => <Chip key={p.id} label={`${p.name} ✕`} selected onPress={() => toggle(p)} />)}
              </View>
            )}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {(targets?.targets || [])
                .filter((t) => !picked.some((p) => p.id === t.id))
                .slice(0, 12)
                .map((t) => <Chip key={t.id} label={t.name} onPress={() => toggle(t)} />)}
            </View>
          </View>

          <View style={{ gap: 8 }}>
            <Label>Type</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {TYPES.map(([v, l]) => <Chip key={v} label={l} selected={type === v} onPress={() => setType(v)} />)}
            </View>
          </View>

          <Field label="The goal" placeholder="e.g. Most steps this week" value={title} onChangeText={setTitle} maxLength={120} />
          <Field label="What do you count? (optional)" placeholder="e.g. steps, books, tickets" value={unit} onChangeText={setUnit} maxLength={40} />

          <View style={{ gap: 8 }}>
            <Label>How long</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {DURATIONS.map(([d, l]) => <Chip key={d} label={l} selected={days === d} onPress={() => setDays(d)} />)}
            </View>
          </View>

          <Field label="Points at stake" value={points} onChangeText={(v) => setPoints(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" />

          <View style={{ gap: 8 }}>
            <Label>How is the winner decided?</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {JUDGING.map(([v, l]) => <Chip key={v} label={l} selected={judging === v} onPress={() => setJudging(v)} />)}
            </View>
            {scope !== 'person' && <Muted>Each group scores the exact total of its people, and everyone sees each person's score.</Muted>}
          </View>

          <ErrorText error={error} />
          {needsApproval && <Text style={{ color: colors.muted, fontSize: 13 }}>This challenge goes to HR for approval before it starts.</Text>}
          <Button title="Send challenge" onPress={send} busy={busy} disabled={!title.trim() || picked.length === 0} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
