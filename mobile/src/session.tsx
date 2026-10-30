import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as SecureStore from "expo-secure-store";
import { Alert } from "react-native";
import { Api, type Credential } from "./api";
import type { Me } from "./types";
import { restorePush, watchPushToken } from "./notifications";

type Session = {
  api: Api; me: Me | null; starting: boolean; startupError: string | null;
  feedId: string; setFeedId: (id: string) => void; refresh: () => Promise<void>;
  signIn: (credential: Credential) => Promise<void>; signOut: () => Promise<void>;
};
const Context = createContext<Session | null>(null);
const key = "famstagram.native.session";
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [credential, setCredential] = useState<Credential | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [starting, setStarting] = useState(true);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [feedId, setFeedId] = useState("all");
  const authVersion = useRef(0);
  const signOut = useCallback(async () => {
    authVersion.current++;
    await SecureStore.deleteItemAsync(key);
    setCredential(null); setMe(null); setFeedId("all");
  }, []);
  const api = useMemo(() => new Api(credential, () => {
    void signOut().catch((error: Error) => Alert.alert("Could not clear sign-in", error.message));
  }), [credential, signOut]);
  const refresh = useCallback(async () => {
    if (!credential) return;
    const version = authVersion.current;
    const data = await api.get<Me>("me");
    if (version !== authVersion.current) return;
    setMe(data);
    setFeedId((current) => current === "all" || data.feeds.some((f) => f.id === current) ? current : "all");
  }, [api, credential]);
  useEffect(() => {
    if (!credential) return;
    const subscription = watchPushToken(api, (error) => Alert.alert("Could not update notifications", error.message));
    return () => subscription.remove();
  }, [api, credential]);
  useEffect(() => {
    SecureStore.getItemAsync(key).then(async (value) => {
      if (!value) return;
      const stored: Credential = JSON.parse(value);
      if (typeof stored.token !== "string" || stored.cookieName !== "famstagram_session") throw new Error("Stored sign-in is invalid. Sign out and sign in again.");
      const client = new Api(stored, () => { void signOut().catch((e: Error) => setStartupError(e.message)); });
      const data = await client.get<Me>("me");
      await restorePush(client).catch((error: Error) => Alert.alert("Could not restore notifications", error.message));
      setCredential(stored); setMe(data);
    }).catch((error: Error) => setStartupError(error.message)).finally(() => setStarting(false));
  }, [signOut]);
  const signIn = async (value: Credential) => {
    const client = new Api(value, () => {});
    const data = await client.get<Me>("me");
    await restorePush(client).catch((error: Error) => Alert.alert("Could not restore notifications", error.message));
    await SecureStore.setItemAsync(key, JSON.stringify(value), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    authVersion.current++;
    setCredential(value); setMe(data); setStartupError(null);
  };
  return <Context.Provider value={{ api, me, starting, startupError, feedId, setFeedId, refresh, signIn, signOut }}>{children}</Context.Provider>;
}
export function useSession() {
  const value = useContext(Context);
  if (!value) throw new Error("SessionProvider is required.");
  return value;
}
