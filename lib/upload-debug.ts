import { createHash } from "node:crypto";

export function isUploadDebugEnabled(): boolean {
  return process.env.UPLOAD_DEBUG?.trim().replace(/^['"]|['"]$/g, "").toLowerCase() === "true";
}

export async function hashUploadFile(file: File): Promise<string> {
  const bytes = Buffer.from(await file.arrayBuffer());
  return createHash("sha256").update(bytes).digest("hex");
}

export function logUploadDebug(event: string, details: Record<string, unknown>): void {
  if (isUploadDebugEnabled()) {
    console.log(`[upload-debug] ${event}`, {
      buildCommit: process.env.BUILD_COMMIT ?? "unknown",
      ...details,
    });
  }
}
