import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, Text, View } from 'react-native';

import { Button, Card, ErrorText, Field, Heading, Muted, ProgressBar } from '@/components/ui';
import { api, type Challenge } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { ago, colors, fmt, SCOPE_LABEL, STATUS_LABEL, timeLeft } from '@/lib/theme';

const JUDGING_TEXT = {
  tracked: 'Highest logged total wins.',
  proof: 'Each entry needs a photo or link, checked by a manager.',
  manager: 'A manager picks the winner at the end.',
};

export default function ChallengeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: c, error, reload, refresh, refreshing } = useApi<Challenge>(`/challenges/${id}`);
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [proofUrl, setProofUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function run(kind: string, path: string, body?: unknown) {
    setBusy(kind);
    setErr('');
    setMsg('');
    try {
      const res = await api<{ status?: string }>(path, { method: 'POST', body });
      if (kind === 'log') {
        setValue('');
        setNote('');
        setProofUrl('');
        setMsg(res.status === 'pending' ? 'Sent to your manager to check.' : 'Logged. Keep going!');
      }
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  if (!c) {
    return (
      <View style={{ flex: 1, padding: 20, backgroundColor: colors.bg }}>
        <ErrorText error={error} />
      </View>
    );
  }

  const best = Math.max(...c.sides.map((s) => s.score), 0);
  const sorted = [...c.sides].sort((a, b) => b.score - a.score);
  const canLog = c.status === 'active' && !!c.mySideId && new Date(c.endsAt) > new Date();
  const unit = c.unit ? ` ${c.unit}` : '';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: c.official ? 'Official challenge' : 'Challenge' }} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', letterSpacing: 1, color: colors.accent }}>
            {STATUS_LABEL[c.status].toUpperCase()} · {SCOPE_LABEL[c.scope].toUpperCase()}
          </Text>
          <Text style={{ fontSize: 24, fontWeight: '700', color: colors.ink }}>{c.title}</Text>
          {c.description ? <Text style={{ fontSize: 15, color: colors.ink }}>{c.description}</Text> : null}
          <Muted>
            By {c.createdBy.name} · {c.status === 'completed' ? 'Finished' : timeLeft(c.endsAt)} · +{c.points} pts{c.reward ? ` · ${c.reward}` : ''}
          </Muted>
          <Muted>{JUDGING_TEXT[c.judging]}{c.scope !== 'person' ? " Each group's score is the exact total of its people's scores." : ''}</Muted>
          {c.result ? <Text style={{ fontSize: 15, fontWeight: '700', color: colors.good }}>{c.result}</Text> : null}
          {c.status === 'active' && new Date(c.endsAt) <= new Date() ? (
            <Muted>Time is up. The result is added as soon as a manager or HR opens the dashboard.</Muted>
          ) : null}
          {c.rejectionReason ? <ErrorText error={`Not approved: ${c.rejectionReason}`} /> : null}
        </View>

        <ErrorText error={err || error} />
        {msg ? <Text style={{ backgroundColor: colors.goodSoft, color: colors.good, padding: 12, borderRadius: 12 }}>{msg}</Text> : null}

        {c.myResponse === 'pending' && c.status === 'invited' && (
          <Card>
            <Heading>Do you accept?</Heading>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="Accept" onPress={() => run('accept', `/challenges/${c.id}/accept`)} busy={busy === 'accept'} style={{ flex: 1 }} />
              <Button title="Decline" kind="secondary" onPress={() => run('decline', `/challenges/${c.id}/decline`)} disabled={!!busy} style={{ flex: 1 }} />
            </View>
          </Card>
        )}

        <Card>
          <Heading>Scoreboard</Heading>
          {sorted.map((s, i) => {
            const mine = s.sideId === c.mySideId;
            const won = c.winnerSideId === s.sideId;
            return (
              <View key={s.sideId} style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={{ flex: 1, fontSize: 15, fontWeight: mine || won ? '700' : '400', color: colors.ink }}>
                    {i + 1}. {s.name}{mine ? ' (you)' : ''}{won ? ' · Winner' : ''}
                  </Text>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>
                    {fmt(s.score)}{unit}
                  </Text>
                </View>
                <ProgressBar value={best ? s.score / best : 0} color={mine ? colors.accent : colors.lineStrong} />
                {c.scope !== 'person' && (
                  <View style={{ gap: 2, paddingLeft: 12 }}>
                    {s.people.map((p) => (
                      <View key={p.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                        <Text style={{ flex: 1, fontSize: 13, color: colors.muted }}>{p.name}</Text>
                        <Text style={{ fontSize: 13, color: p.score ? colors.ink : colors.muted }}>{fmt(p.score)}{unit}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {c.status === 'invited' && s.response === 'pending' && <Muted>Hasn't answered yet</Muted>}
              </View>
            );
          })}
        </Card>

        {canLog && (
          <Card>
            <Heading>Log progress</Heading>
            <Field label={`How much${unit ? ` (${c.unit})` : ''}?`} value={value} onChangeText={(v) => setValue(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="e.g. 8500" />
            {c.judging === 'proof' && (
              <Field label="Link to photo or proof" value={proofUrl} onChangeText={setProofUrl} autoCapitalize="none" keyboardType="url" placeholder="https://" />
            )}
            <Field label="Note (optional)" value={note} onChangeText={setNote} maxLength={500} />
            <Button
              title="Add"
              onPress={() => run('log', `/challenges/${c.id}/progress`, { value: Number(value), note: note || undefined, proofUrl: proofUrl || undefined })}
              busy={busy === 'log'}
              disabled={!Number(value)}
            />
          </Card>
        )}

        {(c.entries || []).length > 0 && (
          <View style={{ gap: 8 }}>
            <Heading>Latest entries</Heading>
            {(c.entries || []).slice(0, 20).map((e) => (
              <View key={e.id} style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.line }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, color: colors.ink }}>{e.userName}{e.note ? ` · ${e.note}` : ''}</Text>
                  <Muted>{ago(e.createdAt)}{e.status !== 'approved' ? ` · ${e.status === 'pending' ? 'waiting for check' : 'rejected'}` : ''}</Muted>
                </View>
                <Text style={{ fontSize: 14, fontWeight: '700', color: colors.ink }}>+{fmt(e.value)}{unit}</Text>
              </View>
            ))}
          </View>
        )}

        {c.status === 'pending_approval' && c.createdBy && <Muted>HR or your manager needs to approve this challenge before it starts.</Muted>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
