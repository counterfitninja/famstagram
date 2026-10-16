import Link from "next/link";
import PostCard from "@/components/PostCard";
import { db } from "@/lib/db";
import { membershipFeedIds, requireFeedContext } from "@/lib/feed-context";
import { postInclude } from "@/lib/types";

export default async function PostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireFeedContext();
  const { id } = await params;
  const feedIds = membershipFeedIds(ctx);

  const [post, members] = await Promise.all([
    db.post.findUnique({ where: { id }, include: postInclude }),
    db.user.findMany({
      where: { id: { not: ctx.user.id }, feedMemberships: { some: { feedId: { in: feedIds } } } },
      select: { id: true, username: true },
      orderBy: { username: "asc" },
    }),
  ]);
  // Do not reveal whether a stale destination was deleted or belongs to another feed.
  if (!post || !feedIds.includes(post.feedId)) {
    return (
      <div className="mx-auto max-w-xl rounded-3xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-sky-100 text-xl text-sky-700">?</div>
        <h1 className="mt-4 text-lg font-semibold text-neutral-900">This post is unavailable</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-500">
          The family activity may have been removed or is no longer available to your account.
        </p>
        <Link href="/notifications" className="mt-5 inline-flex rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700">
          Back to notifications
        </Link>
      </div>
    );
  }

  return (
    <PostCard
      post={post}
      currentUserId={ctx.user.id}
      members={members}
      showAllComments
      showFeedLabel
      isAdmin={ctx.user.role === "admin"}
    />
  );
}
