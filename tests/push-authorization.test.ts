import assert from "node:assert/strict";
import test from "node:test";
import { getNotificationDeliveryRecipients } from "../lib/notifications";

test("notification delivery only accepts recipient-scoped identities", () => {
  assert.deepEqual(getNotificationDeliveryRecipients([
    { id: "recipient", type: "post", notificationId: "notification-1" },
    { id: "other", type: "mention" },
  ]), [{ id: "recipient", type: "post", notificationId: "notification-1" }]);
});

test("empty and stale delivery identities are ignored safely", () => {
  assert.deepEqual(getNotificationDeliveryRecipients([]), []);
  assert.deepEqual(getNotificationDeliveryRecipients([{ id: "recipient", type: "post", notificationId: "" }]), []);
});
