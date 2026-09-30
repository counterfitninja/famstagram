import "dotenv/config";
import { optimizePendingMedia } from "@/lib/media-optimization";

/**
 * Processes any post images still stored as uploaded originals, e.g.:
 *   npm run media:optimize
 * Uploads normally trigger this automatically; schedule it (cron, etc.) as a
 * safety net for items missed when the server restarted mid-task.
 */
async function main() {
  let total = 0;
  for (;;) {
    const { processed, failed } = await optimizePendingMedia();
    total += processed + failed;
    if (failed > 0) console.warn(`Media optimization: ${failed} file(s) failed.`);
    if (processed + failed === 0) break;
  }
  console.log(`Media optimization: processed ${total} file(s).`);
}

main()
  .catch((err) => {
    console.error("Media optimization failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { db } = await import("@/lib/db");
    await db.$disconnect();
  });
