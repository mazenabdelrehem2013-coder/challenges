import { Redirect } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, ErrorText, Field, Muted } from '@/components/ui';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';

export default function Login() {
  const { me, signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (me) return <Redirect href="/" />;

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

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
            <Field label="Work email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" />
            <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" onSubmitEditing={submit} />
            <Button title="Sign in" onPress={submit} busy={busy} disabled={!email || !password} />
            <Muted>Your HR team gives you your account.</Muted>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
