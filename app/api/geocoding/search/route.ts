import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

const MAX_RESULTS = 5;
const MIN_QUERY_LENGTH = 2;

type NominatimResult = {
  display_name?: unknown;
  lat?: unknown;
  lon?: unknown;
};

export async function GET(req: Request) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const user = await db.user.findUnique({ where: { id: session.userId }, select: { role: true } });
  if (user?.role !== "admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const rawQuery = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  const query = rawQuery.slice(0, 120);
  if (query.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ results: [] });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const searchUrl = new URL("https://nominatim.openstreetmap.org/search");
    searchUrl.searchParams.set("format", "jsonv2");
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("limit", String(MAX_RESULTS));
    searchUrl.searchParams.set("addressdetails", "0");

    const response = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Famstagram/1.0 (Family photo sharing app)",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Location search is temporarily unavailable." }, { status: 502 });
    }

    const data: unknown = await response.json();
    const results = Array.isArray(data)
      ? data
          .slice(0, MAX_RESULTS)
          .map((item: NominatimResult) => {
            const displayName = typeof item.display_name === "string" ? item.display_name.trim() : "";
            const latitude = typeof item.lat === "string" ? Number(item.lat) : item.lat;
            const longitude = typeof item.lon === "string" ? Number(item.lon) : item.lon;

            if (
              !displayName ||
              typeof latitude !== "number" ||
              !Number.isFinite(latitude) ||
              typeof longitude !== "number" ||
              !Number.isFinite(longitude)
            ) {
              return null;
            }

            return { displayName, latitude, longitude };
          })
          .filter(
            (result): result is { displayName: string; latitude: number; longitude: number } => result !== null,
          )
      : [];

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "Location search is temporarily unavailable." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
