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

function endpointSummary(endpoint: string) {
  const url = new URL(endpoint);
  return { provider: url.hostname, endpointTail: endpoint.slice(-18) };
}

export function getPushNotificationContent(
  type: "comment" | "mention" | "post",
  actorUsername: string,
  caption: string,
) {
  const title =
    type === "mention"
      ? `${actorUsername} tagged you`
      : type === "comment"
        ? `${actorUsername} commented on your post`
        : `New post from ${actorUsername}`;
  const body =
    caption ||
    (type === "mention"
      ? "You were tagged in a post."
      : type === "comment"
        ? "Added a comment to your post."
        : "Shared a new photo or video.");
  return { title, body };
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
}: {
  recipients: { id: string; type: "comment" | "mention" | "post" }[];
  actorUsername: string;
  caption: string;
  postId: string;
  feedId: string;
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
    console.error("Failed to configure VAPID details; skipping push notifications", error);
    return;
  }
  const subscriptions = await db.pushSubscription.findMany({
    where: { userId: { in: recipients.map((recipient) => recipient.id) } },
  });
  const notificationTypeByUserId = new Map(recipients.map((recipient) => [recipient.id, recipient.type]));
  pushDebug("sending notifications", {
    recipientCount: recipients.length,
    subscriptionCount: subscriptions.length,
    vapidSubject: subject,
    publicKeyFingerprint: getPushPublicKeyFingerprint(),
  });

  await Promise.allSettled(
    subscriptions.map(async (subscription) => {
      const type = notificationTypeByUserId.get(subscription.userId) ?? "post";
      const { title, body } = getPushNotificationContent(type, actorUsername, caption);

      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            expirationTime: subscription.expirationTime?.getTime() ?? null,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify({
            title,
            body,
            url: `/post/${encodeURIComponent(postId)}`,
            tag: `post-${postId}`,
            feedId,
          }),
          { TTL: 60, urgency: "high" },
        );
        pushDebug("sent notification", {
          userId: subscription.userId,
          type,
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
          console.error("Failed to send push notification", error);
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
            title: "🔔 Famstagram Test",
            body: `Test notification sent at ${new Date().toLocaleTimeString()} for @${subscription.user.username}!`,
            url: "/notifications",
            tag: `test-push-${Date.now()}`,
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
