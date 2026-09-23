import Image from "next/image";
import LoginForm from "@/components/LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const nextPath = typeof params.next === "string" ? params.next : undefined;

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow">
        <Image
          src="/logo.jpeg"
          alt="Famstagram"
          width={220}
          height={235}
          className="mx-auto mb-4 h-auto w-44"
          priority
        />
        <p className="mb-6 text-sm text-neutral-500">Sign in to your family account</p>
        <LoginForm nextPath={nextPath} />
        <p className="mt-6 text-center text-xs text-neutral-400">
          This is a private site. Ask a family admin for an invite link to join.
        </p>
      </div>
    </main>
  );
}
