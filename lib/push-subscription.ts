import { z } from "zod";

export const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  expirationTime: z.number().finite().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1).max(255),
    auth: z.string().min(1).max(255),
  }),
});

export function isValidPushEndpoint(endpoint: string) {
  try {
    const parsed = new URL(endpoint);
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}
