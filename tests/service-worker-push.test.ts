import assert from "node:assert/strict";
import test from "node:test";
import { pushEventFixtures } from "./fixtures/push-events";
import { expectedNotificationOptions, normalizeTestPayload } from "./push-test-helpers";

test("malformed payload defaults to the notification center", () => {
  const normalized = normalizeTestPayload({ body: "hello" });
  assert.equal(normalized.url, "/notifications");
  assert.equal(normalized.notificationId, null);
});

test("current and legacy payloads produce Famstagram notification options", () => {
  const current = expectedNotificationOptions(pushEventFixtures.post);
  const legacy = expectedNotificationOptions(pushEventFixtures.legacy);
  assert.equal(current.icon, "/icons/icon-192.png");
  assert.equal(current.badge, "/icons/icon-192.png");
  assert.equal(legacy.data.url, "/post/post-legacy");
});
