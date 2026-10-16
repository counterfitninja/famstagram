# 📸 Famstagram

A private, invite-only Instagram-style photo & video sharing app for family members.

## Features

- **Multiple private feeds** — one deployment hosts many named private feeds (e.g. "Family" and a daughter's "Friends"); each post, comment, like, and notification is scoped to exactly one feed and visible only to its members
- **Feed switcher + "All feeds"** — members of multiple feeds switch via the selector (navbar / mobile tab bar) with per-feed unread badges, or browse an amalgamated, feed-labeled "All feeds" timeline
- **Feed management** — the global admin creates feeds (`/feeds`) and appoints per-feed managers; managers invite, add, and remove members within their own feeds only
- **Feed-scoped invites** — invite links now land the new account in exactly the feed the inviter chose; links are single-use and expire after 7 days
- **Choose your audience** — multi-feed members pick which feed each post goes to (defaults to the active feed)
- **Invite-only registration** — admins/managers generate single-use invite links; links expire after 7 days
- **Posts** — up to 10 images (JPG/PNG/WebP/GIF) or one short video (MP4/WebM/MOV, ≤60s, ≤100 MB) plus a short caption (≤500 chars); multi-image posts render as a carousel
- **Likes** — heart any post, with live count
- **Comments** — comment on posts from the feed or the post detail page
- **Forward / share** — send a post to another member of the same feed; it lands in their "Shared with me" inbox (unread badge in the navbar)
- **Profiles** — per-user page showing only their posts from feeds you share
- **Private media** — uploaded files are served through an authenticated route scoped to the owning feed, never from a public folder
- **Passkey login** — use Face ID / Touch ID / Windows Hello to sign in without a password
- **PWA push notifications** — opt in on the Notifications page to receive new-post and mention alerts (feed-labeled) while the app is closed

## Tech stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS · Prisma + SQLite · iron-session (cookie auth) · bcryptjs · zod · pluggable media storage (local disk or S3/MinIO via AWS SDK)

## Getting started

```bash
npm install          # install dependencies (also runs prisma generate)
npm run db:migrate   # create the SQLite database (prisma migrate dev)
npm run db:seed      # create the admin user + print an invite link
npm run dev          # start the dev server at http://localhost:3000
```

Then:

1. Sign in as the admin (credentials printed by the seed script; defaults: `admin` / `change-me-admin` — set `ADMIN_USERNAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` before seeding to change them).
2. Open **Invites** in the navbar to generate invite links and send them to family members.
3. Family members open the link, pick a username + email + password, and start posting.

## Configuration

Copy `.env.example` to `.env` and adjust:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLite location (default `file:./dev.db`) |
| `SESSION_SECRET` | Cookie encryption secret — **required ≥ 32 chars** |
| `APP_ORIGIN` | Canonical app origin for server-side redirects (recommended when running behind a reverse proxy) |
| `WEBAUTHN_ORIGIN` / `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_NAME` | Passkey origin and relying party settings for Face ID / Touch ID / Windows Hello |
| `STORAGE_DRIVER` | `local` (default) or `s3` |
| `UPLOAD_DIR` | Folder for uploaded media when using `local` (default `./uploads`) |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` | S3-compatible storage (e.g. MinIO) when using `s3` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push credentials and a `mailto:` contact address |
| `PUSH_DEBUG` | Set to `true` temporarily to log masked Web Push diagnostics |
| `UPLOAD_DEBUG` | Set to `true` temporarily to log upload MIME detection and GPS extraction diagnostics; coordinates and filenames are omitted. Entries include the build commit SHA and uploaded file SHA-256 |

The browser upload form extracts GPS from the file selected on the device before submitting it. If a mobile browser or photo provider rewrites the upload and removes GPS before the server receives it, the server uses those validated client coordinates as a fallback for the post/map. The optimized media file may still omit EXIF GPS by design.

### Push notifications

Generate a VAPID key pair once per deployed environment, then add it to `.env` (or your hosting provider's environment settings):

```bash
npx web-push generate-vapid-keys
```

Push notifications require HTTPS in production. Each family member enables them from **Notifications** on every browser or device where they want alerts.

### Offloading media to MinIO / S3

Set `STORAGE_DRIVER="s3"` and the `S3_*` variables. For a local MinIO instance:

```bash
docker run -p 9000:9000 -p 9001:9001 minio/minio server /data --console-address ":9001"
# create a bucket named "famstagram" in the MinIO console (http://localhost:9001)
```

and use `S3_ENDPOINT="http://localhost:9000"`, `S3_BUCKET="famstagram"`.

## Project structure

```
app/
  (public)/login|invite/[token]   # public pages
  (app)/                          # authenticated pages (feed, create, post, shared, profile, admin)
  actions/                        # server actions (auth, likes, comments, shares, invites)
  api/posts                       # post upload (route handler, supports large files)
  api/media/[key]                 # authenticated media serving
android/                          # Bubblewrap-generated Android Trusted Web Activity
components/                       # UI components (PostCard, MediaCarousel, LikeButton, …)
lib/                              # db, session, auth guards, storage abstraction, validation
prisma/                           # schema + seed
middleware.ts                     # redirects unauthenticated visitors to /login
```

## Android app (Trusted Web Activity)

The Android project in `android/` opens **https://www.famstagram.co.uk/** using
a Trusted Web Activity (TWA), not a separate native UI or embedded WebView.
It reuses the existing login, feeds, uploads, passkeys, and web backend. Web
changes deploy normally without an Android rebuild. A compatible browser
(such as current Chrome) must be installed; if TWA is unavailable or domain
verification fails, it falls back to a browser Custom Tab with a toolbar.

The package ID is **`uk.co.famstagram.app`**. Launcher/splash icons come from
the existing PWA assets. Android share intents target the existing authenticated
share flow, and notification delegation is enabled; users must still grant
notification permission and subscribe through the website. This does not add
offline access or bypass any family/feed permissions.

### Build and try it

Install Android Studio with **JDK 17**, **Android SDK Platform 36**, and Android
SDK Build-Tools. Open `android/` in Android Studio and let Gradle sync, then run
on a device or emulator. Alternatively, from the repository root:

```bash
cd android
# Set ANDROID_HOME to your SDK installation, or set sdk.dir in local.properties.
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

On Windows use `gradlew.bat`. The checked-in Gradle wrapper downloads Gradle;
builds also need access to Google's Maven repository and Maven Central.
Debug builds are signed automatically with your local Android debug key.
Until its certificate is associated with the website, a browser toolbar is expected.

### Sign and verify your domain

1. Install Bubblewrap (Node.js 22 LTS recommended) and create a release key:

   ```bash
   npm install --global @bubblewrap/cli@1.27.0
   cd android
   keytool -genkeypair -v -keystore famstagram.keystore -alias famstagram \
     -keyalg RSA -keysize 2048 -validity 10000
   keytool -list -v -keystore famstagram.keystore -alias famstagram
   ```

   Run `cd android` from the repository root. Choose your own passwords when
   prompted; keep the keystore and passwords backed up securely outside Git.
   The signing path and alias are configured in `android/twa-manifest.json`.

2. Copy the certificate's **SHA256** fingerprint (32 colon-separated hex pairs)
   into the deployed web app's `ANDROID_SHA256_CERT_FINGERPRINTS` environment
   variable. Multiple certificates can be comma-separated. For Google Play,
   use the **app signing certificate** from Play Console → App integrity,
   not just the upload certificate. For local debug verification, inspect
   `~/.android/debug.keystore` with alias `androiddebugkey` instead; only
   authorize debug certificates on environments where you intend to trust them.

3. Deploy/restart the web app with that environment variable, then check:

   ```bash
   curl -i https://www.famstagram.co.uk/.well-known/assetlinks.json
   ```

   It must return **200**, JSON, and your package ID and fingerprint, without
   a login redirect or proxy authentication challenge. Only this exact
   association endpoint is public; private pages and media remain protected.
   An unset variable returns `[]` (no apps trusted); malformed fingerprints
   return 503. Certificate fingerprints are public identifiers, not private keys.

4. Build a signed APK and Android App Bundle:

   ```bash
   cd android
   bubblewrap build
   ```

   Run from the repository root, or omit `cd android` if already there.
   On first use, Bubblewrap can configure its JDK/SDK. Enter signing passwords
   at the prompts. Outputs are `android/app-release-signed.apk` for sideloading
   and `android/app-release-bundle.aab` for Play Console. Do not distribute
   debug builds as releases. `./gradlew bundleRelease` alone produces an
   **unsigned** bundle; use Bubblewrap for signed releases.

5. Install the signed APK on an Android device and confirm toolbar-free launch,
   invite/password/passkey login, photo/video uploads, sharing from Photos,
   and notification opt-in. Verification is tied to the exact `www` HTTPS
   origin; other domains are not implicitly trusted.

### Updating the Android wrapper

Edit `android/twa-manifest.json`, then run `bubblewrap update` from `android/`
to regenerate the native project. Review the generated diff, keep the repository
lists in `android/build.gradle` on `google()` and `mavenCentral()` (the generator
may restore retired `jcenter()`), and retain the package ID and release key.
Bubblewrap increments the Android version code during updates; each Play upload
needs a higher code. A native rebuild is only required for wrapper changes such
as icons, Android permissions, or intent filters—not normal website updates.

## Notes & limits

- Video duration (≤60s) is checked in the browser when picking the file; server-side, size and MIME type are enforced.
- Likes/comments use Next.js server actions; post uploads use a route handler so large videos aren't limited by the server-action body-size cap.
- Media deletion on post-delete isn't implemented yet (posts are permanent in v1).
