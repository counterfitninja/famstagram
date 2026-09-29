import assert from "node:assert/strict";
import test from "node:test";
import { pushEventFixtures } from "./fixtures/push-events";
import { buildPushNotificationPayload, getPushNotificationContent, getPushNotificationTag, normalizePushText } from "../lib/push";

test("event-specific push content identifies actor and activity", () => {
  for (const type of ["post", "comment", "mention"] as const) {
    const content = getPushNotificationContent(type, "alex", "Family update");
    assert.match(content.title, /alex/);
    assert.match(content.body, /Family update/);
    assert.ok(content.title.length <= 80);
    assert.ok(content.body.length <= 180);
  }
});

test("content normalizes controls and safely truncates long context", () => {
  const content = getPushNotificationContent(pushEventFixtures.longText.type, pushEventFixtures.longText.actorUsername, pushEventFixtures.longText.caption);
  assert.equal(/[\n\t\u0000]/.test(content.title + content.body), false);
  assert.ok(content.body.length <= 180);
  assert.equal(normalizePushText("hello\nworld"), "hello world");
});

test("notification tags are stable per notification and distinct between events", () => {
  assert.equal(getPushNotificationTag("notification-1", "post-1"), getPushNotificationTag("notification-1", "post-1"));
  assert.notEqual(getPushNotificationTag("notification-1", "post-1"), getPushNotificationTag("notification-2", "post-1"));
});

test("payload includes identity and branding metadata", () => {
  const payload = buildPushNotificationPayload(pushEventFixtures.mention);
  assert.equal(payload.notificationId, pushEventFixtures.mention.notificationId);
  assert.equal(payload.data.feedId, pushEventFixtures.mention.feedId);
  assert.equal(payload.tag, `notification-${pushEventFixtures.mention.notificationId}`);
});
