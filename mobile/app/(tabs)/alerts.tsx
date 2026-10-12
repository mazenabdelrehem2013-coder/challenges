import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorText, Muted, Title } from '@/components/ui';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { ago, colors } from '@/lib/theme';

interface Note { id: number; text: string; challengeId: number | null; read: boolean; createdAt: string }

export default function Alerts() {
  const { data, error, refresh, refreshing } = useApi<Note[]>('/notifications');

  // Opening this tab marks everything as read.
  useFocusEffect(
    useCallback(() => {
      api('/notifications/read', { method: 'POST' }).catch(() => {});
    }, [])
  );

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 10 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <Title>Alerts</Title>
        <ErrorText error={error} />
        {(data || []).map((n) => (
          <Pressable
            key={n.id}
            accessibilityRole={n.challengeId ? 'button' : undefined}
            disabled={!n.challengeId}
            onPress={() => n.challengeId && router.push(`/challenge/${n.challengeId}`)}
            style={{ backgroundColor: colors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: n.read ? colors.line : colors.accent, flexDirection: 'row', gap: 10 }}
          >
            {!n.read && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, marginTop: 6 }} />}
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 15, color: colors.ink }}>{n.text}</Text>
              <Muted>{ago(n.createdAt)}</Muted>
            </View>
          </Pressable>
        ))}
        {data && data.length === 0 && <Muted>Nothing yet. You'll see new challenges, results and badges here.</Muted>}
      </ScrollView>
    </SafeAreaView>
  );
}
