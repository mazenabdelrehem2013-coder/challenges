import { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { colors, initials } from '@/lib/theme';

export function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ flex: 1, backgroundColor: colors.bg }, style]}>{children}</View>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Heading({ children }: { children: ReactNode }) {
  return <Text style={styles.heading}>{children}</Text>;
}

export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[styles.muted, style]}>{children}</Text>;
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  busy,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'dark';
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
}) {
  const bg = kind === 'primary' ? colors.accent : kind === 'dark' ? colors.ink : colors.card;
  const fg = kind === 'secondary' ? colors.ink : '#FFFFFF';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderWidth: kind === 'secondary' ? 1 : 0, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={[styles.chip, selected ? { backgroundColor: colors.ink, borderColor: colors.ink } : null]}
    >
      <Text style={[styles.chipText, selected ? { color: '#FFFFFF', fontWeight: '700' } : null]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor="#8A93A6" style={styles.input} {...props} />
    </View>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Avatar({ name, size = 40, tint = '#DCE7FF', ink = '#1D3A8A' }: { name: string; size?: number; tint?: string; ink?: string }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: ink, fontWeight: '700', fontSize: size * 0.36 }}>{initials(name)}</Text>
    </View>
  );
}

export function ProgressBar({ value, color = colors.accent, track = colors.line, height = 8 }: { value: number; color?: string; track?: string; height?: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <View style={{ height, backgroundColor: track, borderRadius: height }}>
      <View style={{ width: `${pct}%`, height, backgroundColor: color, borderRadius: height }} />
    </View>
  );
}

export function ErrorText({ error }: { error?: string | null }) {
  if (!error) return null;
  return (
    <Text accessibilityRole="alert" style={styles.error}>
      {error}
    </Text>
  );
}

export function Loading() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

export const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.line, gap: 12 },
  title: { fontSize: 24, fontWeight: '700', color: colors.ink },
  heading: { fontSize: 16, fontWeight: '700', color: colors.ink },
  muted: { fontSize: 13, color: colors.muted },
  label: { fontSize: 14, fontWeight: '700', color: colors.ink },
  button: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderColor: colors.lineStrong },
  buttonText: { fontSize: 16, fontWeight: '700' },
  chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.card, justifyContent: 'center' },
  chipText: { fontSize: 14, color: colors.ink },
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.card, paddingHorizontal: 14, fontSize: 15, color: colors.ink },
  error: { backgroundColor: colors.badSoft, color: colors.bad, padding: 12, borderRadius: 12, fontSize: 14 },
});
