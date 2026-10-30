import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createNativeGrant } from "@/lib/native-login";
import { btnPrimary } from "@/lib/ui";

export const dynamic = "force-dynamic";
export default async function MobileLoginPage({ searchParams }: {
  searchParams: Promise<{ challenge?: string; state?: string }>;
}) {
  const { challenge, state } = await searchParams;
  if (!challenge || !state || !/^[a-f0-9]{64}$/.test(challenge) || !/^[a-f0-9]{64}$/.test(state)) {
    return <main className="mx-auto max-w-sm p-8">This app sign-in request is invalid. Start again in the Android app.</main>;
  }
  const next = `/mobile-login?challenge=${challenge}&state=${state}`;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  async function authorize() {
    "use server";
    const current = await getCurrentUser();
    if (!current) redirect(`/login?next=${encodeURIComponent(next)}`);
    const code = await createNativeGrant(current.id, challenge!);
    // Fixed callback, never a user-supplied redirect. Proof protects interception.
    redirect(`famstagram://sign-in?code=${code}&state=${state}`);
  }
  return <main className="mx-auto mt-16 max-w-sm space-y-5 rounded-2xl bg-white p-6">
    <h1 className="text-xl font-bold">Sign in to the Famstagram app</h1>
    <p className="text-sm text-neutral-600">Continue as <strong>{user.username}</strong> on your Android device. Only continue if you started this sign-in from the app.</p>
    <form action={authorize}><button className={btnPrimary}>Continue to app</button></form>
  </main>;
}
