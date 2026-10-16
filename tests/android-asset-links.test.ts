import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../app/.well-known/assetlinks.json/route";
import { ANDROID_PACKAGE_ID, getAndroidAssetLinks } from "../lib/android-asset-links";
import { middleware } from "../middleware";

const fingerprint = Array(32).fill("AB").join(":");
const secondFingerprint = Array(32).fill("CD").join(":");

test("Android domain verification trusts no apps before signing is configured", () => {
  assert.deepEqual(getAndroidAssetLinks(undefined), []);
  assert.deepEqual(getAndroidAssetLinks("  "), []);
});

test("Android domain verification normalizes and deduplicates signing certificates", () => {
  assert.deepEqual(getAndroidAssetLinks(` ${fingerprint.toLowerCase()},${secondFingerprint},${fingerprint} `), [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: ANDROID_PACKAGE_ID,
        sha256_cert_fingerprints: [fingerprint, secondFingerprint],
      },
    },
  ]);
});

test("Android domain verification rejects invalid or partially valid configuration", () => {
  for (const value of ["invalid", "AB:CD", "AB".repeat(32), `${fingerprint},`, `${fingerprint},invalid`]) {
    assert.throws(() => getAndroidAssetLinks(value), /Invalid Android SHA-256/);
  }
});

test("Android package and origin match the website association", () => {
  const manifest = JSON.parse(readFileSync(new URL("../android/twa-manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.packageId, ANDROID_PACKAGE_ID);
  assert.equal(manifest.host, "www.famstagram.co.uk");
  assert.equal(manifest.startUrl, "/");
  assert.equal(manifest.fallbackType, "customtabs");
  assert.equal(manifest.shareTarget.action, "https://www.famstagram.co.uk/api/share-target");
  assert.equal(manifest.minSdkVersion, 24);

  const build = readFileSync(new URL("../android/app/build.gradle", import.meta.url), "utf8");
  assert.match(build, /minSdkVersion 24/);
  assert.ok(build.includes(manifest.shareTarget.action));
});

test("only the exact asset links endpoint bypasses the session gate", () => {
  const publicResponse = middleware(new NextRequest("https://www.famstagram.co.uk/.well-known/assetlinks.json"));
  assert.equal(publicResponse.status, 200);
  assert.equal(publicResponse.headers.get("location"), null);

  for (const path of ["/.well-known/private", "/.well-known/assetlinks.json/private", "/api/media/private.jpg", "/"]) {
    const response = middleware(new NextRequest(`https://www.famstagram.co.uk${path}`));
    assert.equal(response.status, 307);
    assert.equal(new URL(response.headers.get("location")!).pathname, "/login");
  }
});

test("asset links route returns uncached JSON and fails closed on invalid configuration", async () => {
  const original = process.env.ANDROID_SHA256_CERT_FINGERPRINTS;
  try {
    delete process.env.ANDROID_SHA256_CERT_FINGERPRINTS;
    const emptyResponse = GET();
    assert.equal(emptyResponse.status, 200);
    assert.deepEqual(await emptyResponse.json(), []);

    process.env.ANDROID_SHA256_CERT_FINGERPRINTS = fingerprint;
    const response = GET();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type")!, /application\/json/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), getAndroidAssetLinks(fingerprint));

    process.env.ANDROID_SHA256_CERT_FINGERPRINTS = "invalid";
    const invalidResponse = GET();
    assert.equal(invalidResponse.status, 503);
    assert.deepEqual(await invalidResponse.json(), {
      error: "Android domain verification is not configured correctly",
    });
  } finally {
    if (original === undefined) delete process.env.ANDROID_SHA256_CERT_FINGERPRINTS;
    else process.env.ANDROID_SHA256_CERT_FINGERPRINTS = original;
  }
});
