import React, { useState } from "react";
import { Alert, Share, Text, View } from "react-native";
import { Picker } from "@react-native-picker/picker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { serverUrl } from "./api";
import { useSession } from "./session";
import type { Member, Post, StackParams, User } from "./types";
import { Button, confirm, ErrorNotice, Field, Loading, Page, s, useJob, usePaged, useRemote } from "./ui";

type ManagedFeed = { id: string; name: string; description: string; canManage: boolean; _count: { memberships: number } };
export function FeedsScreen({ navigation }: NativeStackScreenProps<StackParams, "Feeds">) {
  const { api, me, refresh } = useSession();
  const result = useRemote<{ feeds: ManagedFeed[] }>("feeds");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const { busy, run } = useJob();
  return <Page><Text style={s.title}>Private feeds</Text><ErrorNotice error={result.error} retry={() => void result.reload()} />{result.loading && <Loading />}
    {result.data?.feeds.map((feed) => <View key={feed.id} style={s.card}>
      <Text style={s.label}>{feed.name}</Text><Text style={s.body}>{feed.description}</Text><Text style={s.muted}>{feed._count.memberships} members</Text>
      {feed.canManage && <Button title="Members and invites" secondary onPress={() => navigation.navigate("Feed", { id: feed.id, name: feed.name })} />}
    </View>)}
    {me?.user.role === "admin" && <View style={s.card}><Text style={s.label}>Create a feed</Text>
      <Field label="Feed name" value={name} onChangeText={setName} maxLength={50} />
      <Field label="Description" value={description} onChangeText={setDescription} maxLength={200} />
      <Button title="Create feed" disabled={busy || !name.trim()} onPress={() => void run(async () => {
        await api.command({ action: "createFeed", name, description }); setName(""); setDescription(""); await result.reload(); await refresh();
      })} />
    </View>}
  </Page>;
}
type FeedDetails = {
  feed: { id: string; memberships: { id: string; role: string; user: Member }[]; invites: { id: string; token: string; expiresAt: string }[] };
  users: Member[];
};
export function FeedScreen({ route }: NativeStackScreenProps<StackParams, "Feed">) {
  const { api, me, refresh } = useSession();
  const result = useRemote<FeedDetails>(`feed/${encodeURIComponent(route.params.id)}`);
  const [userId, setUserId] = useState("");
  const { busy, run } = useJob();
  const feedId = route.params.id;
  const updated = async () => { await result.reload(); await refresh(); };
  return <Page><Text style={s.title}>{route.params.name}</Text><ErrorNotice error={result.error} retry={() => void result.reload()} />{result.loading && <Loading />}
    {result.data && <>
      <Button title="Create and share invite" disabled={busy} onPress={() => void run(async () => {
        const invite = await api.command({ action: "invite", feedId }); await result.reload();
        if (invite.token) await Share.share({ message: `${serverUrl}/invite/${invite.token}` });
      })} />
      {result.data.feed.invites.map((invite) => <View key={invite.id} style={s.card}>
        <Text style={s.muted}>Invite expires {new Date(invite.expiresAt).toLocaleDateString()}</Text>
        <Button title="Share invite link" secondary onPress={() => void Share.share({ message: `${serverUrl}/invite/${invite.token}` }).catch((e: Error) => Alert.alert("Could not share", e.message))} />
        {me?.user.role === "admin" && <Button title="Revoke invite" disabled={busy} secondary onPress={() => confirm("Revoke this invite?", "The link will no longer work.", () => void run(async () => {
          await api.command({ action: "deleteInvite", inviteId: invite.id }); await updated();
        }))} />}
      </View>)}
      {result.data.feed.memberships.map((member) => <View key={member.id} style={s.card}>
        <Text style={s.label}>{member.user.username} · {member.role}</Text>
        {me?.user.role === "admin" && <Button title={member.role === "manager" ? "Make member" : "Make manager"} disabled={busy} secondary onPress={() => confirm("Change feed role?", `Change ${member.user.username}'s access in this feed.`, () => void run(async () => {
          await api.command({ action: "memberRole", feedId, userId: member.user.id, role: member.role === "manager" ? "member" : "manager" }); await updated();
        }))} />}
        <Button title="Remove from feed" secondary disabled={busy} onPress={() => confirm("Remove member?", `${member.user.username} will lose access to this feed.`, () => void run(async () => {
          await api.command({ action: "removeMember", feedId, userId: member.user.id }); await updated();
        }))} />
      </View>)}
      <View style={s.card}><Text style={s.label}>Add an existing member</Text>
        <Picker accessibilityLabel="Member to add" selectedValue={userId} onValueChange={setUserId}><Picker.Item label="Choose a member" value="" />
          {result.data.users.filter((user) => !result.data?.feed.memberships.some((m) => m.user.id === user.id)).map((user) => <Picker.Item key={user.id} label={user.username} value={user.id} />)}
        </Picker>
        <Button title="Add to feed" disabled={busy || !userId} onPress={() => void run(async () => {
          await api.command({ action: "addMember", feedId, userId }); setUserId(""); await updated();
        })} />
      </View>
    </>}
  </Page>;
}

