import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { extractFirstGpsCoordinatesWithDiagnostics } from "@/lib/exif";
import { reverseGeocodeLocation } from "@/lib/geocoding";
import { createPostNotifications } from "@/lib/notifications";
import { getSession } from "@/lib/session";
import { saveMedia } from "@/lib/storage";
import { logUploadDebug, isUploadDebugEnabled } from "@/lib/upload-debug";
import {
  captionSchema,
  inspectMediaFile,
  normalizeSharedMediaFile,
  validateMediaFiles,
} from "@/lib/validation";

/**
 * POST /api/posts — multipart form with "caption", one or more "media" files,
 * and an optional "feedId" destination (defaults to the session's active feed).
 * Implemented as a route handler (not a server action) so large video uploads
 * are not constrained by the server-action body size limit.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const caption = String(form.get("caption") ?? "").trim();
  const captionCheck = captionSchema.safeParse(caption);
  if (!captionCheck.success) {
    return NextResponse.json({ error: captionCheck.error.issues[0].message }, { status: 400 });
  }

  // Normalize generic MIME types used by some phone/photo providers before
  // validating or reading metadata. The server repeats this client-side step
  // because uploads can also come from the PWA share target or another client.
  const uploadedFiles = form.getAll("media").filter((f): f is File => f instanceof File);
  const rawDiagnostics = isUploadDebugEnabled()
    ? await Promise.all(uploadedFiles.map(inspectMediaFile))
    : [];
  const files = await Promise.all(uploadedFiles.map(normalizeSharedMediaFile));
  logUploadDebug("media-received", {
    endpoint: "/api/posts",
    files: rawDiagnostics.map((file, index) => ({ ...file, normalizedType: files[index]?.type ?? null })),
  });
  const mediaCheck = validateMediaFiles(files);
  if (mediaCheck.error) {
    logUploadDebug("media-rejected", { endpoint: "/api/posts", error: mediaCheck.error });
    return NextResponse.json({ error: mediaCheck.error }, { status: 400 });
  }

  // Resolve the destination feed: explicit choice, else the session's active feed.
  // The destination MUST be one of the author's memberships (FR-006, contract §3).
  const memberships = await db.feedMembership.findMany({
    where: { userId: session.userId },
    select: { feedId: true, feed: { select: { name: true } } },
    orderBy: { feed: { name: "asc" } },
  });
  if (memberships.length === 0) {
    return NextResponse.json(
      { error: "You haven't been added to any feeds yet." },
      { status: 403 },
    );
  }
  const requestedFeedId = String(form.get("feedId") ?? "").trim() || session.activeFeedId || "";
  const destination = memberships.find((m) => m.feedId === requestedFeedId) ?? null;
  const feedId = destination?.feedId ?? (requestedFeedId ? null : memberships[0].feedId);
  if (!feedId) {
    return NextResponse.json(
      { error: `Choose one of your feeds: ${memberships.map((m) => m.feed.name).join(", ")}.` },
      { status: 400 },
    );
  }

  // Extract GPS from the first image with valid EXIF/XMP coordinates before
  // image optimization can rewrite its metadata.
  const gpsResult = await extractFirstGpsCoordinatesWithDiagnostics(files);
  logUploadDebug("gps-extraction", {
    endpoint: "/api/posts",
    coordinatesFound: gpsResult.coordinates !== null,
    files: gpsResult.files,
  });
  const coords = gpsResult.coordinates;
  const latitude = coords?.latitude ?? null;
  const longitude = coords?.longitude ?? null;
  const locationName = coords
    ? await reverseGeocodeLocation(coords.latitude, coords.longitude)
    : null;
  logUploadDebug("location-resolved", {
    endpoint: "/api/posts",
    coordinatesFound: coords !== null,
    locationNameFound: locationName !== null,
  });

  const post = await db.post.create({
    data: {
      authorId: session.userId,
      caption: captionCheck.data,
      feedId,
      latitude,
      longitude,
      locationName,
    },
  });
  logUploadDebug("post-created", {
    endpoint: "/api/posts",
    postId: post.id,
    gpsStored: latitude !== null && longitude !== null,
  });

  try {
    for (const [index, file] of files.entries()) {
      const { key, mimeType } = await saveMedia(file, feedId);
      await db.media.create({
        data: { postId: post.id, key, mimeType, order: index },
      });
    }
  } catch (err) {
    console.error("Failed to store media, rolling back post", err);
    await db.post.delete({ where: { id: post.id } }).catch(() => {});
    return NextResponse.json(
      { error: "Upload failed while saving media. Please try again." },
      { status: 500 },
    );
  }

  await createPostNotifications({
    postId: post.id,
    authorId: session.userId,
    caption: captionCheck.data,
    feedId,
  });

  return NextResponse.json({ id: post.id });
}
