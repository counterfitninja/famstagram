import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { receiptSchema } from "@/lib/push-receipt";

function isPushDebugEnabled() {
  return process.env.PUSH_DEBUG?.trim().replace(/^["']|["']$/g, "").toLowerCase() === "true";
}

export async function POST(request: Request) {
  const parsed = receiptSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid push receipt." }, { status: 400 });

  if (parsed.data.action === "acknowledge") {
    const session = await getSession();
    if (!session.userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    if (!parsed.data.notificationId) return NextResponse.json({ error: "Notification identity is required." }, { status: 400 });

    const result = await db.notification.updateMany({
      where: { id: parsed.data.notificationId, userId: session.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return NextResponse.json({ ok: true, acknowledged: result.count > 0 });
  }

  if (isPushDebugEnabled()) {
    const userAgent = request.headers.get("user-agent")?.slice(0, 160) ?? null;
    console.log("[push] client received remote push", {
      notificationId: parsed.data.notificationId ?? null,
      tag: parsed.data.tag ?? null,
      serviceWorkerVersion: parsed.data.serviceWorkerVersion ?? null,
      userAgent,
    });
  }

  return NextResponse.json({ ok: true });
}