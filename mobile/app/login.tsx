import { Redirect } from 'expo-router';
import { signInAnonymously } from 'firebase/auth';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Chip, ErrorText, Field, Label, Muted } from '@/components/ui';
import { auth, backend } from '@/lib/firebase';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';

type Team = { id: string; name: string; department: string; branch: string };

// Joining takes a name and a team. No email or password: Firebase gives this phone
// an anonymous account and remembers it.
export default function Join() {
  const { me, join } = useSession();
  const [name, setName] = useState('');
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [teamId, setTeamId] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (!auth.currentUser) await signInAnonymously(auth);
        setTeams(await backend.joinOptions());
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  if (me) return <Redirect href="/" />;

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await join(name.trim(), teamId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const needle = search.trim().toLowerCase();
  const shown = (teams || []).filter((t) => !needle || `${t.name} ${t.department} ${t.branch}`.toLowerCase().includes(needle));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.night }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20, gap: 24 }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 8 }}>
            <Text style={{ color: colors.gold, fontSize: 14, fontWeight: '700', letterSpacing: 1 }}>CHALLENGES</Text>
            <Text style={{ color: '#FFFFFF', fontSize: 32, fontWeight: '700' }}>Challenge your colleagues.</Text>
            <Text style={{ color: '#D5D8F0', fontSize: 16 }}>Earn points, collect badges and climb the leaderboard.</Text>
          </View>
          <View style={{ backgroundColor: colors.card, borderRadius: 20, padding: 20, gap: 16 }}>
            <ErrorText error={error} />
            <Field label="Your name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" maxLength={60} />
            <View style={{ gap: 8 }}>
              <Label>Your team</Label>
              {teams && teams.length > 8 ? <Field label="Find your team" value={search} onChangeText={setSearch} /> : null}
              {teams === null && !error ? <Muted>Loading teams…</Muted> : null}
              {teams && !teams.length ? <Muted>No teams yet. Ask HR to add your team in the dashboard.</Muted> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {shown.slice(0, 40).map((t) => (
                  <Chip key={t.id} label={`${t.name} · ${t.branch}`} selected={teamId === t.id} onPress={() => setTeamId(t.id)} />
                ))}
              </View>
            </View>
            <Button title="Join" onPress={submit} busy={busy} disabled={!name.trim() || !teamId} />
            <Muted>No password needed. This phone remembers you.</Muted>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
