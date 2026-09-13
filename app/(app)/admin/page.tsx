import Link from "next/link";
import { deletePostAsAdmin, resetUserPasswordAsAdmin, setUserAdminRoleAsAdmin } from "@/app/actions/admin";
import { createInvite, deleteInvite } from "@/app/actions/invites";
import AdminPushPwaTools from "@/components/AdminPushPwaTools";
import CopyInviteLink from "@/components/CopyInviteLink";
import GpsBackfillTool from "@/components/GpsBackfillTool";
import DeleteUserButton from "@/components/DeleteUserButton";
import { requireAdmin } from "@/lib/auth";
import { db, getDatabaseLocation } from "@/lib/db";
import { isPushConfigured } from "@/lib/push";
import { getMediaMetadata } from "@/lib/storage";
import { btnSmall } from "@/lib/ui";
import { timeAgo } from "@/lib/utils";

function formatBytes(bytes: number | null) {
  if (bytes === null) return "Unknown";
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

function pushProvider(endpoint: string) {
  const hostname = new URL(endpoint).hostname;
  if (hostname.includes("fcm.googleapis.com")) return "Google FCM";
  if (hostname.includes("mozilla.com")) return "Mozilla";
  if (hostname.includes("windows.com")) return "Microsoft WNS";
  return hostname;
}

export default async function AdminPage() {
  const admin = await requireAdmin();
  const now = new Date();

  const [users, recentPosts, allMedia, invites, pushSubscriptions, totals] = await Promise.all([
    db.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        createdAt: true,
        _count: {
          select: {
            posts: true,
            likes: true,
            comments: true,
            sharesSent: true,
            sharesReceived: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.post.findMany({
      select: {
        id: true,
        caption: true,
        createdAt: true,
        author: { select: { username: true } },
        media: { select: { key: true, mimeType: true }, orderBy: { order: "asc" } },
        _count: { select: { likes: true, comments: true, shares: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.media.findMany({ select: { key: true, mimeType: true } }),
    db.invite.findMany({
      include: { usedBy: { select: { username: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.pushSubscription.findMany({
      select: {
        id: true,
        endpoint: true,
        userAgent: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { username: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    Promise.all([
      db.post.count(),
      db.comment.count(),
      db.like.count(),
      db.sharedPost.count(),
      db.notification.count({ where: { readAt: null } }),
      db.pushSubscription.count(),
    ]),
  ]);

  const mediaSizes = await Promise.all(
    allMedia.map(async (media) => ({
      ...media,
      size: (await getMediaMetadata(media.key))?.size ?? null,
    })),
  );
  const sizeByKey = new Map(mediaSizes.map((media) => [media.key, media.size]));
  const knownStorageBytes = mediaSizes.reduce((sum, media) => sum + (media.size ?? 0), 0);
  const unknownFiles = mediaSizes.filter((media) => media.size === null).length;
  const imageCount = allMedia.filter((media) => media.mimeType.startsWith("image/")).length;
  const videoCount = allMedia.filter((media) => media.mimeType.startsWith("video/")).length;
  const [postCount, commentCount, likeCount, shareCount, unreadAlertCount, pushSubCount] = totals;
  const activeInviteCount = invites.filter((invite) => !invite.usedAt && invite.expiresAt > now).length;
  const pushConfigured = isPushConfigured();
  const databaseLocation = getDatabaseLocation();
  const largestFiles = mediaSizes
    .filter((media): media is typeof media & { size: number } => media.size !== null)
    .sort((first, second) => second.size - first.size)
    .slice(0, 5);

  const statCards = [
    { label: "Members", value: users.length.toString(), detail: `${users.filter((user) => user.role === "admin").length} admins` },
    { label: "Posts", value: postCount.toString(), detail: `${recentPosts.length} shown below` },
    { label: "Files", value: allMedia.length.toString(), detail: `${imageCount} images, ${videoCount} videos` },
    { label: "Storage", value: formatBytes(knownStorageBytes), detail: unknownFiles > 0 ? `${unknownFiles} unknown sizes` : "All file sizes known" },
    { label: "Push Devices", value: pushSubCount.toString(), detail: pushConfigured ? "VAPID configured" : "VAPID missing" },
    { label: "Active invites", value: activeInviteCount.toString(), detail: "Unused and unexpired" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Admin panel</h1>
          <p className="mt-1 text-xs text-neutral-500">
            Site health, member activity, storage, and post moderation.
          </p>
        </div>
        <Link href="/admin/invites" className={btnSmall}>
          Create invites
        </Link>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {statCards.map((stat) => (
          <div key={stat.label} className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-[11px] font-medium uppercase text-neutral-400">{stat.label}</p>
            <p className="mt-1 text-2xl font-semibold text-neutral-900">{stat.value}</p>
            <p className="mt-1 text-xs text-neutral-500">{stat.detail}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Database</h2>
        <p className="mt-1 text-xs text-neutral-500">The database file currently used by this server.</p>
        <code className="mt-3 block overflow-x-auto rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
          {databaseLocation}
        </code>
      </section>

      <section className="overflow-hidden rounded-2xl bg-white p-4 shadow-sm space-y-3">
        <div>
          <h2 className="text-sm font-semibold">PWA & Push Notifications Diagnostic & Tools</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Check installation status, test local/server push notifications, and trigger PWA prompt.
          </p>
        </div>
        <AdminPushPwaTools
          isVapidConfigured={pushConfigured}
          totalSubscriptions={pushSubCount}
          subscriptions={pushSubscriptions.map((subscription) => ({
            id: subscription.id,
            username: subscription.user.username,
            provider: pushProvider(subscription.endpoint),
            endpointFingerprint: subscription.endpoint.slice(-18),
            userAgent: subscription.userAgent,
            createdAt: subscription.createdAt.toLocaleString(),
            updatedAt: subscription.updatedAt.toLocaleString(),
          }))}
        />
      </section>

      <section className="overflow-hidden rounded-2xl bg-white p-4 shadow-sm space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Photo GPS backfill</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Retry EXIF GPS extraction for posts that don&apos;t have a location yet.
          </p>
        </div>
        <GpsBackfillTool />
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-neutral-100 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">Invite links</h2>
            <p className="mt-1 text-xs text-neutral-500">Single-use links for adding family members.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/feeds" className={btnSmall}>
              Manage feeds
            </Link>
            <Link href="/admin/invites" className={btnSmall}>
              Create new invites
            </Link>
            <form action={createInvite}>
              <button className={btnSmall}>+ Generate invite link</button>
            </form>
          </div>
        </div>
        {invites.length === 0 ? (
          <p className="p-6 text-center text-sm text-neutral-500">
            No invites yet. Generate one to invite your first family member.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {invites.map((invite) => {
              const expired = invite.expiresAt < now;
              const active = !invite.usedAt && !expired;
              return (
                <li key={invite.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    {active ? (
                      <CopyInviteLink token={invite.token} />
                    ) : (
                      <code className="text-xs text-neutral-400">/invite/{invite.token}</code>
                    )}
                    <p className="mt-1 text-xs text-neutral-500">
                      {invite.usedAt ? (
                        <>
                          Used by <span className="font-medium">{invite.usedBy?.username ?? "unknown"}</span>
                        </>
                      ) : expired ? (
                        "Expired"
                      ) : (
                        <>Active · expires {invite.expiresAt.toLocaleDateString()}</>
                      )}
                    </p>
                  </div>
                  {!invite.usedAt && (
                    <form action={deleteInvite.bind(null, invite.id)}>
                      <button className="text-xs text-neutral-400 hover:text-red-600" title="Delete invite">
                        Delete
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="border-b border-neutral-100 p-4">
          <h2 className="text-sm font-semibold">Members</h2>
          <p className="mt-1 text-xs text-neutral-500">Post, comment, like, and share totals by account.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-400">
              <tr>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Joined</th>
                <th className="px-4 py-3 font-medium">Posts</th>
                <th className="px-4 py-3 font-medium">Comments</th>
                <th className="px-4 py-3 font-medium">Likes</th>
                <th className="px-4 py-3 font-medium">Shares</th>
                <th className="px-4 py-3 font-medium">Account</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="px-4 py-3">
                    <Link href={`/profile/${user.username}`} className="font-medium hover:underline">
                      {user.username}
                    </Link>
                    <p className="text-xs text-neutral-400">{user.email}</p>
                  </td>
                  <td className="px-4 py-3 text-neutral-600">{user.role}</td>
                  <td className="px-4 py-3 text-neutral-500">{user.createdAt.toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-neutral-600">{user._count.posts}</td>
                  <td className="px-4 py-3 text-neutral-600">{user._count.comments}</td>
                  <td className="px-4 py-3 text-neutral-600">{user._count.likes}</td>
                  <td className="px-4 py-3 text-neutral-600">
                    {user._count.sharesSent + user._count.sharesReceived}
                  </td>
                  <td className="px-4 py-3">
                    {user.id === admin.id ? (
                      <span className="text-xs text-neutral-400">Current account</span>
                    ) : (
                      <div className="flex min-w-[260px] items-center gap-2">
                        <form action={resetUserPasswordAsAdmin.bind(null, user.id)} className="flex items-center gap-2">
                          <input
                            name="password"
                            type="password"
                            minLength={8}
                            maxLength={100}
                            required
                            aria-label={`New password for ${user.username}`}
                            placeholder="New password"
                            className="w-32 rounded-lg border border-neutral-200 px-2 py-1 text-xs outline-none focus:border-sky-500"
                          />
                          <button className="text-xs font-medium text-sky-700 hover:text-sky-900">Reset</button>
                        </form>
                        <form action={setUserAdminRoleAsAdmin.bind(null, user.id, user.role === "admin" ? "member" : "admin")}>
                          <button className="text-xs font-medium text-neutral-600 hover:text-neutral-900">
                            {user.role === "admin" ? "Remove admin" : "Make admin"}
                          </button>
                        </form>
                        <DeleteUserButton userId={user.id} username={user.username} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="border-b border-neutral-100 p-4">
          <h2 className="text-sm font-semibold">Recent posts</h2>
          <p className="mt-1 text-xs text-neutral-500">Removing a post also removes its files, likes, comments, shares, and alerts.</p>
        </div>
        {recentPosts.length === 0 ? (
          <p className="p-6 text-center text-sm text-neutral-500">No posts have been shared yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {recentPosts.map((post) => {
              const postBytes = post.media.reduce((sum, media) => sum + (sizeByKey.get(media.key) ?? 0), 0);
              const unknownPostFiles = post.media.filter((media) => sizeByKey.get(media.key) === null).length;
              return (
                <li key={post.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                      <Link href={`/post/${post.id}`} className="font-medium text-sky-700 hover:underline">
                        Open post
                      </Link>
                      <span>by {post.author.username}</span>
                      <span>{timeAgo(post.createdAt)}</span>
                    </div>
                    <p className="mt-1 truncate text-sm text-neutral-800">
                      {post.caption || "No caption"}
                    </p>
                    <p className="mt-1 text-xs text-neutral-500">
                      {post.media.length} files · {formatBytes(postBytes)}
                      {unknownPostFiles > 0 ? ` + ${unknownPostFiles} unknown` : ""} · {post._count.likes} likes · {post._count.comments} comments · {post._count.shares} shares
                    </p>
                  </div>
                  <form action={deletePostAsAdmin.bind(null, post.id)}>
                    <button className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50">
                      Remove post
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="border-b border-neutral-100 p-4">
          <h2 className="text-sm font-semibold">Largest files</h2>
          <p className="mt-1 text-xs text-neutral-500">Useful for spotting uploads that dominate storage.</p>
        </div>
        {largestFiles.length === 0 ? (
          <p className="p-6 text-center text-sm text-neutral-500">No readable file sizes yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {largestFiles.map((media) => (
              <li key={media.key} className="flex items-center justify-between gap-3 p-4 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-neutral-800">{media.key}</p>
                  <p className="text-xs text-neutral-500">{media.mimeType}</p>
                </div>
                <span className="shrink-0 text-neutral-600">{formatBytes(media.size)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}