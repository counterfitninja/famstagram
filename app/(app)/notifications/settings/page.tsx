import Link from "next/link";
import { setUserNotificationMute } from "@/app/actions/notifications";
import PushSubscriptionControl from "@/components/PushSubscriptionControl";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export default async function NotificationSettingsPage() {
  const user = await requireUser();
  const [otherUsers, mutes] = await Promise.all([
    db.user.findMany({
      where: { id: { not: user.id } },
      select: { id: true, username: true },
      orderBy: { username: "asc" },
    }),
    db.notificationMute.findMany({ where: { userId: user.id }, select: { mutedUserId: true } }),
  ]);
  const mutedUserIds = new Set(mutes.map((mute) => mute.mutedUserId));

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-10">
      <div className="rounded-[28px] border border-sky-100 bg-gradient-to-r from-sky-50 via-white to-indigo-50 p-4 shadow-[0_18px_40px_-28px_rgba(14,116,144,0.45)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-sky-500" />
              <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-sky-600">Alerts</p>
            </div>
            <h1 className="mt-2 text-xl font-bold text-neutral-900">Notification settings</h1>
          </div>
          <Link
            href="/notifications"
            className="rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:border-sky-300 hover:bg-sky-50"
          >
            Back
          </Link>
        </div>
      </div>

      <PushSubscriptionControl />
      <div className="rounded-2xl border border-sky-100 bg-sky-50/60 p-4 text-xs leading-5 text-sky-900">
        <p className="font-semibold">Push help</p>
        <p className="mt-1">
          Push alerts are optional and only apply to this browser or installed app. If your browser blocks them, allow
          notifications in its site settings and use Enable again. Your in-app notification center remains available either way.
        </p>
      </div>

      <div className="rounded-[26px] border border-neutral-200 bg-white p-4 shadow-sm">
        <p className="text-sm leading-6 text-neutral-600">
          Choose which family members you get notified about when they post. You&apos;ll still get notified any time
          someone @mentions you, even if you turn off their posts.
        </p>
      </div>

      {otherUsers.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-neutral-200 bg-white p-10 text-center shadow-sm">
          <p className="text-sm text-neutral-500">No other members yet.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {otherUsers.map((otherUser) => {
            const isMuted = mutedUserIds.has(otherUser.id);
            const toggleMute = async () => {
              "use server";
              await setUserNotificationMute(otherUser.id, !isMuted);
            };
            return (
              <li
                key={otherUser.id}
                className="flex items-center justify-between gap-3 rounded-[24px] border border-neutral-200 bg-white p-3.5 shadow-sm transition hover:border-sky-200 hover:shadow-md"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-sky-100 to-indigo-100 text-sm font-bold text-sky-700">
                    {otherUser.username.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <span className="block text-sm font-semibold text-neutral-800">{otherUser.username}</span>
                    <p className="text-[11px] text-neutral-500">
                      {isMuted ? "Muted" : "Alerts enabled"}
                    </p>
                  </div>
                </div>
                <form action={toggleMute}>
                  <button
                    type="submit"
                    className={`relative h-7 w-12 rounded-full border transition ${
                      isMuted
                        ? "border-neutral-300 bg-neutral-200"
                        : "border-sky-300 bg-sky-500 shadow-sm shadow-sky-200"
                    }`}
                    aria-pressed={!isMuted}
                    aria-label={`${isMuted ? "Enable" : "Disable"} notifications from ${otherUser.username}`}
                  >
                    <span
                      className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition ${
                        isMuted ? "left-1" : "left-6"
                      }`}
                    />
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
