"use client";

import { useState, useTransition } from "react";
import { backfillGpsCoordinatesAsAdmin } from "@/app/actions/admin";
import { btnSmall } from "@/lib/ui";

export default function GpsBackfillTool() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  function runBackfill() {
    setResult(null);
    startTransition(async () => {
      try {
        const { scanned, updated, unchanged } = await backfillGpsCoordinatesAsAdmin();
        setResult(
          scanned === 0
            ? "No posts are missing GPS coordinates."
            : `Scanned ${scanned} post(s): found GPS for ${updated}, ${unchanged} had no GPS data in their photos.`,
        );
      } catch {
        setResult("Backfill failed. Check the server logs for details.");
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button type="button" onClick={runBackfill} disabled={isPending} className={btnSmall}>
          {isPending ? "Scanning…" : "Re-scan photos for GPS"}
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        Re-reads EXIF metadata for posts that are still missing a location, in case it wasn&apos;t
        picked up at upload time. Safe to run repeatedly.
      </p>
      {result && <p className="text-xs text-neutral-700">{result}</p>}
    </div>
  );
}
