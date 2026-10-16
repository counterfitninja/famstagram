import assert from "node:assert/strict";
import test from "node:test";
import { pushEventFixtures } from "./fixtures/push-events";
import { expectedClickTarget, expectedNotificationOptions } from "./push-test-helpers";
import { buildPushNotificationPayload, normalizePushPayload } from "../lib/push";

test("push payload contract keeps recipient identity and private relative destination", () => {
  const event = pushEventFixtures.comment;
  const payload = buildPushNotificationPayload({
    notificationId: event.notificationId,
    type: event.type,
    actorUsername: event.actorUsername,
    caption: event.caption,
    postId: event.postId,
    feedId: event.feedId,
  });
  assert.equal(payload.notificationId, event.notificationId);
  assert.equal(payload.data.notificationId, event.notificationId);
  assert.match(payload.url, /^\/post\//);
  assert.equal(payload.icon, "/icons/icon-192.png");
  assert.equal(payload.badge, "/icons/icon-192.png");
  assert.ok(payload.body.length <= 180);
  assert.equal(payload.body.includes(event.feedId), false);
  assert.equal(payload.body.includes("p256dh"), false);
});

test("legacy payloads normalize to a safe notification destination", () => {
  const normalized = normalizePushPayload(pushEventFixtures.legacy);
  assert.equal(normalized.url, "/post/post-legacy");
  assert.equal(normalized.notificationId, null);
  assert.deepEqual(expectedClickTarget(pushEventFixtures.legacy), "/post/post-legacy");
  assert.equal(expectedNotificationOptions(pushEventFixtures.legacy).icon, "/icons/icon-192.png");
});
