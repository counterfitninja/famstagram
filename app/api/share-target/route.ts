import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { extractFirstGpsCoordinates } from "@/lib/exif";
import { reverseGeocodeLocation } from "@/lib/geocoding";
import { createPostNotifications } from "@/lib/notifications";
import { getSession } from "@/lib/session";
import { saveMedia } from "@/lib/storage";
import { toRequestUrl } from "@/lib/request-url";
import { captionSchema, normalizeSharedMediaFile, validateMediaFiles } from "@/lib/validation";

/**
 * POST /api/share-target — Web Share Target endpoint declared in the manifest.
 * Lets installed-as-PWA users share images/video from another app (e.g. Google
 * Photos) straight into a new post. The OS share sheet performs a top-level
 * POST navigation here, so every outcome is a redirect (never a JSON body).
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.redirect(toRequestUrl(req, "/login"), 303);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.redirect(toRequestUrl(req, "/create?error=Shared+content+was+invalid."), 303);
  }

  const sharedFiles = form.getAll("media").filter((f): f is File => f instanceof File && f.size > 0);
  const files = await Promise.all(sharedFiles.map(normalizeSharedMediaFile));
  const mediaCheck = validateMediaFiles(files);
  if (mediaCheck.error) {
    return NextResponse.redirect(
      toRequestUrl(req, `/create?error=${encodeURIComponent(mediaCheck.error)}`),
      303,
    );
  }

  const sharedText = String(form.get("text") ?? form.get("title") ?? "").trim().slice(0, 500);
  const captionCheck = captionSchema.safeParse(sharedText);
  const caption = captionCheck.success ? captionCheck.data : "";

  // Shares land in the user's active feed after membership verification (contract §5).
  const memberships = await db.feedMembership.findMany({
    where: { userId: session.userId },
    select: { feedId: true },
    orderBy: { feed: { name: "asc" } },
  });
  const feedId =
    memberships.find((m) => m.feedId === session.activeFeedId)?.feedId ?? memberships[0]?.feedId;
  if (!feedId) {
    return NextResponse.redirect(
      toRequestUrl(req, "/create?error=You+have+not+been+added+to+any+feeds+yet."),
      303,
    );
  }

  const coordinates = await extractFirstGpsCoordinates(files);
  const locationName = coordinates
    ? await reverseGeocodeLocation(coordinates.latitude, coordinates.longitude)
    : null;

  const post = await db.post.create({
    data: {
      authorId: session.userId,
      caption,
      feedId,
      latitude: coordinates?.latitude ?? null,
      longitude: coordinates?.longitude ?? null,
      locationName,
    },
  });

  try {
    for (const [index, file] of files.entries()) {
      const { key, mimeType } = await saveMedia(file, feedId);
      await db.media.create({ data: { postId: post.id, key, mimeType, order: index } });
    }
  } catch (err) {
    console.error("Failed to store shared media, rolling back post", err);
    await db.post.delete({ where: { id: post.id } }).catch(() => {});
    return NextResponse.redirect(
      toRequestUrl(req, "/create?error=Upload+failed.+Please+try+again."),
      303,
    );
  }

  await createPostNotifications({ postId: post.id, authorId: session.userId, caption, feedId });

  return NextResponse.redirect(toRequestUrl(req, `/post/${post.id}`), 303);
}
