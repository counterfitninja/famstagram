import assert from "node:assert/strict";
import test from "node:test";
import { expectedClickTarget } from "./push-test-helpers";

test("click routing keeps relative private destinations", () => {
  assert.equal(expectedClickTarget({ data: { url: "/post/post-1" } }), "/post/post-1");
  assert.equal(expectedClickTarget({ url: "https://evil.example/media.jpg" }), "/notifications");
});

test("duplicate clicks retain one deterministic destination", () => {
  const payload = { notificationId: "notification-1", url: "/post/post-1" };
  assert.equal(expectedClickTarget(payload), expectedClickTarget(payload));
});
