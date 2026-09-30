import { db } from "@/lib/db";
import { extractGpsCoordinates } from "@/lib/exif";
import { reverseGeocodeLocation } from "@/lib/geocoding";
import { optimizeStoredImage } from "@/lib/storage";

export interface MediaOptimizationResult {
  processed: number;
  failed: number;
}

let running: Promise<MediaOptimizationResult> | null = null;

/**
 * Background task: shrinks post images that were stored as uploaded originals.
 * GPS is read from the untouched original first (filling in the post's
 * location if it is still missing), then the image is resized in place.
 * Concurrent calls within one process share a single run.
 */
export function optimizePendingMedia(limit = 100): Promise<MediaOptimizationResult> {
  running ??= runOptimization(limit).finally(() => {
    running = null;
  });
  return running;
}

async function runOptimization(limit: number): Promise<MediaOptimizationResult> {
  const pending = await db.media.findMany({
    where: { optimizedAt: null },
    select: {
      id: true,
      key: true,
      mimeType: true,
      post: { select: { id: true, latitude: true, longitude: true } },
    },
    orderBy: { id: "asc" },
    take: limit,
  });

  let processed = 0;
  let failed = 0;
  const postsWithGps = new Set<string>();

  for (const media of pending) {
    try {
      if (!media.mimeType.startsWith("image/")) {
        await markOptimized(media.id);
        processed += 1;
        continue;
      }

      const original = await optimizeStoredImage(media.key, media.mimeType);
      const post = media.post;
      if (
        original &&
        (post.latitude === null || post.longitude === null) &&
        !postsWithGps.has(post.id)
      ) {
        const coords = await extractGpsCoordinates(original);
        if (coords) {
          const locationName = await reverseGeocodeLocation(coords.latitude, coords.longitude);
          await db.post.updateMany({
            where: { id: post.id, OR: [{ latitude: null }, { longitude: null }] },
            data: { latitude: coords.latitude, longitude: coords.longitude, locationName },
          });
          postsWithGps.add(post.id);
        }
      }

      await markOptimized(media.id);
      processed += 1;
    } catch (err) {
      failed += 1;
      console.error(`Media optimization failed for ${media.key}`, err);
      // Don't retry forever on a file that cannot be processed; the original stays usable.
      await markOptimized(media.id).catch(() => {});
    }
  }

  return { processed, failed };
}

async function markOptimized(id: string) {
  await db.media.update({ where: { id }, data: { optimizedAt: new Date() } });
}
