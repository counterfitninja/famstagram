import { fetch } from "expo/fetch";
import type { NativeCommand } from "../../lib/native-contract";

export type Credential = { token: string; cookieName: string };
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export const serverUrl = (process.env.EXPO_PUBLIC_API_URL ?? "https://www.famstagram.co.uk").replace(/\/+$/, "");
const parsed = new URL(serverUrl);
if (parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password ||
    (parsed.protocol !== "https:" && !(__DEV__ && parsed.protocol === "http:"))) {
  throw new Error("EXPO_PUBLIC_API_URL must be an HTTPS origin (HTTP is allowed only in development).");
}

export class Api {
  constructor(public credential: Credential | null, private onExpired: () => void) {}
  headers() {
    return {
      "X-Famstagram-Native": "1",
      ...(this.credential ? { Cookie: `${this.credential.cookieName}=${this.credential.token}` } : {}),
    };
  }
  media(key: string) {
    return { uri: `${serverUrl}/api/media/${key.split("/").map(encodeURIComponent).join("/")}`, headers: this.headers() };
  }
  async request<T>(path: string, body?: object | FormData): Promise<T> {
    const form = body instanceof FormData;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), form ? 5 * 60_000 : 30_000);
    try {
      const response = await fetch(`${serverUrl}${path}`, {
        method: body === undefined ? "GET" : "POST", credentials: "omit",
        headers: { ...this.headers(), ...(body && !form ? { "Content-Type": "application/json" } : {}) },
        body: body === undefined ? undefined : form ? body : JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.status === 401 && this.credential) this.onExpired();
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new ApiError("The server did not return an app response. Deploy the native API and check the server address.", response.status);
      }
      const data = await response.json();
      if (!response.ok) throw new ApiError(data.error ?? "The request failed. Please try again.", response.status);
      return data as T;
    } finally { clearTimeout(timeout); }
  }
  get<T>(path: string) { return this.request<T>(`/api/native/${path}`); }
  command(input: NativeCommand) { return this.request<{ token?: string }>("/api/native/command", input); }
}
