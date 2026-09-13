import { db } from "@/lib/db";
import { extractGpsCoordinates } from "@/lib/exif";
import { reverseGeocodeLocation } from "@/lib/geocoding";
import { getMedia } from "@/lib/storage";

export interface GpsBackfillResult {
  scanned: number;
  updated: number;
  unchanged: number;
}

async function toBuffer(body: Buffer | ReadableStream): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;

  const chunks: Uint8Array[] = [];
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Re-scans posts missing GPS coordinates and re-extracts EXIF GPS data from
 * their stored image media. Useful when EXIF parsing failed or was skipped
 * at upload time. Safe to re-run; only touches posts still missing GPS.
 */
export async function backfillMissingGpsCoordinates(limit = 500): Promise<GpsBackfillResult> {
  const posts = await db.post.findMany({
    where: { latitude: null, media: { some: { mimeType: { startsWith: "image/" } } } },
    select: {
      id: true,
      media: {
        where: { mimeType: { startsWith: "image/" } },
        select: { key: true },
        orderBy: { order: "asc" },
      },
    },
    take: limit,
  });

  let updated = 0;
  let unchanged = 0;

  for (const post of posts) {
    let found = false;
    for (const media of post.media) {
      try {
        const stored = await getMedia(media.key);
        if (!stored) continue;

        const coords = await extractGpsCoordinates(await toBuffer(stored.body));
        if (coords) {
          const locationName = await reverseGeocodeLocation(coords.latitude, coords.longitude);
          await db.post.update({
            where: { id: post.id },
            data: { latitude: coords.latitude, longitude: coords.longitude, locationName },
          });
          updated += 1;
          found = true;
          break;
        }
      } catch (err) {
        console.warn(`GPS backfill: failed to process media ${media.key} for post ${post.id}`, err);
      }
    }
    if (!found) unchanged += 1;
  }

  return { scanned: posts.length, updated, unchanged };
}
