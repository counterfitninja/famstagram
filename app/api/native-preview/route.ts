import { NextResponse } from "next/server";
import sharp from "sharp";
import { db } from "@/lib/db";
import { getMedia, streamToBuffer } from "@/lib/storage";
import { pushDeviceHash, verifyPreviewGrant } from "@/lib/push-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const imageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function GET(request: Request) {
  const grant = new URL(request.url).searchParams.get("grant") ?? "";
  const claims = verifyPreviewGrant(grant, process.env.SESSION_SECRET ?? "");
  if (!claims) return new NextResponse("Not found", { status: 404, headers });
  const media = await db.media.findFirst({
    where: {
      id: claims.mediaId, mimeType: { in: imageTypes },
      post: { feed: { memberships: { some: { userId: claims.userId } } } },
    },
    select: { key: true },
  });
  if (!media) return new NextResponse("Not found", { status: 404, headers });
  const devices = await db.nativePushToken.findMany({
    where: { userId: claims.userId, provider: "fcm" }, select: { token: true },
  });
  if (!devices.some((device) => pushDeviceHash(device.token) === claims.device)) {
    return new NextResponse("Not found", { status: 404, headers });
  }
  try {
    const stored = await getMedia(media.key);
    if (!stored) return new NextResponse("Not found", { status: 404, headers });
    const image = await sharp(await streamToBuffer(stored.body))
      .rotate().resize({ width: 960, height: 640, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }).jpeg({ quality: 70 }).toBuffer();
    // Re-encoding strips EXIF/GPS; a bounded JPEG fits FCM's 1 MB image limit.
    if (image.length > 1_000_000) throw new Error("Push preview exceeds image size limit.");
    return new NextResponse(new Uint8Array(image), { headers: { ...headers, "Content-Type": "image/jpeg" } });
  } catch {
    console.error("Could not render native push image preview.");
    return new NextResponse("Preview unavailable", { status: 500, headers });
  }
}
