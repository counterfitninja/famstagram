import assert from "node:assert/strict";
import test from "node:test";
import { isValidPushEndpoint, subscriptionSchema } from "../lib/push-subscription";

test("subscription input validates endpoint and cryptographic keys", () => {
  const input = { endpoint: "https://push.example.test/subscription", keys: { p256dh: "key", auth: "auth" } };
  assert.equal(subscriptionSchema.safeParse(input).success, true);
  assert.equal(isValidPushEndpoint(input.endpoint), true);
});

test("subscription input rejects invalid and insecure endpoints", () => {
  assert.equal(subscriptionSchema.safeParse({ endpoint: "not-a-url", keys: { p256dh: "key", auth: "auth" } }).success, false);
  assert.equal(isValidPushEndpoint("http://evil.example/subscription"), false);
});
