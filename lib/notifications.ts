import { db } from "@/lib/db";
import { sendPushNotifications, type PushRecipient } from "@/lib/push";
import { getCommentNotificationRecipients } from "@/lib/notification-policy";

export function getNotificationDeliveryRecipients(recipients: PushRecipient[]) {
  return recipients.filter((recipient) => Boolean(recipient.id && recipient.notificationId));
}

export function canAcknowledgeNotification(notification: { userId: string } | null, userId: string) {
  return Boolean(notification && notification.userId === userId);
}

type NotificationCreateData = {
  userId: string;
  actorId: string;
  postId: string;
  commentId?: string;
  type: string;
  feedId: string;
  deliveryKey: string;
};

type NotificationLookup = {
  userId: string;
  postId: string;
  commentId: string | null;
  type: string;
};

async function createNotificationOnce(data: NotificationCreateData, legacyLookup: NotificationLookup) {
  const existing = await db.notification.findFirst({ where: legacyLookup, select: { id: true } });
  if (existing) return { id: existing.id, created: false };

  const keyedExisting = await db.notification.findUnique({
    where: { deliveryKey: data.deliveryKey },
    select: { id: true },
  });
  if (keyedExisting) return { id: keyedExisting.id, created: false };

  try {
    const notification = await db.notification.create({ data, select: { id: true } });
    return { id: notification.id, created: true };
  } catch (error) {
    // A concurrent retry may win the unique delivery key between the reads above.
    const racedNotification = await db.notification.findUnique({
      where: { deliveryKey: data.deliveryKey },
      select: { id: true },
    });
    if (racedNotification) return { id: racedNotification.id, created: false };
    throw error;
  }
}

async function sendPushSafely(input: Parameters<typeof sendPushNotifications>[0]) {
  try {
    await sendPushNotifications(input);
  } catch (error) {
    console.error("Push delivery failed after in-app notification creation", {
      message: error instanceof Error ? error.message : "unknown error",
    });
  }
}

const MENTION_RE = /(^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]{3,20})\b/g;

export function extractMentionedUsernames(text: string): string[] {
  const usernames = new Set<string>();
  for (const match of text.matchAll(MENTION_RE)) {
    usernames.add(match[2].toLowerCase());
  }
  return [...usernames];
}

export async function createPostNotifications({
  postId,
  authorId,
  caption,
  feedId,
}: {
  postId: string;
  authorId: string;
  caption: string;
  feedId: string;
}) {
  const mentionedUsernames = new Set(extractMentionedUsernames(caption));
  // Only members of the post's feed are notified (FR-014).
  const memberships = await db.feedMembership.findMany({
    where: { feedId, userId: { not: authorId } },
    select: { user: { select: { id: true, username: true } } },
  });
  const recipients = memberships.map((m) => m.user);

  if (recipients.length === 0) return;

  const mutes = await db.notificationMute.findMany({
    where: { mutedUserId: authorId, userId: { in: recipients.map((recipient) => recipient.id) } },
    select: { userId: true },
  });
  const mutedRecipientIds = new Set(mutes.map((mute) => mute.userId));

  const recipientsWithType = recipients
    .map((recipient) => ({
      id: recipient.id,
      type: mentionedUsernames.has(recipient.username.toLowerCase()) ? ("mention" as const) : ("post" as const),
    }))
    // A muted author's regular posts are skipped, but mentions still notify.
    .filter((recipient) => recipient.type === "mention" || !mutedRecipientIds.has(recipient.id));

  if (recipientsWithType.length === 0) return;

  const notifications = await Promise.all(
    recipientsWithType.map((recipient) =>
      createNotificationOnce(
        {
          userId: recipient.id,
          actorId: authorId,
          postId,
          type: recipient.type,
          feedId,
          deliveryKey: `post:${postId}:${recipient.id}:${recipient.type}`,
        },
        { userId: recipient.id, postId, commentId: null, type: recipient.type },
      ),
    ),
  );

  const author = await db.user.findUnique({ where: { id: authorId }, select: { username: true } });
  if (author) {
    await sendPushSafely({
      recipients: getNotificationDeliveryRecipients(
        recipientsWithType
          .map((recipient, index) => ({ ...recipient, notificationId: notifications[index].id }))
          .filter((_, index) => notifications[index].created),
      ),
      actorUsername: author.username,
      caption,
      postId,
      feedId,
    });
  }
}

export async function createCommentNotifications({
  postId,
  authorId,
  text,
  commentId,
}: {
  postId: string;
  authorId: string;
  text: string;
  commentId: string;
}) {
  const mentionedUsernames = new Set(extractMentionedUsernames(text));
  const post = await db.post.findUnique({ where: { id: postId }, select: { feedId: true, authorId: true } });
  if (!post) return;

  // Only members of the post's feed can be notified (FR-014).
  const memberships = await db.feedMembership.findMany({
    where: { feedId: post.feedId, userId: { not: authorId } },
    select: { user: { select: { id: true, username: true } } },
  });
  const users = memberships.map((m) => m.user);
  const recipients = getCommentNotificationRecipients({
    authorId,
    ownerId: post.authorId,
    mentionedUsernames,
    users,
  });

  if (recipients.length === 0) return;

  const notifications = await Promise.all(
    recipients.map((recipient) =>
      createNotificationOnce(
        {
          userId: recipient.id,
          actorId: authorId,
          postId,
          commentId,
          type: recipient.type,
          feedId: post.feedId,
          deliveryKey: `comment:${commentId}:${recipient.id}:${recipient.type}`,
        },
        { userId: recipient.id, postId, commentId, type: recipient.type },
      ),
    ),
  );

  const author = await db.user.findUnique({ where: { id: authorId }, select: { username: true } });
  if (author) {
    await sendPushSafely({
      recipients: getNotificationDeliveryRecipients(
        recipients
          .map((recipient, index) => ({ ...recipient, notificationId: notifications[index].id }))
          .filter((_, index) => notifications[index].created),
      ),
      actorUsername: author.username,
      caption: text,
      postId,
      feedId: post.feedId,
      commentId,
    });
  }
}