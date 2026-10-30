import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const lifetimeSeconds = 300;
const claimsSchema = z.object({
  mediaId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128),
  device: z.string().regex(/^[a-f0-9]{64}$/),
  expires: z.number().int(),
}).strict();
type PreviewTarget = Omit<z.infer<typeof claimsSchema>, "expires">;

export function pushDeviceHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(`famstagram-push-preview:${payload}`).digest();
}

export function createPreviewGrant(target: PreviewTarget, secret: string, now = Date.now()) {
  if (secret.length < 32) throw new Error("Push previews require a SESSION_SECRET of at least 32 characters.");
  const claims = claimsSchema.parse({ ...target, expires: Math.floor(now / 1000) + lifetimeSeconds });
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${sign(payload, secret).toString("base64url")}`;
}

export function verifyPreviewGrant(grant: string, secret: string, now = Date.now()) {
  if (secret.length < 32 || grant.length > 2048) return null;
  const parts = grant.split(".");
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return null;
  const [payload, signature] = parts;
  const expected = sign(payload, secret);
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = claimsSchema.safeParse(decoded);
  const seconds = Math.floor(now / 1000);
  if (!parsed.success || parsed.data.expires <= seconds || parsed.data.expires > seconds + lifetimeSeconds) return null;
  return parsed.data;
}

export function pushPreviewUrl(origin: string, grant: string) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Push image previews require an HTTPS APP_ORIGIN.");
  return new URL(`/api/native-preview?grant=${encodeURIComponent(grant)}`, url.origin).toString();
}