function AdminMember({ user, reload }: { user: User; reload: () => Promise<void> }) {
  const { api, me } = useSession();
  const [password, setPassword] = useState("");
  const { busy, run } = useJob();
  return <View style={s.card}><Text style={s.label}>{user.username} · {user.role}</Text>
    <Field label={`New password for ${user.username}`} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" maxLength={100} />
    <Button title="Reset password" disabled={busy || password.length < 8} secondary onPress={() => confirm("Reset password?", `${user.username} will need the new password to sign in.`, () => void run(async () => {
      await api.command({ action: "adminPassword", userId: user.id, password }); setPassword(""); Alert.alert("Password reset");
    }))} />
    {user.id !== me?.user.id && <>
      <Button title={user.role === "admin" ? "Remove admin access" : "Grant admin access"} secondary disabled={busy} onPress={() => confirm("Change admin access?", `Change ${user.username}'s permissions across Famstagram.`, () => void run(async () => {
        await api.command({ action: "adminRole", userId: user.id, role: user.role === "admin" ? "member" : "admin" }); await reload();
      }))} />
      <Button title="Delete account and posts" danger disabled={busy} onPress={() => confirm("Permanently delete account?", `This deletes ${user.username}'s account and all their posts.`, () => void run(async () => {
        await api.command({ action: "adminDeleteUser", userId: user.id }); await reload();
      }))} />
    </>}
  </View>;
}
export function AdminScreen() {
  const { api } = useSession();
  const result = useRemote<{ users: User[] }>("admin");
  const posts = usePaged<Post>("admin", "posts");
  const { busy, run } = useJob();
  return <Page><Text style={s.title}>Administration</Text><ErrorNotice error={result.error ?? posts.error} retry={() => { void result.reload(); void posts.reload(); }} />{result.loading && <Loading />}
    {result.data?.users.map((user) => <AdminMember key={user.id} user={user} reload={result.reload} />)}
    <Text style={s.title}>Moderate posts</Text>
    {posts.items.map((post) => <View key={post.id} style={s.card}><Text style={s.label}>{post.author.username} · {post.feed.name}</Text><Text style={s.body}>{post.caption || "Photo or video post"}</Text>
      <Button title="Delete post" danger disabled={busy} onPress={() => confirm("Permanently delete post?", "The media, comments and likes will also be deleted.", () => void run(async () => {
        await api.command({ action: "adminDeletePost", postId: post.id }); await posts.reload();
      }))} />
    </View>)}
    {posts.loading ? <Loading /> : posts.hasMore && <Button title="More posts" secondary onPress={() => void posts.next()} />}
  </Page>;
}
