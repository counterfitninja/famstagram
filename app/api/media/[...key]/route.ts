import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { getMedia } from "@/lib/storage";

const LEGACY_KEY_RE = /^[a-zA-Z0-9._-]+$/;
const FEED_KEY_RE = /^feeds\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9._-]+)$/;
const DEFAULT_FEED_ID = "default-feed-family";
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

/**
 * GET /api/media/[key] — serves uploaded media to signed-in members of the
 * owning feed only (FR-011). Keys are either legacy `<uuid>.<ext>` (resolved to
 * the default feed) or feed-namespaced `feeds/<feedId>/<uuid>.<ext>`.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string | string[] }> },
) {
  const session = await getSession();
  if (!session.userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { key: rawKey } = await params;
  const segments = Array.isArray(rawKey) ? rawKey : [rawKey];
  const key = segments.map((segment) => decodeURIComponent(segment)).join("/");

  // Validate the key shape to prevent path traversal, and extract the owning feed.
  const feedMatch = FEED_KEY_RE.exec(key);
  if (feedMatch === null && !LEGACY_KEY_RE.test(key)) {
    return new NextResponse("Invalid key", { status: 400 });
  }

  const [media, avatar] = await Promise.all([
    db.media.findFirst({ where: { key }, select: { mimeType: true, post: { select: { feedId: true } } } }),
    db.user.findFirst({ where: { avatarKey: key }, select: { avatarMimeType: true } }),
  ]);
  const extension = key.split(".").pop()?.toLowerCase() ?? "";
  const legacyMimeType = feedMatch === null ? MIME_BY_EXTENSION[extension] : undefined;
  const mimeType = media?.mimeType ?? avatar?.avatarMimeType ?? legacyMimeType;
  if (!mimeType) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Authorization: media owned by a post is only visible to members of that
  // post's feed. Avatars remain visible to any signed-in member (they appear
  // wherever the member appears, across shared feeds).
  if (media || legacyMimeType) {
    const owningFeedId = media?.post?.feedId ?? feedMatch?.[1] ?? DEFAULT_FEED_ID;
    const membership = await db.feedMembership.findUnique({
      where: { userId_feedId: { userId: session.userId, feedId: owningFeedId } },
      select: { id: true },
    });
    if (!membership) {
      // Same response as nonexistent media — no feed existence leak (FR-010).
      return new NextResponse("Not found", { status: 404 });
    }
  }

  const file = await getMedia(key);
  if (!file) {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(file.body as BodyInit, {
    headers: {
      "Content-Type": mimeType,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
