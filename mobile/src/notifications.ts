import { Platform } from "react-native";
import * as Device from "expo-device";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import type { Api } from "./api";

const tokenKey = "famstagram.native.push";
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});
export async function enablePush(api: Api) {
  if (!Device.isDevice) throw new Error("Use a physical Android device to enable push notifications.");
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) throw new Error("Push needs an EAS project ID and FCM credentials. Configure them and rebuild this app.");
  if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("family-updates", {
    name: "Family updates", importance: Notifications.AndroidImportance.DEFAULT,
  });
  const permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted") throw new Error("Notifications are blocked. Allow them in Android Settings to receive family updates.");
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await api.request("/api/native/push", { token, enabled: true });
  await SecureStore.setItemAsync(tokenKey, token);
}
export async function disablePush(api: Api) {
  const token = await SecureStore.getItemAsync(tokenKey);
  if (token) {
    await api.request("/api/native/push", { token, enabled: false });
    await SecureStore.deleteItemAsync(tokenKey);
  }
}
export async function restorePush(api: Api) {
  const token = await SecureStore.getItemAsync(tokenKey);
  if (token) await api.request("/api/native/push", { token, enabled: true });
}
