import React, { useState } from "react";
import { Alert, FlatList, Pressable, Switch, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { IMAGE_TYPES, MAX_AVATAR_SIZE } from "../../lib/validation";
import type { Member, Post, StackParams } from "./types";
import { useSession } from "./session";
import { Avatar, Button, ErrorNotice, Field, Loading, Page, s, useJob, usePaged, useRemote } from "./ui";
import { PostCard } from "./posts";
import { disablePush, enablePush } from "./notifications";
import * as WebBrowser from "expo-web-browser";
import { serverUrl } from "./api";

type Navigation = NativeStackNavigationProp<StackParams>;
export function SearchScreen() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const navigation = useNavigation<Navigation>();
  const result = useRemote<{ users: Member[] }>(`users?q=${encodeURIComponent(search)}`);
  return <Page><Text style={s.title}>Find family</Text>
    <Field label="Search usernames" value={query} onChangeText={setQuery} autoCapitalize="none" returnKeyType="search" onSubmitEditing={() => setSearch(query)} />
    <Button title="Search" onPress={() => setSearch(query)} />
    <ErrorNotice error={result.error} retry={() => void result.reload()} />{result.loading && <Loading />}
    {result.data?.users.map((user) => <Pressable key={user.id} style={[s.card, s.row]} onPress={() => navigation.navigate("Profile", { username: user.username })}>
      <Avatar {...user} /><Text style={s.label}>{user.username}</Text>
    </Pressable>)}
    {result.data?.users.length === 0 && <Text style={s.muted}>No matching members in your feeds.</Text>}
  </Page>;
}
type Notice = {
  id: string; postId: string; actor: Member; type: string; readAt: string | null;
  feed: { name: string }; comment: { text: string } | null; post: { caption: string }; createdAt: string;
};
export function NotificationsScreen() {
  const { api, refresh } = useSession();
  const navigation = useNavigation<Navigation>();
  const result = usePaged<Notice>("notifications", "items");
  const { busy, run } = useJob();
  return <FlatList style={s.page} contentContainerStyle={s.content} data={result.items} keyExtractor={(item) => item.id}
    ListHeaderComponent={<View style={{ gap: 12 }}>
      <Button title="Notification settings" secondary onPress={() => navigation.navigate("Settings")} />
      <Button title="Mark all read" disabled={busy} onPress={() => void run(async () => { await api.command({ action: "readNotifications" }); await result.reload(); await refresh(); })} />
      <ErrorNotice error={result.error} retry={() => void result.reload()} />
    </View>}
    renderItem={({ item }) => <Pressable style={s.card} onPress={() => navigation.navigate("Post", { id: item.postId })}>
      <Text style={s.label}>{!item.readAt ? "New - " : ""}{item.actor.username} {item.type === "mention" ? "mentioned you" : item.type === "comment" ? "commented on your post" : "shared a new post"}</Text>
      <Text style={s.body}>{item.comment?.text ?? item.post.caption}</Text>
      <Text style={s.muted}>{item.feed.name} · {new Date(item.createdAt).toLocaleString()}</Text>
    </Pressable>}
    refreshing={result.loading} onRefresh={() => void result.reload()}
    ListEmptyComponent={!result.loading && !result.error ? <Text style={s.muted}>Nothing new yet. Family updates will appear here.</Text> : undefined}
    ListFooterComponent={result.loading ? <Loading /> : result.hasMore ? <Button title="More notifications" onPress={() => void result.next()} secondary /> : undefined} />;
}

