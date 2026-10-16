import assert from "node:assert/strict";
import test from "node:test";
import { getSafeLoginRedirect } from "../lib/auth-redirect";

test("login redirects preserve only safe relative destinations", () => {
  assert.equal(getSafeLoginRedirect("/post/post-1"), "/post/post-1");
  assert.equal(getSafeLoginRedirect("/post/post-1?from=push"), "/post/post-1?from=push");
  assert.equal(getSafeLoginRedirect("https://evil.example"), "/");
  assert.equal(getSafeLoginRedirect("//evil.example"), "/");
  assert.equal(getSafeLoginRedirect("/\\\\evil.example"), "/");
});
