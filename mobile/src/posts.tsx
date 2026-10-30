import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Image, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Picker } from "@react-native-picker/picker";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import { VideoView, useVideoPlayer } from "expo-video";
import { PhotoMap } from "./photo-map";
import { useSession } from "./session";
import type { Member, Post, StackParams } from "./types";
import { Avatar, Button, colors, confirm, ErrorNotice, Field, Loading, Page, s, useJob, usePaged, useRemote } from "./ui";

type Navigation = NativeStackNavigationProp<StackParams>;
function Video({ mediaKey }: { mediaKey: string }) {
  const { api } = useSession();
  const player = useVideoPlayer(api.media(mediaKey));
  useFocusEffect(useCallback(() => () => { player.pause(); }, [player]));
  return <VideoView style={{ width: "100%", height: 360 }} player={player} nativeControls contentFit="contain" />;
}

export function PostCard({ post, detail = false, reload }: { post: Post; detail?: boolean; reload: () => Promise<void> }) {
  const { api, me } = useSession();
  const navigation = useNavigation<Navigation>();
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width - 32, 648);
  const { busy, run } = useJob();
  const [slide, setSlide] = useState(0);
  const [like, setLike] = useState({ liked: post.liked, count: post.likeCount });
  useEffect(() => { setLike({ liked: post.liked, count: post.likeCount }); }, [post.liked, post.likeCount]);
  return <View style={[s.card, { padding: 0, overflow: "hidden", gap: 0 }]}>
    <View style={[s.row, { padding: 14, flexWrap: "nowrap" }]}>
      <Pressable onPress={() => navigation.navigate("Profile", { username: post.author.username })} accessibilityLabel={`View ${post.author.username}'s profile`}><Avatar {...post.author} /></Pressable>
      <View style={{ flex: 1 }}>
        <Pressable onPress={() => navigation.navigate("Profile", { username: post.author.username })}><Text style={s.label}>{post.author.username}</Text></Pressable>
        {post.locationName && <Text style={s.muted}>{post.locationName}</Text>}
        <Text style={s.muted}>{new Date(post.createdAt).toLocaleString()}</Text>
      </View>
      <Text style={[s.muted, { color: colors.skyDark }]}>{post.feed.name}</Text>
    </View>
    <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={(event) => setSlide(Math.round(event.nativeEvent.contentOffset.x / cardWidth))}>
      {post.media.map((media) => <View key={media.key} style={{ width: cardWidth, backgroundColor: colors.background }}>
        {media.mimeType.startsWith("video/") ? <Video mediaKey={media.key} /> :
          <Image source={api.media(media.key)} style={{ width: cardWidth, height: cardWidth }} resizeMode="contain" accessibilityLabel={post.caption || `Photo from ${post.author.username}`} />}
      </View>)}
    </ScrollView>
    {post.media.length > 1 && <Text style={[s.muted, { textAlign: "center", paddingTop: 6 }]}>{slide + 1} / {post.media.length}</Text>}
    <View style={{ padding: 14, gap: 12 }}>
      <View style={s.row}>
        <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel={like.liked ? "Unlike post" : "Like post"} onPress={() => void run(async () => {
          await api.command({ action: "like", postId: post.id });
          setLike((value) => ({ liked: !value.liked, count: value.count + (value.liked ? -1 : 1) }));
        })} style={[s.row, { minHeight: 44 }]}>
          <Ionicons name={like.liked ? "heart" : "heart-outline"} size={25} color={like.liked ? "#e11d48" : colors.muted} /><Text style={s.body}>{like.count}</Text>
        </Pressable>
        <Pressable onPress={() => navigation.navigate("Post", { id: post.id })} accessibilityLabel="Comments and sharing" style={[s.row, { minHeight: 44 }]}>
          <Ionicons name="chatbubble-outline" size={23} color={colors.muted} /><Text style={s.body}>{post.comments.length}</Text>
          <Ionicons name="paper-plane-outline" size={23} color={colors.muted} />
        </Pressable>
        {post.author.id === me?.user.id && <Pressable accessibilityLabel="Delete post" disabled={busy} onPress={() => confirm("Delete this post?", "The post and its photos or video will be permanently removed.", () => void run(async () => {
          await api.command({ action: "deletePost", postId: post.id });
          if (detail) navigation.goBack(); else await reload();
        }))}><Ionicons name="trash-outline" size={22} color={colors.danger} /></Pressable>}
      </View>
      {!!post.caption && <Text style={s.body}><Text style={s.label}>{post.author.username} </Text>{post.caption}</Text>}
      {(detail ? post.comments : post.comments.slice(-3)).map((comment) => <View key={comment.id}>
        <Text style={s.body}><Text style={s.label}>{comment.author.username} </Text>{comment.text}</Text>
        <Text style={s.muted}>{new Date(comment.createdAt).toLocaleString()}</Text>
      </View>)}
      {post.latitude !== null && post.longitude !== null && detail && <View style={{ height: 220, overflow: "hidden", borderRadius: 12 }}>
        <PhotoMap points={[{ latitude: post.latitude, longitude: post.longitude, title: post.locationName ?? "Photo location" }]} />
      </View>}
      {!detail && <Button title="View post" secondary onPress={() => navigation.navigate("Post", { id: post.id })} />}
    </View>
  </View>;
}

