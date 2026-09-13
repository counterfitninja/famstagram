import "dotenv/config";
import { backfillMissingGpsCoordinates } from "@/lib/gps-backfill";

/**
 * Standalone entry point for ad-hoc or scheduled (cron) GPS backfill runs, e.g.:
 *   npm run gps:backfill
 * Schedule it via your platform's task scheduler (cron, Pelican egg schedule, etc.)
 * to periodically pick up posts whose GPS wasn't read at upload time.
 */
async function main() {
  const result = await backfillMissingGpsCoordinates();
  console.log(
    `GPS backfill: scanned ${result.scanned} post(s), updated ${result.updated}, ${result.unchanged} had no GPS data.`,
  );
}

main()
  .catch((err) => {
    console.error("GPS backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { db } = await import("@/lib/db");
    await db.$disconnect();
  });
