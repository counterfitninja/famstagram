import assert from "node:assert/strict";
import test from "node:test";
import { getPushCapabilityLabel, getPushStateLabel } from "../components/PushSubscriptionControl";

test("push control labels unsupported and denied states truthfully", () => {
  assert.equal(getPushCapabilityLabel({ supported: false, standalone: false, iosBrowser: false }), "Push notifications are not supported in this browser.");
  assert.equal(getPushStateLabel({ permission: "denied", currentSubscribed: false, serverVerified: false }), "Blocked by browser");
});

test("push control labels enabled only after current endpoint verification", () => {
  assert.equal(getPushStateLabel({ permission: "granted", currentSubscribed: true, serverVerified: true }), "Enabled on this device");
  assert.equal(getPushStateLabel({ permission: "granted", currentSubscribed: true, serverVerified: false }), "Needs setup");
});
