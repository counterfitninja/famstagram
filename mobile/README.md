# Famstagram native app

Android-first React Native + Expo development build, with shared TypeScript
screens and data access for a later iOS release. These are native screens, not
a WebView or the existing Trusted Web Activity in the repository's `android/`.

## What is connected

- Password sign-in, invite-only account creation, OS-encrypted session storage.
- Browser-assisted passkey sign-in using the existing website's WebAuthn
  ceremony, a fixed app callback, and one-time, 60-second proof-bound codes.
  Passkey setup also opens the website. Native Credential Manager ceremonies
  are not implemented.
- Private feed selection, all-feeds timeline, paginated posts, image carousels,
  video playback, likes, timestamped comments and mentions, post deletion.
- Gallery photo/video uploads, audience selection, captions and original photo
  GPS; Android incoming share intents open the composer for explicit import.
- Native photo maps, place search/coordinate editing for admins, profiles,
  profile photo changes, member search, notifications, mutes and shared inbox.
- Feed creation, member management, feed roles, invite creation/sharing/revocation
  (revocation is admin-only, as on the website), account moderation and password
  resets for global admins.
- Opt-in native push alerts and notification-to-post navigation. Web push and
  its VAPID configuration remain independent.

The native visual language follows the PWA: the existing Famstagram logo,
sky-blue controls, neutral canvas, white rounded photo cards, feed labels and
Home / Post / Map / Search navigation. No new visual identity is introduced.

## Local setup

