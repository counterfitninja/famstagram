import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getPushPublicKey, getPushPublicKeyFingerprint, isPushConfigured } from "@/lib/push";
import { getSession } from "@/lib/session";
import { isValidPushEndpoint, subscriptionSchema } from "@/lib/push-subscription";

function expirationDate(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function getUserId() {
  const session = await getSession();
  return session.userId;
}

export async function GET(request: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const endpoint = new URL(request.url).searchParams.get("endpoint");
  const currentEndpoint = endpoint && isValidPushEndpoint(endpoint) ? endpoint : null;
  const [subscriptionCount, currentSubscription] = await Promise.all([
    db.pushSubscription.count({ where: { userId } }),
    currentEndpoint
      ? db.pushSubscription.findUnique({ where: { endpoint: currentEndpoint }, select: { userId: true } })
      : Promise.resolve(null),
  ]);
  const currentSubscribed = Boolean(currentEndpoint && currentSubscription?.userId === userId);
  return NextResponse.json({
    configured: isPushConfigured(),
    publicKey: getPushPublicKey() ?? null,
    publicKeyFingerprint: getPushPublicKeyFingerprint(),
    subscribed: currentEndpoint ? currentSubscribed : subscriptionCount > 0,
    currentSubscribed,
    currentEndpoint: currentEndpoint ? currentEndpoint : null,
    subscriptionCount,
  });
}

export async function POST(request: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isPushConfigured()) {
    return NextResponse.json({ error: "Push notifications are not configured." }, { status: 503 });
  }

  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid push subscription." }, { status: 400 });

  const subscription = parsed.data;
  if (!isValidPushEndpoint(subscription.endpoint)) {
    return NextResponse.json({ error: "Push endpoint must use HTTPS." }, { status: 400 });
  }
  const existing = await db.pushSubscription.findUnique({
    where: { endpoint: subscription.endpoint },
    select: { userId: true },
  });
  if (existing && existing.userId !== userId) {
    return NextResponse.json({ error: "Push endpoint belongs to another account." }, { status: 409 });
  }

  const userAgent = request.headers.get("user-agent")?.slice(0, 512) ?? null;
  await db.pushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    create: {
      userId,
      endpoint: subscription.endpoint,
      userAgent,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      expirationTime: expirationDate(subscription.expirationTime),
    },
    update: {
      userAgent,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      expirationTime: expirationDate(subscription.expirationTime),
    },
  });

  return NextResponse.json({ ok: true, subscribed: true, endpoint: subscription.endpoint });
}

export async function DELETE(request: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const endpoint = z.string().url().max(2048).safeParse(body?.endpoint);
  if (!endpoint.success) return NextResponse.json({ error: "Invalid push subscription." }, { status: 400 });

  await db.pushSubscription.deleteMany({ where: { userId, endpoint: endpoint.data } });
  return NextResponse.json({ ok: true });
}
