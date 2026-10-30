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
