import type { ExpoConfig } from "expo/config";
import { withGradleProperties } from "expo/config-plugins";

const config: ExpoConfig = {
  name: "Famstagram",
  slug: "famstagram",
  version: "0.1.0",
  scheme: "famstagram",
  orientation: "default",
  icon: "../public/icons/icon-512.png",
  userInterfaceStyle: "light",
  android: {
    // Separate identity allows testing alongside the existing TWA.
    package: "uk.co.famstagram.nativeapp",
    adaptiveIcon: { foregroundImage: "../public/icons/icon-512.png", backgroundColor: "#ffffff" },
    permissions: ["android.permission.ACCESS_MEDIA_LOCATION"],
    blockedPermissions: ["android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION", "android.permission.RECORD_AUDIO"],
    ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
  },
  ios: { bundleIdentifier: "uk.co.famstagram.nativeapp", supportsTablet: true },
  plugins: [
    ["expo-build-properties", { android: {
      // WorkManager creates its Room database through reflection during startup.
      extraProguardRules: "-keep class androidx.work.impl.WorkDatabase_Impl { public <init>(); }",
    } }],
    "expo-secure-store",
    "expo-video",
    "expo-web-browser",
    "expo-notifications",
    ["expo-share-intent", { androidIntentFilters: ["image/*", "video/*"], androidMultiIntentFilters: ["image/*"], disableIOS: true }],
    ["expo-media-library", {
      photosPermission: "Choose family photos and read their original photo locations.",
      savePhotosPermission: false,
      isAccessMediaLocationEnabled: true,
      granularPermissions: ["photo", "video"],
    }],
    ["expo-image-picker", { photosPermission: "Choose a profile photo.", cameraPermission: false, microphonePermission: false }],
  ],
  extra: {
    nativePushConfigured: Boolean(process.env.GOOGLE_SERVICES_JSON),
    ...(process.env.EXPO_PUBLIC_EAS_PROJECT_ID ? { eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID } } : {}),
  },
};
export default withGradleProperties(config, (result) => {
  result.modResults = result.modResults.filter((item) => item.type !== "property" || item.key !== "android.cmakeVersion");
  // AGP's default CMake bundles an old Ninja that fails on Windows worktree paths.
  result.modResults.push({ type: "property", key: "android.cmakeVersion", value: "3.31.6" });
  return result;
});