type Shared = { id: string; fromUser: Member; message: string; readAt: string | null; post: Post };
export function SharedScreen() {
  const { api, refresh } = useSession();
  const result = usePaged<Shared>("shares", "items");
  const { busy, run } = useJob();
  return <FlatList style={s.page} contentContainerStyle={s.content} data={result.items} keyExtractor={(item) => item.id}
    ListHeaderComponent={<View style={{ gap: 12 }}><Button title="Mark all read" disabled={busy} onPress={() => void run(async () => {
      await api.command({ action: "readShares" }); await result.reload(); await refresh();
    })} /><ErrorNotice error={result.error} retry={() => void result.reload()} /></View>}
    renderItem={({ item }) => <View style={{ gap: 8 }}><Text style={s.label}>{item.fromUser.username} sent you a post{!item.readAt ? " · New" : ""}</Text>
      {!!item.message && <Text style={s.body}>{item.message}</Text>}<PostCard post={item.post} reload={result.reload} /></View>}
    refreshing={result.loading} onRefresh={() => void result.reload()}
    ListEmptyComponent={!result.loading && !result.error ? <Text style={s.muted}>Posts sent to you by family members will appear here.</Text> : undefined}
    ListFooterComponent={result.loading ? <Loading /> : result.hasMore ? <Button title="More shared posts" secondary onPress={() => void result.next()} /> : undefined} />;
}

export function SettingsScreen() {
  const { api, me, refresh, signOut } = useSession();
  const result = useRemote<{ users: Member[]; mutedUserIds: string[] }>("settings");
  const { busy, run } = useJob();
  const navigation = useNavigation<Navigation>();
  return <Page><Text style={s.title}>Your family account</Text>
    <View style={s.card}><Text style={s.label}>Device notifications</Text>
      <Text style={s.muted}>Alerts use a generic message, without family names or captions on the lock screen.</Text>
      <Button title="Enable on this device" disabled={busy} onPress={() => void run(async () => { await enablePush(api); Alert.alert("Notifications enabled"); })} />
      <Button title="Disable on this device" secondary disabled={busy} onPress={() => void run(async () => { await disablePush(api); Alert.alert("Notifications disabled"); })} />
    </View>
    {me && <View style={s.card}><View style={s.row}><Avatar {...me.user} /><Text style={s.label}>@{me.user.username}</Text></View>
      <Button title="Change profile photo" disabled={busy} secondary onPress={() => void run(async () => {
        const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
        if (picked.canceled) return;
        const file = new File(picked.assets[0].uri);
        if (!IMAGE_TYPES.includes(file.type) || file.size > MAX_AVATAR_SIZE) throw new Error("Choose a supported image smaller than 5 MB.");
        const form = new FormData(); form.append("photo", file);
        await api.request("/api/native/avatar", form); await refresh();
      })} />
      <Button title="View my profile" secondary onPress={() => navigation.navigate("Profile", { username: me.user.username })} />
      <Button title="Manage passkeys in browser" secondary disabled={busy} onPress={() => void run(async () => { await WebBrowser.openBrowserAsync(`${serverUrl}/profile/${encodeURIComponent(me.user.username)}`); })} />
      <Button title="Manage feeds and invites" secondary onPress={() => navigation.navigate("Feeds")} />
      {me.user.role === "admin" && <Button title="Administration" secondary onPress={() => navigation.navigate("Admin")} />}
    </View>}
    <ErrorNotice error={result.error} retry={() => void result.reload()} />{result.loading && <Loading />}
    <Text style={s.label}>New-post alerts</Text><Text style={s.muted}>Turn off posts from individual members. Mentions still notify you.</Text>
    {result.data?.users.filter((user) => user.id !== me?.user.id).map((user) => <View key={user.id} style={[s.card, s.row]}>
      <Text style={[s.label, { flex: 1 }]}>{user.username}</Text>
      <Switch accessibilityLabel={`New-post alerts from ${user.username}`} disabled={busy} value={!result.data?.mutedUserIds.includes(user.id)} onValueChange={(enabled) => void run(async () => {
        await api.command({ action: "mute", userId: user.id, muted: !enabled }); await result.reload();
      })} />
    </View>)}
    <Button title="Sign out" disabled={busy} onPress={() => void run(async () => { await disablePush(api); await signOut(); })} />
  </Page>;
}
