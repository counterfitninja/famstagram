-- AlterTable
ALTER TABLE "Media" ADD COLUMN "optimizedAt" DATETIME;

-- Existing media was optimized synchronously at upload time.
UPDATE "Media" SET "optimizedAt" = CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Media_optimizedAt_idx" ON "Media"("optimizedAt");
