import webpush from "web-push";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";

// Some hosting UIs store env values with surrounding quotes/whitespace; strip those defensively.
function cleanEnv(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^["']|["']$/g, "");
}

const publicKey = cleanEnv(process.env.VAPID_PUBLIC_KEY);
const privateKey = cleanEnv(process.env.VAPID_PRIVATE_KEY);
const configuredSubject = cleanEnv(process.env.VAPID_SUBJECT);
const subject = configuredSubject
  ? configuredSubject.includes(":")
    ? configuredSubject
    : `mailto:${configuredSubject}`
  : "mailto:admin@famstagram.app";

// A malformed public key decodes to something other than 65 bytes; validate up front instead of throwing mid-request.
function isValidVapidPublicKey(key: string) {
  try {
    const decoded = Buffer.from(key.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    return decoded.length === 65;
  } catch {
    return false;
  }
}

const vapidConfigured = Boolean(publicKey && privateKey && isValidVapidPublicKey(publicKey));
if (publicKey && privateKey && !vapidConfigured) {
  console.error("VAPID_PUBLIC_KEY is invalid (must decode to 65 bytes); push notifications are disabled.");
}

function shouldDeleteRejectedSubscription(statusCode: number | undefined) {
  return statusCode === 401 || statusCode === 403 || statusCode === 404 || statusCode === 410;
}

function isPushDebugEnabled() {
  return cleanEnv(process.env.PUSH_DEBUG)?.toLowerCase() === "true";
}

function pushDebug(message: string, details?: Record<string, unknown>) {
  if (!isPushDebugEnabled()) return;
  console.log(`[push] ${message}`, details ?? "");
}

export type PushNotificationType = "comment" | "mention" | "post";

export interface PushRecipient {
  id: string;
  type: PushNotificationType;
  notificationId?: string;
}

export interface PushNotificationPayload {
  notificationId: string | null;
  title: string;
  body: string;
  url: string;
  tag: string;
  icon: string;
  badge: string;
  feedId?: string;
  data: {
    notificationId: string | null;
    url: string;
    feedId?: string;
    commentId?: string;
  };
}

const ICON_PATH = "/icons/icon-192.png";
const MAX_TITLE_LENGTH = 80;
const MAX_BODY_LENGTH = 180;

export function normalizePushText(value: string | null | undefined) {
  return (value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

function truncatePushText(value: string, maxLength: number) {
  const normalized = normalizePushText(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function safeActorName(actorUsername: string) {
  return truncatePushText(actorUsername, 40) || "Someone";
}

export function getPushNotificationContent(type: PushNotificationType, actorUsername: string, caption: string) {
  const actor = safeActorName(actorUsername);
  const title =
    type === "mention"
      ? `${actor} tagged you`
      : type === "comment"
        ? `${actor} commented on your post`
        : `New post from ${actor}`;
  const fallback =
    type === "mention"
      ? "You were tagged in a post."
      : type === "comment"
        ? "Added a comment to your post."
        : "Shared a new photo or video.";
  return {
    title: truncatePushText(title, MAX_TITLE_LENGTH),
    body: truncatePushText(caption || fallback, MAX_BODY_LENGTH),
  };
}

export function getPushNotificationTag(notificationId: string | null | undefined, postId: string) {
  const identity = normalizePushText(notificationId) || normalizePushText(postId) || "unknown";
  return `notification-${identity}`.slice(0, 120);
}

export function buildPushNotificationPayload({
  notificationId,
  type,
  actorUsername,
  caption,
  postId,
  feedId,
  commentId,
}: {
  notificationId?: string | null;
  type: PushNotificationType;
  actorUsername: string;
  caption: string;
  postId: string;
  feedId?: string;
  commentId?: string;
}): PushNotificationPayload {
  const content = getPushNotificationContent(type, actorUsername, caption);
  const safePostId = encodeURIComponent(postId);
  const id = notificationId || null;
  const url = `/post/${safePostId}`;
  return {
    notificationId: id,
    ...content,
    url,
    tag: getPushNotificationTag(id, postId),
    icon: ICON_PATH,
    badge: ICON_PATH,
    ...(feedId ? { feedId } : {}),
    data: { notificationId: id, url, ...(feedId ? { feedId } : {}), ...(commentId ? { commentId } : {}) },
  };
}

export function normalizePushPayload(input: unknown): PushNotificationPayload {
  const raw = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const rawData = raw.data && typeof raw.data === "object" ? raw.data as Record<string, unknown> : {};
  const notificationId = typeof raw.notificationId === "string"
    ? raw.notificationId
    : typeof rawData.notificationId === "string" ? rawData.notificationId : null;
  const rawUrl = typeof raw.url === "string" ? raw.url : typeof rawData.url === "string" ? rawData.url : "";
  const url = rawUrl.startsWith("/") && !rawUrl.startsWith("//") ? rawUrl.slice(0, 512) : "/notifications";
  const title = truncatePushText(typeof raw.title === "string" ? raw.title : "Famstagram", MAX_TITLE_LENGTH) || "Famstagram";
  const body = truncatePushText(typeof raw.body === "string" ? raw.body : "You have a new notification.", MAX_BODY_LENGTH) || "You have a new notification.";
  const tag = typeof raw.tag === "string" && raw.tag.trim() ? raw.tag.trim().slice(0, 120) : getPushNotificationTag(notificationId, "notification");
  const feedId = typeof raw.feedId === "string" ? raw.feedId : typeof rawData.feedId === "string" ? rawData.feedId : undefined;
  const commentId = typeof raw.commentId === "string" ? raw.commentId : typeof rawData.commentId === "string" ? rawData.commentId : undefined;
  return {
    notificationId,
    title,
    body,
    url,
    tag,
    icon: ICON_PATH,
    badge: ICON_PATH,
    ...(feedId ? { feedId } : {}),
    data: { notificationId, url, ...(feedId ? { feedId } : {}), ...(commentId ? { commentId } : {}) },
  };
}

function endpointSummary(endpoint: string) {
  return { provider: new URL(endpoint).hostname };
}

export function isPushConfigured() {
  return vapidConfigured;
}

export function getPushPublicKey() {
  return publicKey;
}

export function getPushPublicKeyFingerprint() {
  if (!publicKey) return null;
  return createHash("sha256").update(publicKey).digest("hex").slice(0, 16);
}

export async function sendPushNotifications({
  recipients,
  actorUsername,
  caption,
  postId,
  feedId,
  commentId,
}: {
  recipients: PushRecipient[];
  actorUsername: string;
  caption: string;
  postId: string;
  feedId: string;
  commentId?: string;
}) {
  if (!isPushConfigured() || recipients.length === 0 || !publicKey || !privateKey) {
    pushDebug("skipped send", {
      configured: isPushConfigured(),
      recipientCount: recipients.length,
      hasPublicKey: Boolean(publicKey),
      hasPrivateKey: Boolean(privateKey),
    });
    return;
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  } catch (error) {
    console.error("Failed to configure VAPID details; skipping push notifications", error instanceof Error ? error.message : "unknown error");
    return;
  }
  const subscriptions = await db.pushSubscription.findMany({
    where: { userId: { in: recipients.map((recipient) => recipient.id) } },
  });
  const recipientByUserId = new Map(recipients.map((recipient) => [recipient.id, recipient]));
  pushDebug("sending notifications", {
    recipientCount: recipients.length,
    subscriptionCount: subscriptions.length,
    vapidSubject: subject,
    publicKeyFingerprint: getPushPublicKeyFingerprint(),
  });

  await Promise.allSettled(
    subscriptions.map(async (subscription) => {
      const recipient = recipientByUserId.get(subscription.userId);
      if (!recipient) return;
      const payload = buildPushNotificationPayload({
        notificationId: recipient.notificationId,
        type: recipient.type,
        actorUsername,
        caption,
        postId,
        feedId,
        commentId,
      });

      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            expirationTime: subscription.expirationTime?.getTime() ?? null,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(payload),
          { TTL: 60, urgency: "high", topic: payload.tag.replace(/^notification-/, "").slice(0, 32) },
        );
        pushDebug("sent notification", {
          userId: subscription.userId,
          type: recipient.type,
          notificationId: recipient.notificationId ?? null,
          ...endpointSummary(subscription.endpoint),
        });
      } catch (error) {
        const statusCode = error instanceof webpush.WebPushError ? error.statusCode : undefined;
        if (shouldDeleteRejectedSubscription(statusCode)) {
          await db.pushSubscription.delete({ where: { endpoint: subscription.endpoint } }).catch(() => {});
          pushDebug("removed rejected subscription", {
            userId: subscription.userId,
            statusCode,
            ...endpointSummary(subscription.endpoint),
          });
        } else {
          console.error("Failed to send push notification", { statusCode });
          pushDebug("failed notification", {
            userId: subscription.userId,
            statusCode,
            message: error instanceof Error ? error.message : String(error),
            ...endpointSummary(subscription.endpoint),
          });
        }
      }
    }),
  );
}

export async function sendTestPushNotification(targetUserId?: string): Promise<{
  success: boolean;
  sentCount: number;
  failedCount: number;
  message: string;
}> {
  if (!isPushConfigured() || !publicKey || !privateKey) {
    pushDebug("skipped test send", {
      configured: isPushConfigured(),
      hasPublicKey: Boolean(publicKey),
      hasPrivateKey: Boolean(privateKey),
    });
    return {
      success: false,
      sentCount: 0,
      failedCount: 0,
      message: "Push notifications are not configured on server (VAPID keys missing or invalid).",
    };
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  } catch (error) {
    return {
      success: false,
      sentCount: 0,
      failedCount: 0,
      message: `Failed to configure VAPID: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const subscriptions = await db.pushSubscription.findMany({
    where: targetUserId ? { userId: targetUserId } : undefined,
    include: { user: { select: { username: true } } },
  });
  pushDebug("sending test notifications", {
    targetUserId: targetUserId ?? null,
    subscriptionCount: subscriptions.length,
    vapidSubject: subject,
    publicKeyFingerprint: getPushPublicKeyFingerprint(),
  });

  if (subscriptions.length === 0) {
    return {
      success: false,
      sentCount: 0,
      failedCount: 0,
      message: targetUserId
        ? "No active push subscriptions found for target user."
        : "No active push subscriptions found in database.",
    };
  }

  let sentCount = 0;
  let failedCount = 0;
  let invalidSubscriptionCount = 0;
  const failureDetails: string[] = [];

  await Promise.allSettled(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            expirationTime: subscription.expirationTime?.getTime() ?? null,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify({
            notificationId: `test-${subscription.id}`,
            title: "🔔 Famstagram Test",
            body: `Test notification sent at ${new Date().toLocaleTimeString()} for @${subscription.user.username}!`,
            url: "/notifications",
            tag: `test-push-${subscription.id}`,
            icon: ICON_PATH,
            badge: ICON_PATH,
            data: { notificationId: `test-${subscription.id}`, url: "/notifications" },
          }),
          { TTL: 60, urgency: "high" },
        );
        sentCount++;
        pushDebug("sent test notification", {
          user: subscription.user.username,
          ...endpointSummary(subscription.endpoint),
        });
      } catch (error) {
        failedCount++;
        const statusCode = error instanceof webpush.WebPushError ? error.statusCode : undefined;
        if (shouldDeleteRejectedSubscription(statusCode)) {
          invalidSubscriptionCount++;
          await db.pushSubscription.delete({ where: { endpoint: subscription.endpoint } }).catch(() => {});
          pushDebug("removed rejected test subscription", {
            user: subscription.user.username,
            statusCode,
            ...endpointSummary(subscription.endpoint),
          });
        } else if (failureDetails.length < 3) {
          const provider = new URL(subscription.endpoint).hostname;
          const reason = error instanceof Error ? error.message : String(error);
          failureDetails.push(`@${subscription.user.username} via ${provider}: ${statusCode ?? "unknown status"} ${reason}`);
          pushDebug("failed test notification", {
            user: subscription.user.username,
            statusCode,
            message: reason,
            ...endpointSummary(subscription.endpoint),
          });
        }
      }
    }),
  );

  const parts = [`Sent test push notification to ${sentCount} device(s).`];
  if (invalidSubscriptionCount > 0) {
    parts.push(`Removed ${invalidSubscriptionCount} invalid subscription(s); re-enable push on those devices.`);
  }
  const otherFailures = failedCount - invalidSubscriptionCount;
  if (otherFailures > 0) parts.push(`${otherFailures} delivery failure(s): ${failureDetails.join(" | ")}`);

  return {
    success: sentCount > 0,
    sentCount,
    failedCount,
    message: parts.join(" "),
  };
}
