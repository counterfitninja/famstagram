import { z } from "zod";

export const fcmRegistrationSchema = z.object({
  provider: z.literal("fcm"),
  token: z.string().min(20).max(4096).regex(/^[A-Za-z0-9_:-]+$/),
  enabled: z.boolean(),
});

export function fcmMessage(token: string, postId: string, feedId: string, content: { title: string; body: string; image?: string }) {
  return {
    message: {
      token,
      notification: {
        title: Array.from(content.title).slice(0, 80).join(""),
        body: Array.from(content.body).slice(0, 300).join(""),
        ...(content.image ? { image: content.image } : {}),
      },
      // expo-notifications decodes the JSON body into notification.content.data.
      data: { body: JSON.stringify({ postId, feedId }) },
      android: { priority: "HIGH", ttl: "60s", notification: { channel_id: "family-updates", sound: "default" } },
    },
  };
}

export function isUnregisteredFcmToken(body: unknown) {
  const parsed = z.object({
    error: z.object({ details: z.array(z.object({
      "@type": z.string(), errorCode: z.string().optional(),
    }).passthrough()).optional() }),
  }).safeParse(body);
  return parsed.success && parsed.data.error.details?.some((detail) =>
    detail["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError" && detail.errorCode === "UNREGISTERED"
  ) === true;
}
