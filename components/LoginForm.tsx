"use client";

import { useActionState, useState } from "react";
import { login } from "@/app/actions/auth";
import PasskeyLoginButton from "@/components/PasskeyLoginButton";
import { btnPrimary, inputCls } from "@/lib/ui";

export default function LoginForm({ nextPath }: { nextPath?: string }) {
  const [state, formAction, isPending] = useActionState(login, null);
  const [identifier, setIdentifier] = useState("");

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={nextPath ?? ""} />
      {state?.error && (
        <p className="rounded-lg bg-red-50 p-2 text-sm text-red-600">{state.error}</p>
      )}
      <input
        name="identifier"
        required
        autoComplete="username"
        placeholder="Username or email"
        className={inputCls}
        value={identifier}
        onChange={(event) => setIdentifier(event.target.value)}
      />
      <input
        name="password"
        type="password"
        required
        autoComplete="current-password"
        placeholder="Password"
        className={inputCls}
      />
      <button type="submit" disabled={isPending} className={btnPrimary}>
        {isPending ? "Signing in…" : "Sign in with password"}
      </button>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-neutral-200" />
        </div>
        <div className="relative flex justify-center text-[11px] uppercase tracking-[0.2em] text-neutral-400">
          <span className="bg-white px-2">or</span>
        </div>
      </div>

      <PasskeyLoginButton identifier={identifier} />
    </form>
  );
}
