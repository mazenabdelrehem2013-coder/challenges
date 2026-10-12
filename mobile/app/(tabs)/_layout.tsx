import { SymbolView } from 'expo-symbols';
import { Redirect, Tabs } from 'expo-router';
import { View, type ColorValue } from 'react-native';

import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';

type Sym = React.ComponentProps<typeof SymbolView>['name'];

function icon(name: Sym) {
  return ({ color }: { color: ColorValue }) => <SymbolView name={name} tintColor={color} size={24} />;
}

export default function TabLayout() {
  const { me } = useSession();
  if (!me) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.line },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon({ ios: 'house', android: 'home', web: 'home' }) }} />
      <Tabs.Screen name="leaderboard" options={{ title: 'Ranks', tabBarIcon: icon({ ios: 'chart.bar', android: 'leaderboard', web: 'leaderboard' }) }} />
      <Tabs.Screen
        name="new"
        options={{
          title: 'Challenge',
          tabBarAccessibilityLabel: 'Challenge someone',
          tabBarIcon: () => (
            <View style={{ width: 48, height: 40, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
              <SymbolView name={{ ios: 'plus', android: 'add', web: 'add' }} tintColor="#FFFFFF" size={24} />
            </View>
          ),
          tabBarLabel: () => null,
        }}
      />
      <Tabs.Screen name="alerts" options={{ title: 'Alerts', tabBarIcon: icon({ ios: 'bell', android: 'notifications', web: 'notifications' }) }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon({ ios: 'person', android: 'person', web: 'person' }) }} />
    </Tabs>
  );
}
