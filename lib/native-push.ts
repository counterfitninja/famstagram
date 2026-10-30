import { GoogleAuth } from "google-auth-library";
import { db } from "./db";
import { fcmMessage, isUnregisteredFcmToken } from "./fcm-contract";

const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/firebase.messaging"] });

export async function sendNativePush(recipients: { id: string }[], postId: string, feedId: string) {
  if (!recipients.length) return;
  const tokens = await db.nativePushToken.findMany({
    where: { provider: "fcm", userId: { in: recipients.map((r) => r.id) }, user: { feedMemberships: { some: { feedId } } } },
  });
  if (!tokens.length) return;
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  if (!projectId || !/^[a-z0-9-]+$/.test(projectId)) {
    console.error("Native push is not configured: set FIREBASE_PROJECT_ID and Google application credentials on the server.");
    return;
  }
  try {
    const accessToken = await auth.getAccessToken();
    if (!accessToken) throw new Error("Google did not return an FCM access token.");
    // Bound concurrency and timeouts; do not log credentials or device tokens.
    for (let offset = 0; offset < tokens.length; offset += 10) {
      await Promise.all(tokens.slice(offset, offset + 10).map(async (entry) => {
        try {
          const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
            body: JSON.stringify(fcmMessage(entry.token, postId, feedId)),
            signal: AbortSignal.timeout(10_000),
          });
          if (!response.ok) {
            const body: unknown = await response.json();
            if (isUnregisteredFcmToken(body)) {
              await db.nativePushToken.deleteMany({ where: { token: entry.token, userId: entry.userId, provider: "fcm" } });
            } else {
              console.error("FCM push rejected", { status: response.status });
            }
          }
        } catch {
          console.error("FCM push request failed; check server credentials and connectivity.");
        }
      }));
    }
  } catch {
    console.error("FCM authorization failed; check server application credentials and Firebase messaging permissions.");
  }
}
