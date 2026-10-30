import React, { useEffect, useRef } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import Ionicons from "@expo/vector-icons/Ionicons";
import { NavigationContainer, createNavigationContainerRef, type LinkingOptions } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "./src/session";
import { LoginScreen, RegisterScreen } from "./src/auth-screens";
import { HomeScreen, MapScreen, PostScreen, ProfileScreen } from "./src/posts";
import { UploadScreen } from "./src/upload";
import { NotificationsScreen, SearchScreen, SettingsScreen, SharedScreen } from "./src/community";
import { AdminScreen, FeedsScreen, FeedScreen } from "./src/management";
import { colors, Loading, s } from "./src/ui";
import type { StackParams, TabParams } from "./src/types";
import * as Notifications from "expo-notifications";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";

const Stack = createNativeStackNavigator<StackParams>();
const Tabs = createBottomTabNavigator<TabParams>();
function MainTabs() {
  return <Tabs.Navigator screenOptions={({ route }) => ({
    headerShown: false, tabBarActiveTintColor: colors.sky, tabBarInactiveTintColor: colors.muted,
    tabBarIcon: ({ color, size }) => <Ionicons color={color} size={size} name={route.name === "Home" ? "home-outline" : route.name === "Post" ? "add-circle-outline" : route.name === "Map" ? "map-outline" : "search-outline"} />,
  })}>
    <Tabs.Screen name="Home" component={HomeScreen} />
    <Tabs.Screen name="Post" component={UploadScreen} />
    <Tabs.Screen name="Map" component={MapScreen} />
    <Tabs.Screen name="Search" component={SearchScreen} />
  </Tabs.Navigator>;
}
function AppNavigation() {
  const { me, starting } = useSession();
  const ref = useRef(createNavigationContainerRef<StackParams>()).current;
  const pendingPost = useRef<string | null>(null);
  const seenNotices = useRef(new Set<string>());
  const sharedContent = useShareIntentContext();
  const seenShare = useRef(false);
  useEffect(() => {
    if (!sharedContent.hasShareIntent) { seenShare.current = false; return; }
    if (me && ref.isReady() && !seenShare.current) {
      seenShare.current = true; ref.navigate("Tabs", { screen: "Post" });
    }
  }, [sharedContent.hasShareIntent, me, ref]);
  useEffect(() => {
    const open = (response: Notifications.NotificationResponse | null) => {
      const postId: unknown = response?.notification.request.content.data?.postId;
      if (typeof postId !== "string" || postId.length > 200) return;
      const id = response!.notification.request.identifier;
      if (seenNotices.current.has(id)) return;
      seenNotices.current.add(id);
      if (me && ref.isReady()) ref.navigate("Post", { id: postId });
      else pendingPost.current = postId;
    };
    if (me && pendingPost.current && ref.isReady()) {
      ref.navigate("Post", { id: pendingPost.current }); pendingPost.current = null;
    }
    void Notifications.getLastNotificationResponseAsync().then(open).catch((error: Error) => Alert.alert("Could not open notification", error.message));
    const listener = Notifications.addNotificationResponseReceivedListener(open);
    return () => listener.remove();
  }, [me, ref]);
  if (starting) return <View style={[s.page, { justifyContent: "center" }]}><Loading /></View>;
  const linking: LinkingOptions<StackParams> = {
    prefixes: ["famstagram://"],
    config: { screens: me ? { Post: "post/:id", Profile: "profile/:username" } : { Register: "invite/:token" } },
  };
  return <NavigationContainer ref={ref} linking={linking} onReady={() => {
    if (me && pendingPost.current) { ref.navigate("Post", { id: pendingPost.current }); pendingPost.current = null; }
    if (me && sharedContent.hasShareIntent && !seenShare.current) { seenShare.current = true; ref.navigate("Tabs", { screen: "Post" }); }
  }}>
    <StatusBar style="dark" />
    <Stack.Navigator screenOptions={{ headerTintColor: colors.skyDark, headerShadowVisible: false, contentStyle: { backgroundColor: colors.background } }}>
      {!me ? <>
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Register" component={RegisterScreen} options={{ title: "Join Famstagram" }} />
      </> : <>
        <Stack.Screen name="Tabs" component={MainTabs} options={({ navigation }) => ({
          title: "Famstagram",
          headerTitleStyle: { fontWeight: "700" },
          headerRight: () => <View style={{ flexDirection: "row", gap: 16 }}>
            <Pressable accessibilityLabel={`Notifications, ${me.unreadNotifications} unread`} onPress={() => navigation.navigate("Notifications")} style={{ minHeight: 44, justifyContent: "center" }}>
              <Ionicons name="notifications-outline" size={23} color={colors.skyDark} />{me.unreadNotifications > 0 && <Text style={s.muted}>{me.unreadNotifications}</Text>}
            </Pressable>
            <Pressable accessibilityLabel={`Shared with me, ${me.unreadShares} unread`} onPress={() => navigation.navigate("Shared")} style={{ minHeight: 44, justifyContent: "center" }}><Ionicons name="paper-plane-outline" size={23} color={colors.skyDark} /></Pressable>
            <Pressable accessibilityLabel="Account settings" onPress={() => navigation.navigate("Settings")} style={{ minHeight: 44, justifyContent: "center" }}><Ionicons name="person-circle-outline" size={26} color={colors.skyDark} /></Pressable>
          </View>,
        })} />
        <Stack.Screen name="Post" component={PostScreen} options={{ title: "Family moment" }} />
        <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: "Profile" }} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} />
        <Stack.Screen name="Shared" component={SharedScreen} options={{ title: "Shared with me" }} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Feeds" component={FeedsScreen} />
        <Stack.Screen name="Feed" component={FeedScreen} options={{ title: "Members and invites" }} />
        <Stack.Screen name="Admin" component={AdminScreen} options={{ title: "Administration" }} />
      </>}
    </Stack.Navigator>
  </NavigationContainer>;
}
export default function App() {
  return <ShareIntentProvider options={{ resetOnBackground: false }}><SafeAreaProvider><SessionProvider><AppNavigation /></SessionProvider></SafeAreaProvider></ShareIntentProvider>;
}
