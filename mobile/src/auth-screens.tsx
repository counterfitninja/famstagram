import React, { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { StackParams } from "./types";
import type { Credential } from "./api";
import { useSession } from "./session";
import { Button, ErrorNotice, Field, Page, s, useJob } from "./ui";
import { browserSignIn } from "./passkey";

export function LoginScreen({ navigation }: NativeStackScreenProps<StackParams, "Login">) {
  const { api, signIn, startupError } = useSession();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const { busy, run } = useJob();
  return <KeyboardAvoidingView style={s.page} behavior={Platform.OS === "ios" ? "padding" : undefined}><Page>
    <View style={{ paddingTop: 24, gap: 12 }}><Image source={require("../../logo.jpeg")} style={{ width: 150, height: 160, alignSelf: "center" }} resizeMode="contain" /><Text style={[s.title, { fontSize: 36 }]}>Famstagram</Text><Text style={s.muted}>Private moments. Just for family.</Text></View>
    <ErrorNotice error={startupError} />
    <View style={s.card}>
      <Text style={s.title}>Welcome back</Text>
      <Field label="Username or email" value={identifier} onChangeText={setIdentifier} autoCapitalize="none" autoComplete="username" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
      <Button title={busy ? "Signing in..." : "Sign in"} disabled={busy || !identifier || !password} onPress={() => void run(async () => {
        await signIn(await api.request<Credential>("/api/native/login", { identifier, password }));
      })} />
    </View>
    <Button title="Sign in with a passkey in your browser" secondary disabled={busy} onPress={() => void run(async () => {
      const credential = await browserSignIn(api);
      if (credential) await signIn(credential);
    })} />
    <Button title="Join with an invite" secondary onPress={() => navigation.navigate("Register")} />
  </Page></KeyboardAvoidingView>;
}

export function RegisterScreen({ route }: NativeStackScreenProps<StackParams, "Register">) {
  const { api, signIn } = useSession();
  const [invite, setInvite] = useState(route.params?.token ?? "");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, run } = useJob();
  return <Page><Text style={s.title}>Join your family</Text><View style={s.card}>
    <Field label="Invite link or code" value={invite} onChangeText={setInvite} autoCapitalize="none" />
    <Field label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" maxLength={20} autoComplete="username-new" />
    <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
    <Field label="Password (at least 8 characters)" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
    <Text style={s.muted}>Creating an account joins only the private feed named by your invite.</Text>
    <Button title={busy ? "Creating account..." : "Confirm and create account"} disabled={busy || !invite || !username || !email || password.length < 8} onPress={() => void run(async () => {
      const token = invite.trim().split("/").pop()?.split("?")[0] ?? "";
      await signIn(await api.request<Credential>("/api/native/register", { token, username, email, password, confirmAccount: true }));
    })} />
  </View></Page>;
}
