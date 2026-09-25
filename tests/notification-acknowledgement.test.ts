import assert from "node:assert/strict";
import test from "node:test";
import { canAcknowledgeNotification } from "../lib/notifications";

test("only the notification recipient can acknowledge an event", () => {
  assert.equal(canAcknowledgeNotification({ userId: "recipient" }, "recipient"), true);
  assert.equal(canAcknowledgeNotification({ userId: "recipient" }, "other"), false);
});

test("missing notifications are safe to acknowledge", () => {
  assert.equal(canAcknowledgeNotification(null, "recipient"), false);
});
