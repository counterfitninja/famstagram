import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";
import { nativeCommandSchema, nativeFeedScope, nativeLoginSchema, nativePage, nativeRegisterSchema } from "../lib/native-contract";
import { nativeProofHash } from "../lib/native-login";

test("native feed scope never widens an unauthorized request", () => {
  const memberships = [{ feedId: "family" }, { feedId: "friends" }];
  assert.deepEqual(nativeFeedScope("all", memberships), ["family", "friends"]);
  assert.deepEqual(nativeFeedScope(null, memberships), ["family", "friends"]);
  assert.deepEqual(nativeFeedScope("family", memberships), ["family"]);
  assert.equal(nativeFeedScope("private", memberships), null);
  assert.deepEqual(nativeFeedScope("all", []), []);
});
test("native pagination rejects invalid and unbounded pages", () => {
  assert.equal(nativePage(null).data, 1);
  assert.equal(nativePage("2").data, 2);
  for (const value of ["0", "-1", "1.5", "NaN", "10001"]) assert.equal(nativePage(value).success, false);
});
test("native mutations retain shared limits and reject invalid commands", () => {
  assert.equal(nativeCommandSchema.safeParse({ action: "comment", postId: "p", text: " " }).success, false);
  assert.equal(nativeCommandSchema.safeParse({ action: "comment", postId: "p", text: "x".repeat(501) }).success, false);
  assert.equal(nativeCommandSchema.safeParse({ action: "share", postId: "p", userId: "u", message: "x".repeat(201) }).success, false);
  assert.equal(nativeCommandSchema.safeParse({ action: "memberRole", feedId: "f", userId: "u", role: "owner" }).success, false);
  assert.equal(nativeCommandSchema.safeParse({ action: "location", postId: "p", latitude: 91, longitude: 0 }).success, false);
  assert.equal(nativeCommandSchema.safeParse({ action: "location", postId: "p", latitude: 0, longitude: 0 }).success, true);
  assert.equal(nativeCommandSchema.safeParse({ action: "eraseEverything" }).success, false);
});
test("native auth requires confirmation, valid credentials and a scoped invite", () => {
  assert.equal(nativeLoginSchema.safeParse({ identifier: "", password: "pass" }).success, false);
  const registration = { username: "test_user", email: "test@example.invalid", password: "sample-password", token: "invite", confirmAccount: true };
  assert.equal(nativeRegisterSchema.safeParse(registration).success, true);
  assert.equal(nativeRegisterSchema.safeParse({ ...registration, confirmAccount: false }).success, false);
  assert.equal(nativeRegisterSchema.safeParse({ ...registration, token: "" }).success, false);
});
test("only native API paths and exact app sign-in page bypass browser redirects", () => {
  for (const path of ["/api/native/me", "/api/native/login", "/mobile-login"]) {
    assert.equal(middleware(new NextRequest(`https://famstagram.example${path}`)).status, 200);
  }
  for (const path of ["/api/native-other", "/mobile-login/private", "/api/media/private.jpg"]) {
    assert.equal(middleware(new NextRequest(`https://famstagram.example${path}`)).status, 307);
  }
});
test("app sign-in proof uses a deterministic SHA-256 digest", () => {
  assert.equal(nativeProofHash("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.notEqual(nativeProofHash("different"), nativeProofHash("abc"));
});
