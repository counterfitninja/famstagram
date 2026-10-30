import { Platform } from "react-native";
import * as Device from "expo-device";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import type { Api } from "./api";

const tokenKey = "famstagram.native.fcm";
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});
export async function enablePush(api: Api) {
  if (!Device.isDevice) throw new Error("Use a physical Android device to enable push notifications.");
  if (Platform.OS !== "android") throw new Error("Direct push is currently configured for Android only.");
  if (Constants.expoConfig?.extra?.nativePushConfigured !== true) throw new Error("This build needs the Firebase Android google-services.json configuration. Configure GOOGLE_SERVICES_JSON and rebuild the APK.");
  if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("family-updates", {
    name: "Family updates", importance: Notifications.AndroidImportance.DEFAULT,
  });
  const permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted") throw new Error("Notifications are blocked. Allow them in Android Settings to receive family updates.");
  const { data: token } = await Notifications.getDevicePushTokenAsync();
  await registerPushToken(api, token);
}
export async function registerPushToken(api: Api, token: string) {
  const previous = await SecureStore.getItemAsync(tokenKey);
  await api.request("/api/native/push", { provider: "fcm", token, enabled: true });
  if (previous && previous !== token) await api.request("/api/native/push", { provider: "fcm", token: previous, enabled: false });
  await SecureStore.setItemAsync(tokenKey, token);
}
export async function disablePush(api: Api) {
  const token = await SecureStore.getItemAsync(tokenKey);
  if (token) {
    await api.request("/api/native/push", { provider: "fcm", token, enabled: false });
    await SecureStore.deleteItemAsync(tokenKey);
  }
}
export async function restorePush(api: Api) {
  const token = await SecureStore.getItemAsync(tokenKey);
  if (!token || Platform.OS !== "android") return;
  const permission = await Notifications.getPermissionsAsync();
  if (permission.status !== "granted") {
    await disablePush(api);
    return;
  }
  const current = await Notifications.getDevicePushTokenAsync();
  await registerPushToken(api, current.data);
}
export function watchPushToken(api: Api, onError: (error: Error) => void) {
  return Notifications.addPushTokenListener((token) => {
    void SecureStore.getItemAsync(tokenKey).then(async (enabled) => {
      if (enabled && token.type === "android") await registerPushToken(api, token.data);
    }).catch(onError);
  });
}