export function FeedSelector({ posting = false, value, onChange }: { posting?: boolean; value?: string; onChange?: (id: string) => void }) {
  const { me, feedId, setFeedId } = useSession();
  return <View style={{ backgroundColor: colors.paper, borderRadius: 10, borderWidth: 1, borderColor: colors.line }}>
    <Picker accessibilityLabel={posting ? "Post audience" : "Choose feed"} selectedValue={value ?? feedId} onValueChange={(id: string) => (onChange ?? setFeedId)(id)} dropdownIconColor={colors.skyDark}>
      {!posting && <Picker.Item label="All feeds" value="all" />}
      {me?.feeds.map((feed) => <Picker.Item key={feed.id} label={`${feed.name}${feed.unread ? ` (${feed.unread} unread)` : ""}`} value={feed.id} />)}
    </Picker>
  </View>;
}

function PostList({ path, header }: { path: string; header?: React.ReactElement }) {
  const result = usePaged<Post>(path, "posts");
  return <FlatList style={s.page} contentContainerStyle={s.content} data={result.items} keyExtractor={(post) => post.id}
    renderItem={({ item }) => <PostCard post={item} reload={result.reload} />}
    ListHeaderComponent={<View style={{ gap: 16 }}>{header}<ErrorNotice error={result.error} retry={() => void result.reload()} /></View>}
    refreshing={result.loading} onRefresh={() => void result.reload()}
    ListEmptyComponent={!result.loading && !result.error ? <View style={s.card}><Text style={s.body}>No posts yet. Share a photo or video with this feed.</Text></View> : undefined}
    ListFooterComponent={result.loading ? <Loading /> : result.hasMore ? <Button title="Load more posts" secondary onPress={() => void result.next()} /> : undefined} />;
}
export function HomeScreen() {
  const { feedId, refresh } = useSession();
  useFocusEffect(useCallback(() => {
    void refresh().catch((error: Error) => { console.error("Could not refresh account badges", error.message); });
  }, [refresh]));
  return <PostList key={feedId} path={`posts?feedId=${encodeURIComponent(feedId)}`} header={<FeedSelector />} />;
}
export function ProfileScreen({ route }: NativeStackScreenProps<StackParams, "Profile">) {
  return <PostList path={`profile/${encodeURIComponent(route.params.username)}`} header={<Text style={s.title}>@{route.params.username}</Text>} />;
}