Use **Node.js 24 LTS**, JDK 17, and Android Studio with the Android SDK/NDK
versions requested by Expo's generated Gradle project, including **CMake
3.31.6** (the app pins this for Ninja 1.12's Windows long-path support).
SDK/NDK downloads may be substantial on the first build. Keep the existing web dependencies at the
repository root; the mobile dependency tree and lockfile are independent.

From the repository root in PowerShell:

```powershell
npm ci
npx prisma migrate deploy
Set-Location mobile
npm ci
Copy-Item .env.example .env
# Edit .env before building; the default server is https://www.famstagram.co.uk.
npm run android
```

`npm run android` generates the ignored `mobile\android\` project, compiles,
installs on a connected device/emulator, and starts Metro. Do not edit the
repository's separate, legacy `android\` directory for this app. If a debug
APK is installed manually, run `npx expo start --dev-client` for its JS bundle.
**Expo Go cannot provide the required native modules and permissions.**

Shared validation is imported from `..\lib\validation.ts`; Metro watches the
repository root, while the web TypeScript configuration excludes `mobile/`.
No copied business rules or fake feed data are used.

For a local backend, set `EXPO_PUBLIC_API_URL` to an address reachable from the
phone (or `http://10.0.2.2:3000` for an Android emulator). HTTP is accepted by
the JS client only in development; production builds require HTTPS. Android's
network policy must also allow development HTTP. Never point a release at HTTP.
Deploy the new API before trying the app against the hosted website.

## GPS behavior and privacy

The gallery requests photo/video access, then `ACCESS_MEDIA_LOCATION` on
Android 10+. Expo MediaLibrary's native `getAssetInfoAsync` implementation uses
`MediaStore.setRequireOriginal` to read the selected photo's unredacted EXIF
location. The app submits the original file without resizing and sends the
first selected image with GPS as `clientLatitude` / `clientLongitude` fallback,
using the same upload contract as the PWA. The server still validates all media
and feed membership, prefers embedded coordinates, and optimizes only after
the post's location has been saved.

Photos without coordinates stay untagged. Permission denial is shown explicitly
and does not prevent a location-free upload. No live location is requested:
fine/coarse device location permissions are blocked. Only photo metadata is
read. On Android 14+, users can grant limited access to selected photos.

A photo shared from another provider may already have been stripped of GPS.
The import screen explains this; choose the original directly from the gallery
to recover it. Cloud-only photos must be downloaded to the device first.
The server stores one location per post, not one per image. Optimized media
may omit EXIF even though the post/map retains the coordinates.

## Maps

Enable the Maps SDK for Android in your Google Cloud project and set
`GOOGLE_MAPS_ANDROID_API_KEY` before building. Restrict this public client key
to `uk.co.famstagram.nativeapp` and the signing certificate's SHA-1 fingerprint.
The native map needs a configured key; it is not the PWA's Leaflet map.
Without a key, the app shows a configuration notice instead of opening the map.
Changing build-time configuration requires a new native build.

## Native push

1. Link the app to your own Expo EAS project and set
   `EXPO_PUBLIC_EAS_PROJECT_ID`.
2. Register the Android package with Firebase, configure FCM v1 credentials
   in EAS, and set `GOOGLE_SERVICES_JSON` to your client `google-services.json`
   file (or an EAS file-environment variable). Never bundle a service-account
   private key in the app.
3. If Expo enhanced push security is enabled, set `EXPO_ACCESS_TOKEN` on the
   **server**, not in an `EXPO_PUBLIC_*` variable.
4. Rebuild, install on a physical Android device, and enable notifications
   from Settings. Disable explicitly or sign out to unregister this device.

The server selects recipients using existing feed membership, mute and mention
rules. Expo receives device push tokens, post/feed IDs and a generic message,
not family names, captions, coordinates or media. Delivery failures are logged;
immediately rejected unregistered tokens are removed. A push-service acceptance
ticket is not proof of device delivery. Notification history remains available
even without FCM/EAS configuration.

## Builds and identity

The development package is **`uk.co.famstagram.nativeapp`**, intentionally
separate from the TWA's `uk.co.famstagram.app`. This avoids replacing the working
wrapper or changing its release key during development. Do not publish it as
an update to the old package without an explicit signing/identity migration.

For a local, self-contained ARM64 test APK, using the same SDK setup above:

```powershell
# From mobile, with ANDROID_HOME set to your Android SDK:
npx expo prebuild --platform android --no-install
Set-Location android
.\gradlew.bat :app:assembleRelease --no-daemon --console=plain -PreactNativeArchitectures=arm64-v8a
```

The output is `mobile\android\app\build\outputs\apk\release\app-release.apk`.
It includes its JavaScript bundle and does not need Metro. The generated local
project uses the Android **debug signing key**, even for this release variant:
this is an internal test build, not a Play Store release. It targets ARM64
devices, not x86 emulators. Deploy the native API and database migration first.

For self-contained internal APKs or Play bundles, use the matching profile:

```powershell
npx eas-cli build --platform android --profile preview
npx eas-cli build --platform android --profile production
```

EAS requires your account, project, signing credentials and configured build
environment. `preview` creates an internal APK; `production` creates the Play
bundle. Builds may use paid cloud resources; these commands are instructions,
not an automation that runs without your decision. The app's session cookie is
stored in SecureStore and supplied explicitly for private API/media requests.
It is not shared with the browser or written into URLs or ordinary app storage.

## Checks

```powershell
# Repository root, independent temporary DB/server/media:
npm test
npm run build
npm run test:native

Set-Location mobile
npm run typecheck
npx expo install --check
npx expo export --platform android
```

Before calling an APK release-ready, exercise it on a physical phone:
password and browser/passkey login; restart and sign-out; invite consumption;
single/multiple images, each supported type, 60-second and oversized video
boundaries; a known GPS photo including 0/0 coordinates; a photo without GPS;
denied/limited photo permission; sharing from Google Photos; private media
access after feed removal; notification tap from a closed app; map rendering;
manager/admin permissions; failed connections and upload retries.

Uploads currently run in the foreground, not a persistent background queue.
Server maintenance tools (GPS backfill, storage optimization and web-push
diagnostics) remain in the web admin interface. The iOS configuration is a
starting point only: iOS builds, permissions, push credentials, native maps
configuration, share extension and device acceptance remain for the iOS phase.
