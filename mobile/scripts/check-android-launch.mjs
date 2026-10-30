import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serial = process.argv[2];
if (!serial) throw new Error("Specify a clean test device: npm run test:android:launch -- emulator-5554");
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
const adb = sdk ? path.join(sdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb") : "adb";
const apk = path.resolve(root, process.argv[3] ?? "android/app/build/outputs/apk/release/app-release.apk");
if (!existsSync(apk)) throw new Error(`Build the release APK first: ${apk}`);
const app = "uk.co.famstagram.nativeapp";
const run = (...args) => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8", timeout: 60_000 });

console.log(run("install", "-r", apk).trim());
run("shell", "am", "force-stop", app);
console.log(run("shell", "am", "start", "-W", "-n", `${app}/.MainActivity`).trim());
await setTimeout(15_000);
try {
  if (!run("shell", "pidof", app).trim()) throw new Error("No running process");
} catch (cause) {
  throw new Error("The release app exited during startup. Inspect adb logcat -b crash.", { cause });
}
run("shell", "uiautomator", "dump", "/sdcard/famstagram-launch-check.xml");
const xml = run("shell", "cat", "/sdcard/famstagram-launch-check.xml");
if (!xml.includes(`package="${app}"`) || !xml.includes('text="Welcome back"') || !xml.includes('text="Sign in"')) {
  throw new Error("The app did not reach the sign-in screen. Use a test device with no saved Famstagram login.");
}
console.log("PASS: release APK remained running and rendered the native sign-in screen.");
