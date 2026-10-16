import { getAndroidAssetLinks } from "@/lib/android-asset-links";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return Response.json(
      getAndroidAssetLinks(process.env.ANDROID_SHA256_CERT_FINGERPRINTS),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Android domain verification is not configured correctly" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
