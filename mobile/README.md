# Famstagram native app

Android-first React Native + Expo development build, with shared TypeScript
screens and data access for a later iOS release. The app uses native screens,
with Leaflet maps embedded in a restricted WebView. It is not the existing
Trusted Web Activity in the repository's `android/`.

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
- Leaflet/OpenStreetMap photo maps, place search/coordinate editing for admins, profiles,
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

Maps use the same **Leaflet + OpenStreetMap** approach as the PWA. No Google
Maps API key, Google Maps SDK, or billing account is needed. Leaflet JavaScript
and styles are bundled at dependency installation (`npm run build:map`), not
downloaded from a third-party script CDN. Both the feed map and post-location
preview use this component; marker popups open native post details.

The map WebView receives only the currently authorized post locations and
labels, never the session cookie or media URLs. Text is inserted using
`textContent`, and messages can navigate only to posts already in the map.
Map tiles are fetched from `https://tile.openstreetmap.org` with visible
attribution, an app-identifying User-Agent and normal WebView HTTP caching.
The tile provider receives your IP address and the requested map area; it
does not receive captions, account names, photos, or session credentials.

Public OSM tiles are a best-effort community service, not an unlimited hosted
map service. No offline/prefetch mode is implemented. Follow the
[tile usage policy](https://operations.osmfoundation.org/policies/tiles/);
larger deployments should use a suitable tile provider or self-hosted tiles.

## Native push

Android push uses **FCM HTTP v1 directly from your server**, not Expo Push.
An Expo account/EAS project is not needed for local builds or push delivery.
The `expo-notifications` library still handles Android permissions,
notification channels, native device tokens, and notification taps.

### Firebase setup

1. Create a Firebase project (or use an existing one) in the Firebase console.
   Register an **Android** app with package **`uk.co.famstagram.nativeapp`**,
   not the legacy TWA's `uk.co.famstagram.app`. SHA fingerprints are not
   required for FCM alone.
2. Download its **Android client** `google-services.json`. Save it locally as
   `mobile\google-services.json` (ignored by Git). In `mobile\.env`, set
   `GOOGLE_SERVICES_JSON=./google-services.json`. This file has client project
   identifiers; it is NOT a service-account private key.
3. Ensure **Firebase Cloud Messaging API (HTTP v1)** is enabled in the same
   project's Google Cloud APIs. For server authorization, prefer workload
   identity/Application Default Credentials when available. Otherwise create
   a dedicated service account with the **Firebase Cloud Messaging API Admin**
   role (`roles/firebasecloudmessaging.admin`) on this project and generate
   its private JSON key. This action creates persistent server credentials.
4. Put that **server-only** key in a restricted, persistent secrets directory
   outside the app checkout, public assets, and uploads. Set on the server:

   ```dotenv
   FIREBASE_PROJECT_ID=your-firebase-project-id
   GOOGLE_APPLICATION_CREDENTIALS=/absolute/container/path/to/firebase-admin.json
   ```

   The path is as seen inside the running server/container, not your desktop.
   Ensure only the server process can read it. Never paste the private key
   into chat, commit it, put it in `mobile/`, or use an `EXPO_PUBLIC_*` variable.
   With workload identity, omit the credentials-file variable and configure
   the runtime service account's messaging permissions instead.
5. Deploy the backend and run `npx prisma migrate deploy`, including the
   provider migration. Rebuild/install the APK with the Android client file.
   Both must use the **same Firebase project**. In the native app,
   allow notifications when prompted after your first successful sign-in
   (or on startup if already signed in). Declining or disabling is remembered;
   use Account settings > **Enable on this device** to opt in later.
6. Test with two accounts in the same feed: enable notifications on the
   recipient's phone, put the app in the background, and publish from the other
   account. Check foreground alerts and tapping a notification from a closed
   app too. Android force-stop blocks delivery until the app is opened again.

For Pelican, re-import the updated egg to expose **Firebase Project ID** and
**Google Application Credentials File** in Startup settings. Upload/mount the
private key securely and set the container path, then restart. The egg does
not create credentials or upload private keys.
The egg preserves a root `secrets/` directory during reinstalls and Git ignores
it. For example, upload the key to `secrets/firebase-admin.json` through the
server's restricted file access, and use
`/home/container/secrets/firebase-admin.json` in Startup settings. Confirm this
is your actual runtime mount path. Keep file permissions restricted to the
server user; hiding the Startup path field does not protect the file itself.

The server selects recipients using existing feed membership, mute and mention
rules. Rich previews are enabled by default for opted-in Android devices:
the sender and caption/comment text appear with the first supported photo
(JPEG, PNG, WebP or GIF) in the post. Android shows one image when expanded, not
an image carousel. Video-only and HEIC-only posts use text notifications.
Text previews are limited to 300 characters; tapping opens the full post.

Google receives device tokens, post/feed IDs, sender names, preview text and
short-lived image URLs, and may fetch the preview image. This content can appear
on the lock screen; hide sensitive notification content in Android settings or
disable device notifications if desired. The preview URL is a bearer grant valid
for five minutes, scoped to one image, recipient and registered device. The
server rechecks current feed membership and device registration on every fetch.
It returns only a resized JPEG under 1 MB without EXIF/GPS, with no-store caching;
original media still requires the existing authenticated media route.
Revoking access prevents new fetches but cannot retract downloaded notifications.
Do not log preview query strings in reverse proxy/access logs.
Image previews require the server's `APP_ORIGIN` to be its public HTTPS origin
and a valid `SESSION_SECRET`; missing configuration logs an error and sends text
only. Failed or delayed image downloads can also leave a text-only notification.

Tokens refresh on startup
and native token-change events for opted-in devices. Disable explicitly or
sign out to unregister. Server failures are logged without tokens/private keys;
only explicit FCM `UNREGISTERED` errors remove registrations. FCM acceptance
is not proof of device delivery. Live delivery cannot be verified without your
Firebase credentials and a Google Play services-equipped Android device.

Existing browser push and VAPID settings are unchanged. Old Expo device-token
rows are retained but no longer sent; users of older native builds must update
and enable notifications again. `EXPO_ACCESS_TOKEN` is no longer used.

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

Release optimization must preserve `WorkDatabase_Impl`'s public constructor.
The `expo-build-properties` keep rule in `app.config.ts` prevents WorkManager's
startup initialization from crashing before the sign-in screen. After changing
native dependencies or release rules, install the release APK and cold-launch
it on a device/emulator; successful compilation alone is not a startup check.
With `ANDROID_HOME` set, run `npm run test:android:launch -- <adb-serial>` from
`mobile` against a test device without a saved login. This installs the release
APK, cold-launches it, and checks that the process survives and the sign-in
screen renders. It does not erase app data. For an x86 emulator, build with
`'-PreactNativeArchitectures=arm64-v8a,x86_64'` instead of the ARM64-only flag.

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
npm run test:map
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
starting point only: iOS builds, permissions, APNs push credentials, map
configuration, share extension and device acceptance remain for the iOS phase.
