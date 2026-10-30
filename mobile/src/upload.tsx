import React, { useEffect, useRef, useState } from "react";
import { Alert, FlatList, Image, Linking, Modal, PermissionsAndroid, Platform, Pressable, Text, View } from "react-native";
import * as MediaLibrary from "expo-media-library/legacy";
import { File } from "expo-file-system";
import { useShareIntentContext } from "expo-share-intent";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { validateMediaFiles, MAX_VIDEO_SECONDS } from "../../lib/validation";
import type { StackParams } from "./types";
import { useSession } from "./session";
import { FeedSelector } from "./posts";
import { Button, colors, ErrorNotice, Field, Loading, Page, s, useJob } from "./ui";

type Selection = {
  id: string; uri: string; name: string; type: string; size: number;
  location: { latitude: number; longitude: number } | null;
  gps: "found" | "missing" | "unavailable";
};
const types: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  gif: "image/gif", heic: "image/heic", heif: "image/heif",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
};

export function UploadScreen() {
  const { api, me, feedId, refresh } = useSession();
  const incoming = useShareIntentContext();
  const navigation = useNavigation<NativeStackNavigationProp<StackParams>>();
  const [destination, setDestination] = useState(feedId === "all" ? me?.feeds[0]?.id ?? "" : feedId);
  const [caption, setCaption] = useState("");
  const [selected, setSelected] = useState<Selection[]>([]);
  const [gallery, setGallery] = useState<MediaLibrary.Asset[]>([]);
  const [open, setOpen] = useState(false);
  const [endCursor, setEndCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [gpsAllowed, setGpsAllowed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useJob();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const loadGallery = async (after?: string) => {
    const result = await MediaLibrary.getAssetsAsync({
      first: 60, after, mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
      sortBy: [MediaLibrary.SortBy.creationTime],
    });
    if (!mounted.current) return;
    setGallery((previous) => after ? [...previous, ...result.assets] : result.assets);
    setEndCursor(result.endCursor); setHasMore(result.hasNextPage);
  };
  const showGallery = () => void run(async () => {
    setError(null);
    const permission = await MediaLibrary.requestPermissionsAsync(false, ["photo", "video"]);
    if (!permission.granted && permission.accessPrivileges !== "limited") {
      Alert.alert("Photo access is needed", "Allow access to the photos and videos you want to share.", [
        { text: "Cancel", style: "cancel" }, { text: "Open settings", onPress: () => void Linking.openSettings() },
      ]);
      return;
    }
    let locationPermission = true;
    if (Platform.OS === "android" && Number(Platform.Version) >= 29) {
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_MEDIA_LOCATION);
      locationPermission = result === PermissionsAndroid.RESULTS.GRANTED;
    }
    setGpsAllowed(locationPermission);
    await loadGallery(); setOpen(true);
  });
  const choose = (asset: MediaLibrary.Asset) => void run(async () => {
    if (selected.some((item) => item.id === asset.id)) {
      setSelected((previous) => previous.filter((item) => item.id !== asset.id)); return;
    }
    if (asset.mediaType === "video" && asset.duration > MAX_VIDEO_SECONDS) throw new Error("Videos must be 60 seconds or shorter.");
    // getAssetInfoAsync uses MediaStore.setRequireOriginal on Android 10+.
    // Never use the phone's current location for a historical photo.
    const info = gpsAllowed ? await MediaLibrary.getAssetInfoAsync(asset) : asset;
    const uri = "localUri" in info && typeof info.localUri === "string" ? info.localUri : info.uri;
    const file = new File(uri);
    if (!file.exists || !file.size) throw new Error("This photo is not available on the device. Download it from your photo provider first.");
    const type = types[asset.filename.split(".").pop()?.toLowerCase() ?? ""];
    if (!type) throw new Error("This file type is not supported. Choose a JPG, PNG, WebP, GIF, HEIC image or MP4, MOV, WebM video.");
    const item: Selection = {
      id: asset.id, uri, name: asset.filename, type, size: file.size,
      location: info.location ?? null,
      gps: !gpsAllowed ? "unavailable" : info.location ? "found" : "missing",
    };
    const candidate = [...selected, item];
    const validation = validateMediaFiles(candidate);
    if (validation.error) throw new Error(validation.error);
    setSelected(candidate);
  });

  return <Page>
    <Text style={s.title}>Share a moment</Text>
    <Text style={s.muted}>Choose up to 10 photos or one video. Original photo locations appear on your private feed's map.</Text>
    <View style={s.card}><Text style={s.label}>Who can see this?</Text><FeedSelector posting value={destination} onChange={setDestination} /></View>
    <ErrorNotice error={error} />
    <ErrorNotice error={incoming.error} />
    {incoming.hasShareIntent && <View style={s.card}>
      <Text style={s.label}>Shared from another app</Text>
      <Text style={s.muted}>Some photo providers remove location metadata. For original GPS, choose the photo directly from your gallery.</Text>
      <Button title="Import shared photos or video" disabled={busy} onPress={() => void run(async () => {
        const files = incoming.shareIntent.files ?? [];
        if (!files.length) throw new Error("No supported photos or video were shared.");
        const items: Selection[] = files.map((item) => {
          if (item.mimeType.startsWith("video/")) {
            if (item.duration === null) throw new Error("The shared video's duration is unavailable. Select it from the gallery instead.");
            if (item.duration > MAX_VIDEO_SECONDS * 1000) throw new Error("Videos must be 60 seconds or shorter.");
          }
          const file = new File(item.path);
          if (!file.exists || !file.size) throw new Error("The shared file is unavailable. Try sharing it again.");
          return {
            id: item.path, uri: item.path, name: item.fileName, type: item.mimeType, size: file.size,
            location: null, gps: "unavailable",
          };
        });
        const candidate = [...selected, ...items];
        const check = validateMediaFiles(candidate);
        if (check.error) throw new Error(check.error);
        setSelected(candidate);
        if (!caption) setCaption((incoming.shareIntent.text ?? "").slice(0, 500));
        incoming.resetShareIntent();
      })} />
      <Button title="Dismiss shared media" secondary disabled={busy} onPress={() => incoming.resetShareIntent()} />
    </View>}
    <Button title="Choose photos or video" onPress={showGallery} disabled={busy || !me?.feeds.length} secondary />
    {selected.map((item, index) => <View key={item.id} style={s.card}>
      <View style={s.row}><Image source={{ uri: item.uri }} style={{ width: 70, height: 70, borderRadius: 10 }} /><View style={{ flex: 1 }}>
        <Text style={s.label} numberOfLines={1}>{index + 1}. {item.name}</Text>
        <Text style={s.muted}>{(item.size / 1024 / 1024).toFixed(1)} MB</Text>
        <Text style={item.gps === "unavailable" ? s.error : s.muted}>
          {item.type.startsWith("video/") ? "Video" : item.gps === "found" ? "Original photo location found" : item.gps === "missing" ? "No GPS metadata in this photo" : "Original location not verified. Choose from gallery and allow photo location access."}
        </Text>
      </View></View>
      <Button title="Remove" secondary disabled={busy} onPress={() => setSelected((previous) => previous.filter((value) => value.id !== item.id))} />
    </View>)}
    <Field label={`Caption (${caption.length}/500)`} value={caption} onChangeText={setCaption} maxLength={500} multiline style={{ minHeight: 100, textAlignVertical: "top" }} editable={!busy} />
    <Button title={busy ? "Please wait..." : "Publish"} disabled={busy || !selected.length || !destination} onPress={() => void run(async () => {
      setError(null);
      const validation = validateMediaFiles(selected);
      if (validation.error) throw new Error(validation.error);
      const form = new FormData();
      form.append("caption", caption); form.append("feedId", destination);
      for (const item of selected) form.append("media", new File(item.uri), item.name);
      const gps = selected.find((item) => item.type.startsWith("image/") && item.location)?.location;
      if (gps) { form.append("clientLatitude", String(gps.latitude)); form.append("clientLongitude", String(gps.longitude)); }
      const post = await api.request<{ id: string }>("/api/posts", form);
      setSelected([]); setCaption(""); await refresh();
      navigation.navigate("Post", { id: post.id });
    })} />
    <Modal visible={open} onRequestClose={() => setOpen(false)} animationType="slide">
      <View style={[s.page, { paddingTop: 32 }]}>
        <View style={{ padding: 16, gap: 12 }}><Text style={s.title}>Your gallery</Text>
          <Text style={s.muted}>{selected.length} selected. Tap in the order you want them shown.</Text>
          {!gpsAllowed && <Text style={s.error}>Photo location permission is off. GPS metadata may be unavailable.</Text>}
          <Button title="Done" onPress={() => setOpen(false)} disabled={busy} />
        </View>
        <FlatList data={gallery} numColumns={3} keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const index = selected.findIndex((value) => value.id === item.id);
            return <Pressable disabled={busy} accessibilityLabel={`${item.filename}${index >= 0 ? ", selected" : ""}`} onPress={() => choose(item)} style={{ width: "33.33%", aspectRatio: 1, padding: 2 }}>
              <Image source={{ uri: item.uri }} style={{ flex: 1, borderRadius: 4, opacity: index >= 0 ? 0.6 : 1 }} />
              {(index >= 0 || item.mediaType === "video") && <Text style={{ position: "absolute", bottom: 8, right: 8, color: colors.paper, backgroundColor: colors.skyDark, padding: 5, borderRadius: 6 }}>{index >= 0 ? index + 1 : `${Math.round(item.duration)}s`}</Text>}
            </Pressable>;
          }}
          ListFooterComponent={busy ? <Loading /> : hasMore ? <Button title="More photos" secondary onPress={() => void run(() => loadGallery(endCursor))} /> : undefined} />
      </View>
    </Modal>
  </Page>;
}
