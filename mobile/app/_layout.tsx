import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { Loading } from '@/components/ui';
import { SessionProvider, useSession } from '@/lib/session';
import { colors } from '@/lib/theme';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

const theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.bg, primary: colors.accent, text: colors.ink, card: colors.card, border: colors.line },
};

function Navigator() {
  const { ready } = useSession();
  if (!ready) return <Loading />;
  return (
    <Stack screenOptions={{ headerTintColor: colors.ink, headerShadowVisible: false, headerStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="challenge/[id]" options={{ title: 'Challenge' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider value={theme}>
      <SessionProvider>
        <StatusBar style="dark" />
        <Navigator />
      </SessionProvider>
    </ThemeProvider>
  );
}
