import assert from "node:assert/strict";
import test from "node:test";
import { createPreviewGrant, pushDeviceHash, pushPreviewUrl, verifyPreviewGrant } from "../lib/push-preview";
import { getPushNotificationContent } from "../lib/notification-content";

const secret = "preview-test-secret-not-for-production-123456";
const now = 1_800_000_000_000;
const target = { mediaId: "media-one", userId: "recipient", device: pushDeviceHash("private-device-token") };

test("preview grants are signed, scoped to media/recipient/device and expire after five minutes", () => {
  const grant = createPreviewGrant(target, secret, now);
  assert.deepEqual(verifyPreviewGrant(grant, secret, now), { ...target, expires: now / 1000 + 300 });
  assert.equal(verifyPreviewGrant(grant, secret, now + 300_000), null);
  assert.equal(verifyPreviewGrant(grant, secret, now - 1000), null);
  assert.equal(verifyPreviewGrant(grant, `${secret}-rotated`, now), null);
  assert.equal(grant.includes("private-device-token"), false);
  const [payload, signature] = grant.split(".");
  const tampered = Buffer.from(JSON.stringify({ ...target, userId: "outsider", expires: now / 1000 + 300 })).toString("base64url");
  assert.equal(verifyPreviewGrant(`${tampered}.${signature}`, secret, now), null);
  assert.equal(verifyPreviewGrant(`${payload}.short`, secret, now), null);
});

test("invalid grants fail closed and preview links require HTTPS without embedded credentials", () => {
  for (const grant of ["", "invalid", "a.b.c", "*.*", "a".repeat(2049)]) {
    assert.equal(verifyPreviewGrant(grant, secret, now), null);
  }
  assert.equal(verifyPreviewGrant(createPreviewGrant(target, secret, now), "", now), null);
  assert.throws(() => createPreviewGrant(target, "", now));
  for (const origin of ["", "http://photos.example", "https://user:password@photos.example"]) {
    assert.throws(() => pushPreviewUrl(origin, "grant"));
  }
  assert.equal(pushPreviewUrl("https://photos.example/path", "a.b"), "https://photos.example/api/native-preview?grant=a.b");
});

test("native rich text matches post, comment and mention events, including empty captions", () => {
  assert.deepEqual(getPushNotificationContent("post", "alice", "Family picnic"), { title: "New post from alice", body: "Family picnic" });
  assert.deepEqual(getPushNotificationContent("comment", "bob", "Lovely photo!"), { title: "bob commented on your post", body: "Lovely photo!" });
  assert.deepEqual(getPushNotificationContent("mention", "bob", "@alice look!"), { title: "bob tagged you", body: "@alice look!" });
  assert.equal(getPushNotificationContent("post", "alice", "").body, "Shared a new photo or video.");
});
