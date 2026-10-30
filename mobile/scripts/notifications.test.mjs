import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/notifications.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const tokenKey = "famstagram.native.fcm";
const promptedKey = "famstagram.native.notifications-prompted";

function setup({ granted = true, configured = true, stored = {}, failRegistration = false } = {}) {
  const storage = new Map(Object.entries(stored));
  const calls = [];
  const notifications = {
    setNotificationHandler() {},
    AndroidImportance: { DEFAULT: 3 },
    async setNotificationChannelAsync() { calls.push("channel"); },
    async requestPermissionsAsync() { calls.push("prompt"); return { status: granted ? "granted" : "denied" }; },
    async getPermissionsAsync() { return { status: granted ? "granted" : "denied" }; },
    async getDevicePushTokenAsync() { return { data: "current-token" }; },
  };
  const modules = {
    "react-native": { Platform: { OS: "android" } },
    "expo-device": { isDevice: true },
    "expo-constants": { __esModule: true, default: { expoConfig: { extra: { nativePushConfigured: configured } } } },
    "expo-notifications": notifications,
    "expo-secure-store": {
      async getItemAsync(key) { return storage.get(key) ?? null; },
      async setItemAsync(key, value) { storage.set(key, value); },
      async deleteItemAsync(key) { storage.delete(key); },
    },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, require: (name) => {
    assert.ok(name in modules, `Unexpected module: ${name}`);
    return modules[name];
  } });
  const api = { async request(path, body) {
    calls.push({ path, ...body });
    if (failRegistration) throw new Error("Server unavailable");
  } };
  return { ...exports, api, calls, storage };
}

test("first authenticated startup creates the channel, prompts and registers once", async () => {
  const app = setup();
  await app.initializePush(app.api);
  assert.deepEqual(app.calls.slice(0, 2), ["channel", "prompt"]);
  assert.equal(app.storage.get(tokenKey), "current-token");
  await app.initializePush(app.api);
  assert.equal(app.calls.filter((call) => call === "prompt").length, 1);
});

test("declining is remembered without failing startup; manual enable remains available", async () => {
  const app = setup({ granted: false });
  await app.initializePush(app.api);
  await app.initializePush(app.api);
  assert.equal(app.calls.filter((call) => call === "prompt").length, 1);
  assert.equal(app.storage.has(tokenKey), false);
  await assert.rejects(app.enablePush(app.api), /Notifications are blocked/);
});

test("explicit disable prevents automatic re-enabling", async () => {
  const app = setup();
  await app.disablePush(app.api);
  await app.initializePush(app.api);
  assert.deepEqual(app.calls, []);
});

test("existing opt-in restores and rotates the token without another prompt", async () => {
  const app = setup({ stored: { [tokenKey]: "old-token" } });
  await app.initializePush(app.api);
  assert.equal(app.calls.includes("prompt"), false);
  assert.equal(app.storage.get(promptedKey), "true");
  assert.equal(app.storage.get(tokenKey), "current-token");
  assert.ok(app.calls.some((call) => call.token === "old-token" && call.enabled === false));
});

test("revoked permission unregisters an existing device without prompting", async () => {
  const app = setup({ granted: false, stored: { [tokenKey]: "old-token" } });
  await app.initializePush(app.api);
  assert.equal(app.storage.has(tokenKey), false);
  assert.equal(app.calls.includes("prompt"), false);
  assert.ok(app.calls.some((call) => call.enabled === false));
});

test("unconfigured builds skip startup prompting", async () => {
  const app = setup({ configured: false });
  await app.initializePush(app.api);
  assert.deepEqual(app.calls, []);
  assert.equal(app.storage.has(promptedKey), false);
});

test("registration failures surface and can be retried manually", async () => {
  const app = setup({ failRegistration: true });
  await assert.rejects(app.initializePush(app.api), /Server unavailable/);
  assert.equal(app.storage.has(tokenKey), false);
  await assert.rejects(app.enablePush(app.api), /Server unavailable/);
});
