import { Link, Stack } from 'expo-router';
import { Text, View } from 'react-native';

import { colors } from '@/lib/theme';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 12, backgroundColor: colors.bg }}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink }}>This screen doesn't exist.</Text>
        <Link href="/" style={{ color: colors.accent, fontSize: 16, paddingVertical: 12 }}>Go home</Link>
      </View>
    </>
  );
}
