import React, { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSession } from "./session";

export const colors = {
  sky: "#0284c7", skyDark: "#0369a1", skyLight: "#e0f2fe",
  background: "#f5f5f5", paper: "#ffffff", ink: "#171717",
  muted: "#737373", line: "#e5e5e5", danger: "#b91c1c",
};
export const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 16, width: "100%", maxWidth: 680, alignSelf: "center" },
  card: { backgroundColor: colors.paper, borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: colors.line },
  row: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  title: { color: colors.ink, fontSize: 24, fontWeight: "700" },
  body: { color: colors.ink, fontSize: 14, lineHeight: 21 },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  label: { color: colors.ink, fontSize: 14, fontWeight: "600" },
  link: { color: colors.skyDark, fontSize: 14, fontWeight: "600" },
  input: { borderWidth: 1, borderColor: "#d4d4d4", backgroundColor: colors.paper, borderRadius: 8, padding: 12, color: colors.ink, fontSize: 16 },
  button: { minHeight: 44, backgroundColor: colors.sky, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 11, alignItems: "center", justifyContent: "center" },
  secondary: { backgroundColor: colors.skyLight },
  buttonText: { color: colors.paper, fontSize: 14, fontWeight: "600" },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.skyLight, alignItems: "center", justifyContent: "center" },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
export function Button({ title, onPress, disabled, secondary = false, danger = false }: {
  title: string; onPress: () => void; disabled?: boolean; secondary?: boolean; danger?: boolean;
}) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.button, secondary && s.secondary, danger && { backgroundColor: colors.danger }, { opacity: disabled || pressed ? 0.5 : 1 }]}>
    <Text style={[s.buttonText, secondary && { color: colors.skyDark }]}>{title}</Text>
  </Pressable>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return <View style={{ gap: 6 }}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor={colors.muted} {...props} style={[s.input, props.style]} /></View>;
}
export function Page({ children }: { children: React.ReactNode }) {
  return <ScrollView style={s.page} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">{children}</ScrollView>;
}
export function Avatar({ username, avatarKey }: { username: string; avatarKey: string | null }) {
  const { api } = useSession();
  return avatarKey ? <Image source={api.media(avatarKey)} style={s.avatar} accessibilityLabel={`${username}'s profile photo`} /> :
    <View style={s.avatar}><Text style={s.link}>{username.slice(0, 2).toUpperCase()}</Text></View>;
}
export function ErrorNotice({ error, retry }: { error: string | null; retry?: () => void }) {
  if (!error) return null;
  return <View accessibilityRole="alert" style={s.card}><Text style={s.error}>{error}</Text>{retry && <Button title="Try again" onPress={retry} secondary />}</View>;
}
export function useJob() {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = async (job: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await job(); } catch (error) {
      Alert.alert("Could not complete the action", error instanceof Error ? error.message : "Please try again.");
    } finally { lock.current = false; setBusy(false); }
  };
  return { busy, run };
}
export function useRemote<T>(path: string) {
  const { api } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setError(null);
    try {
      const value = await api.get<T>(path);
      if (current === generation.current) setData(value);
    } catch (e) {
      if (current === generation.current) setError(e instanceof Error ? e.message : "Could not load this page.");
    } finally { if (current === generation.current) setLoading(false); }
  }, [api, path]);
  useFocusEffect(useCallback(() => {
    setData(null); void reload();
    return () => { generation.current++; };
  }, [reload]));
  return { data, error, loading, reload };
}
export function Loading() { return <ActivityIndicator color={colors.sky} style={{ padding: 24 }} />; }
export function usePaged<T>(path: string, field: "items" | "posts") {
  const { api } = useSession();
  const [items, setItems] = useState<T[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const cursor = useRef(0);
  const generation = useRef(0);
  const locked = useRef(false);
  const load = useCallback(async (reset: boolean) => {
    if (!reset && locked.current) return;
    const current = reset ? ++generation.current : generation.current;
    const page = reset ? 1 : cursor.current + 1;
    locked.current = true; setLoading(true); setError(null);
    if (reset) { cursor.current = 0; setItems([]); }
    try {
      const data = await api.get<{ items?: T[]; posts?: T[]; hasMore: boolean }>(`${path}${path.includes("?") ? "&" : "?"}page=${page}`);
      if (current !== generation.current) return;
      const values = data[field];
      if (!Array.isArray(values)) throw new Error("The server returned an invalid list.");
      setItems((previous) => reset ? values : [...previous, ...values]);
      cursor.current = page; setHasMore(data.hasMore);
    } catch (e) {
      if (current === generation.current) setError(e instanceof Error ? e.message : "Could not load this page.");
    } finally { if (current === generation.current) { locked.current = false; setLoading(false); } }
  }, [api, field, path]);
  useFocusEffect(useCallback(() => {
    void load(true);
    return () => { generation.current++; locked.current = false; };
  }, [load]));
  return { items, loading, error, hasMore, reload: () => load(true), next: () => load(false) };
}
export function confirm(title: string, message: string, action: () => void) {
  Alert.alert(title, message, [{ text: "Cancel", style: "cancel" }, { text: "Confirm", style: "destructive", onPress: action }]);
}
