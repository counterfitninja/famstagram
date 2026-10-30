import assert from "node:assert/strict";
import test from "node:test";
import { fcmMessage, fcmRegistrationSchema, isUnregisteredFcmToken } from "../lib/fcm-contract";

test("native registration accepts only bounded Android FCM tokens", () => {
  const valid = { provider: "fcm", token: "device_identifier:abcdefghijklmnopqrstuvwxyz-123", enabled: true };
  assert.equal(fcmRegistrationSchema.safeParse(valid).success, true);
  for (const invalid of [
    { ...valid, provider: "expo" }, { ...valid, token: "ExpoPushToken[abc]" },
    { ...valid, token: "a".repeat(4097) }, { ...valid, token: "abc" },
    { ...valid, token: `${valid.token}\n` }, { ...valid, enabled: "true" },
  ]) assert.equal(fcmRegistrationSchema.safeParse(invalid).success, false);
});

test("FCM payload uses generic lock-screen text and Expo-compatible navigation data", () => {
  const payload = fcmMessage("test-token", "post-123", "feed-456");
  assert.deepEqual(JSON.parse(payload.message.data.body), { postId: "post-123", feedId: "feed-456" });
  assert.equal(payload.message.android.notification.channel_id, "family-updates");
  assert.equal(payload.message.android.ttl, "60s");
  assert.deepEqual(payload.message.notification, { title: "Famstagram", body: "There's a new update in your private family feed." });
});

test("only explicit FCM UNREGISTERED errors revoke device registrations", () => {
  const detail = { "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" };
  assert.equal(isUnregisteredFcmToken({ error: { details: [detail] } }), true);
  for (const body of [null, {}, { error: { status: "NOT_FOUND" } },
    { error: { details: [{ ...detail, errorCode: "INVALID_ARGUMENT" }] } },
    { error: { details: [{ ...detail, "@type": "untrusted-type" }] } },
  ]) assert.equal(isUnregisteredFcmToken(body), false);
});