export function PostScreen({ route }: NativeStackScreenProps<StackParams, "Post">) {
  const { api, me } = useSession();
  const { data, error, loading, reload } = useRemote<{ post: Post; members: Member[] }>(`post/${encodeURIComponent(route.params.id)}`);
  const [text, setText] = useState("");
  const [recipient, setRecipient] = useState("");
  const [message, setMessage] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [locationName, setLocationName] = useState("");
  const [placeQuery, setPlaceQuery] = useState("");
  const [places, setPlaces] = useState<{ displayName: string; latitude: number; longitude: number }[]>([]);
  const { busy, run } = useJob();
  return <Page><ErrorNotice error={error} retry={() => void reload()} />{loading && <Loading />}
    {data && <>
      <PostCard post={data.post} detail reload={reload} />
      <View style={s.card}><Field label="Add a comment" value={text} onChangeText={setText} maxLength={500} multiline />
        <Button title="Comment" disabled={busy || !text.trim()} onPress={() => void run(async () => {
          await api.command({ action: "comment", postId: route.params.id, text }); setText(""); await reload();
        })} /></View>
      <View style={s.card}><Text style={s.label}>Send to someone in {data.post.feed.name}</Text>
        <Picker accessibilityLabel="Share recipient" selectedValue={recipient} onValueChange={setRecipient}><Picker.Item label="Choose a member" value="" />{data.members.map((member) => <Picker.Item key={member.id} label={member.username} value={member.id} />)}</Picker>
        <Field label="Message (optional)" value={message} onChangeText={setMessage} maxLength={200} />
        <Button title="Send post" disabled={busy || !recipient} onPress={() => void run(async () => {
          await api.command({ action: "share", postId: route.params.id, userId: recipient, message }); setMessage(""); setRecipient("");
          const { Alert } = await import("react-native"); Alert.alert("Post sent", "They can find it in Shared with me.");
        })} />
      </View>
      {me?.user.role === "admin" && <View style={s.card}><Text style={s.label}>Edit map location</Text>
        <Text style={s.muted}>Current: {data.post.latitude ?? "none"}, {data.post.longitude ?? "none"}</Text>
        <Field label="Search for a place" value={placeQuery} onChangeText={setPlaceQuery} maxLength={120} />
        <Button title="Search locations" disabled={busy || placeQuery.trim().length < 2} secondary onPress={() => void run(async () => {
          const response = await api.request<{ results: typeof places }>(`/api/geocoding/search?q=${encodeURIComponent(placeQuery)}`);
          setPlaces(response.results);
        })} />
        {places.map((place) => <Button key={`${place.latitude},${place.longitude}`} title={place.displayName} secondary disabled={busy} onPress={() => {
          setLatitude(String(place.latitude)); setLongitude(String(place.longitude)); setLocationName(place.displayName.slice(0, 200)); setPlaces([]);
        }} />)}
        <Field label="Latitude" value={latitude} onChangeText={setLatitude} keyboardType="numbers-and-punctuation" />
        <Field label="Longitude" value={longitude} onChangeText={setLongitude} keyboardType="numbers-and-punctuation" />
        <Field label="Location name" value={locationName} onChangeText={setLocationName} maxLength={200} />
        <Button title="Save location" disabled={busy || !latitude.trim() || !longitude.trim() || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))} onPress={() => void run(async () => {
          await api.command({ action: "location", postId: route.params.id, latitude: Number(latitude), longitude: Number(longitude), locationName }); await reload();
        })} />
        <Button title="Clear location" secondary disabled={busy} onPress={() => confirm("Clear photo location?", "The post will no longer appear on the map.", () => void run(async () => {
          await api.command({ action: "location", postId: route.params.id, latitude: null, longitude: null }); await reload();
        }))} />
      </View>}
    </>}
  </Page>;
}

export function MapScreen() {
  const { feedId } = useSession();
  const navigation = useNavigation<Navigation>();
  const result = usePaged<Post>(`map?feedId=${encodeURIComponent(feedId)}`, "posts");
  const located = result.items.filter((p): p is Post & { latitude: number; longitude: number } => p.latitude !== null && p.longitude !== null);
  return <View style={s.page}><View style={{ padding: 12, gap: 8 }}><FeedSelector /><ErrorNotice error={result.error} retry={() => void result.reload()} /></View>
    {result.loading && <Loading />}
    {located.length > 0 ? <PhotoMap points={located.map((post) => ({ id: post.id, latitude: post.latitude, longitude: post.longitude, title: post.author.username, description: post.locationName ?? post.caption }))} onPost={(id) => navigation.navigate("Post", { id })} />
      : !result.loading && <View style={s.content}><Text style={s.body}>No photos with location metadata in this feed yet.</Text></View>}
    {result.hasMore && <View style={{ padding: 12 }}><Button title="Load more photo locations" disabled={result.loading} onPress={() => void result.next()} /></View>}
  </View>;
}
