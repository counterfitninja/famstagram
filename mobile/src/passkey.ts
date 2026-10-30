import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { serverUrl, type Api, type Credential } from "./api";

export async function browserSignIn(api: Api) {
  const verifier = Array.from(await Crypto.getRandomBytesAsync(32), (value) => value.toString(16).padStart(2, "0")).join("");
  const state = Array.from(await Crypto.getRandomBytesAsync(32), (value) => value.toString(16).padStart(2, "0")).join("");
  const challenge = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier);
  const result = await WebBrowser.openAuthSessionAsync(`${serverUrl}/mobile-login?challenge=${challenge}&state=${state}`, "famstagram://sign-in");
  if (result.type !== "success") return null;
  const callback = new URL(result.url);
  if (callback.protocol !== "famstagram:" || callback.hostname !== "sign-in" || callback.searchParams.get("state") !== state) throw new Error("The app sign-in response could not be verified.");
  const code = callback.searchParams.get("code");
  if (!code) throw new Error("The app sign-in did not return a code.");
  return api.request<Credential>("/api/native/exchange", { code, verifier });
}
