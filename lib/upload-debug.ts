export function isUploadDebugEnabled(): boolean {
  return process.env.UPLOAD_DEBUG?.trim().replace(/^['"]|['"]$/g, "").toLowerCase() === "true";
}

export function logUploadDebug(event: string, details: Record<string, unknown>): void {
  if (isUploadDebugEnabled()) {
    console.log(`[upload-debug] ${event}`, details);
  }
}
