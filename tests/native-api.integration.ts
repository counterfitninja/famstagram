import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createServer } from "node:net";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { createPreviewGrant, pushDeviceHash } from "../lib/push-preview";

// Run after npm run build. A fresh database, media folder and standalone server
// keep this independent of developer accounts, credentials and uploaded files.
test("native API end-to-end permissions, uploads and app sign-in", { timeout: 180_000 }, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "famstagram-native-test-"));
  const databaseUrl = `file:${path.join(directory, "test.db")}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "production",
    SESSION_SECRET: "integration-only-session-secret-not-for-production-123456",
    UPLOAD_DIR: path.join(directory, "media"), STORAGE_DRIVER: "local",
    VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "", FIREBASE_PROJECT_ID: "", GOOGLE_APPLICATION_CREDENTIALS: "",
  };
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env, stdio: "pipe" });
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const password = "integration-only-password";
  const passwordHash = await bcrypt.hash(password, 4);
  await db.feed.createMany({ data: [{ id: "feed-a", name: "Integration family" }, { id: "feed-b", name: "Other integration family" }] });
  for (const [id, role, feedId, feedRole] of [
    ["alice", "member", "feed-a", "manager"],
    ["bob", "member", "feed-a", "member"],
    ["outsider", "member", "feed-b", "manager"],
    ["admin", "admin", "feed-b", "manager"],
  ]) {
    await db.user.create({ data: {
      id, username: id, email: `${id}@example.invalid`, role, passwordHash,
      feedMemberships: { create: { feedId, role: feedRole } },
    } });
  }
  const portServer = createServer();
  portServer.listen(0, "127.0.0.1"); await once(portServer, "listening");
  const address = portServer.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve) => portServer.close(() => resolve()));
  const server = spawn(process.execPath, [".next/standalone/server.js"], {
    env: { ...env, PORT: String(port), HOSTNAME: "127.0.0.1", APP_ROOT: process.cwd() },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (chunk) => { log += String(chunk); });
  server.stderr.on("data", (chunk) => { log += String(chunk); });
  const origin = `http://127.0.0.1:${port}`;
  const request = async (endpoint: string, cookie = "", body?: object | FormData) => {
    const form = body instanceof FormData;
    return fetch(`${origin}${endpoint}`, {
      method: body === undefined ? "GET" : "POST", redirect: "manual",
      headers: { "X-Famstagram-Native": "1", ...(cookie ? { Cookie: cookie } : {}), ...(body && !form ? { "Content-Type": "application/json" } : {}) },
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
  };
  const command = (cookie: string, body: object) => request("/api/native/command", cookie, body);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await request("/api/native/me"); ready = true; break; } catch { await new Promise((resolve) => setTimeout(resolve, 200)); }
    }
    assert.ok(ready, `Server failed to start: ${log}`);
    const cookies = new Map<string, string>();
    for (const identifier of ["alice", "bob", "outsider", "admin"]) {
      const response = await request("/api/native/login", "", { identifier, password });
      assert.equal(response.status, 200, await response.clone().text());
      const { token, cookieName } = await response.json();
      cookies.set(identifier, `${cookieName}=${token}`);
    }
    const alice = cookies.get("alice")!, bob = cookies.get("bob")!, outsider = cookies.get("outsider")!;
    let postId = "";
    await t.test("native auth returns JSON and requires the custom header", async () => {
      assert.equal((await request("/api/native/me")).status, 401);
      assert.equal((await fetch(`${origin}/api/native/me`)).status, 400);
      assert.equal((await request("/api/native/login", "", { identifier: "alice", password: "wrong" })).status, 401);
      assert.equal((await request("/api/native/me", "famstagram_session=forged")).status, 401);
    });
    await t.test("gallery upload stores fallback GPS and protects private media", async () => {
      const form = new FormData();
      form.set("caption", "A test photo"); form.set("feedId", "feed-a");
      form.set("clientLatitude", "0"); form.set("clientLongitude", "0");
      const photo = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#336699" } })
        .withMetadata({ exif: { IFD0: { ImageDescription: "Private original metadata" } } }).png().toBuffer();
      form.set("media", new File([new Uint8Array(photo)], "test.png", { type: "image/png" }));
      const response = await request("/api/posts", alice, form);
      assert.equal(response.status, 200, await response.clone().text());
      postId = (await response.json()).id;
      const post = await db.post.findUniqueOrThrow({ where: { id: postId }, include: { media: true } });
      assert.equal(post.latitude, 0); assert.equal(post.longitude, 0);
      const mediaPath = `/api/media/${post.media[0].key}`;
      assert.equal((await request(mediaPath, bob)).status, 200);
      assert.equal((await request(mediaPath, outsider)).status, 404);
      assert.equal((await request(`/api/native/post/${postId}`, outsider)).status, 404);
    });
    await t.test("push previews require valid unexpired grants and current feed/device access", async () => {
      const media = await db.media.findFirstOrThrow({ where: { postId } });
      const token = "integration-preview-device-token";
      await db.nativePushToken.create({ data: { token, provider: "fcm", userId: "bob" } });
      const target = { mediaId: media.id, userId: "bob", device: pushDeviceHash(token) };
      const secret = env.SESSION_SECRET!;
      const endpoint = (grant: string) => `/api/native-preview?grant=${encodeURIComponent(grant)}`;
      const grant = createPreviewGrant(target, secret);
      const response = await request(endpoint(grant));
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(response.headers.get("content-type"), "image/jpeg");
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      const image = await response.arrayBuffer();
      assert.ok(image.byteLength < 1_000_000);
      const metadata = await sharp(Buffer.from(image)).metadata();
      assert.ok(metadata.width! <= 960 && metadata.height! <= 640);
      assert.equal(metadata.exif, undefined);
      assert.equal((await request("/api/native-preview")).status, 404);
      assert.equal((await request(endpoint(`${grant}bad`))).status, 404);
      assert.equal((await request(endpoint(createPreviewGrant(target, secret, Date.now() - 301_000)))).status, 404);
      assert.equal((await request(endpoint(createPreviewGrant({ ...target, userId: "outsider" }, secret)))).status, 404);
      await db.feedMembership.delete({ where: { userId_feedId: { userId: "bob", feedId: "feed-a" } } });
      assert.equal((await request(endpoint(grant))).status, 404);
      await db.feedMembership.create({ data: { userId: "bob", feedId: "feed-a" } });
      await db.nativePushToken.delete({ where: { token } });
      assert.equal((await request(endpoint(grant))).status, 404);
    });
    await t.test("feed reads do not disclose private posts or account fields", async () => {
      const own = await (await request("/api/native/posts", alice)).json();
      assert.equal(own.posts[0].id, postId);
      assert.equal(JSON.stringify(own).includes("passwordHash"), false);
      assert.equal(JSON.stringify(own).includes("@example.invalid"), false);
      assert.deepEqual((await (await request("/api/native/posts", outsider)).json()).posts, []);
      assert.deepEqual((await (await request("/api/native/posts", cookies.get("admin"))).json()).posts, []);
      assert.equal((await request("/api/native/posts?feedId=feed-a", outsider)).status, 404);
      assert.equal((await request("/api/native/posts?page=-1", alice)).status, 400);
    });
    await t.test("likes, comments and shares keep feed boundaries", async () => {
      assert.equal((await command(bob, { action: "like", postId })).status, 200);
      assert.equal(await db.like.count({ where: { postId } }), 1);
      assert.equal((await command(outsider, { action: "like", postId })).status, 404);
      assert.equal((await command(bob, { action: "comment", postId, text: "Hello @alice" })).status, 200);
      assert.equal(await db.comment.count({ where: { postId } }), 1);
      assert.equal((await command(bob, { action: "share", postId, userId: "outsider", message: "" })).status, 400);
      assert.equal((await command(alice, { action: "share", postId, userId: "bob", message: "For you" })).status, 200);
      assert.equal((await (await request("/api/native/shares", bob)).json()).items[0].post.id, postId);
      assert.equal((await command(bob, { action: "deletePost", postId })).status, 400);
      assert.equal((await request("/api/native/admin", bob)).status, 403);
    });
    await t.test("invites create a single account in exactly one feed", async () => {
      const invitation = await (await command(alice, { action: "invite", feedId: "feed-a" })).json();
      assert.ok(invitation.token);
      const data = { username: "new_member", email: "new@example.invalid", password, token: invitation.token, confirmAccount: true };
      assert.equal((await request("/api/native/register", "", data)).status, 200);
      assert.equal((await request("/api/native/register", "", { ...data, username: "another", email: "other@example.invalid" })).ok, false);
      const user = await db.user.findUniqueOrThrow({ where: { username: "new_member" }, include: { feedMemberships: true } });
      assert.deepEqual(user.feedMemberships.map((m) => m.feedId), ["feed-a"]);
      assert.equal((await command(bob, { action: "invite", feedId: "feed-a" })).ok, false);
    });
    await t.test("browser sign-in grants require proof and cannot be replayed", async () => {
      const hash = (value: string) => createHash("sha256").update(value).digest("hex");
      const code = "c".repeat(64), verifier = "a".repeat(64);
      await db.nativeLoginGrant.create({ data: { codeHash: hash(code), challenge: hash(verifier), userId: "alice", expiresAt: new Date(Date.now() + 60_000) } });
      assert.equal((await request("/api/native/exchange", "", { code, verifier: "b".repeat(64) })).status, 401);
      assert.equal((await request("/api/native/exchange", "", { code, verifier })).status, 200);
      assert.equal((await request("/api/native/exchange", "", { code, verifier })).status, 401);
    });
    await t.test("device push registration can be revoked without affecting other users", async () => {
      const token = "integration-test-device:valid_fcm_token";
      assert.equal((await request("/api/native/push", alice, { provider: "expo", token, enabled: true })).status, 400);
      assert.equal((await request("/api/native/push", alice, { provider: "fcm", token, enabled: true })).status, 200);
      assert.equal((await request("/api/native/push", bob, { provider: "fcm", token, enabled: false })).status, 200);
      assert.equal(await db.nativePushToken.count({ where: { token } }), 1);
      assert.equal((await db.nativePushToken.findUniqueOrThrow({ where: { token } })).provider, "fcm");
      assert.equal((await request("/api/native/push", alice, { provider: "fcm", token, enabled: false })).status, 200);
      assert.equal(await db.nativePushToken.count(), 0);
    });
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      const stopped = once(server, "exit");
      server.kill();
      await stopped;
    }
    await db.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
