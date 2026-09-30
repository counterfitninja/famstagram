import { db } from "@/lib/db";
import { extractGpsCoordinates } from "@/lib/exif";
import { reverseGeocodeLocation } from "@/lib/geocoding";
import { getMedia, streamToBuffer } from "@/lib/storage";

export interface GpsBackfillResult {
  scanned: number;
  updated: number;
  unchanged: number;
}

const IMAGE_KEY_SUFFIXES = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"];

const mediaWithPotentialGpsFilter = {
  OR: [
    { mimeType: { startsWith: "image/" } },
    // Older mobile HEIC uploads could be mislabeled video/mp4 because HEIC
    // uses the same ISO-BMFF container. Include those files for recovery.
    { mimeType: "video/mp4" },
    ...IMAGE_KEY_SUFFIXES.map((suffix) => ({ key: { endsWith: suffix } })),
  ],
};

async function toBuffer(body: Buffer | ReadableStream): Promise<Buffer> {
  return streamToBuffer(body);
}

/**
 * Re-scans posts missing GPS coordinates and re-extracts EXIF GPS data from
 * their stored image media. Useful when EXIF parsing failed or was skipped
 * at upload time. Safe to re-run; only touches posts still missing GPS.
 */
export async function backfillMissingGpsCoordinates(limit = 500): Promise<GpsBackfillResult> {
  const posts = await db.post.findMany({
    where: { OR: [{ latitude: null }, { longitude: null }], media: { some: mediaWithPotentialGpsFilter } },
    select: {
      id: true,
      media: {
        where: mediaWithPotentialGpsFilter,
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
