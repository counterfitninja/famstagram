import { z } from "zod";

export const receiptSchema = z.object({
  action: z.enum(["receipt", "acknowledge"]).default("receipt"),
  serviceWorkerVersion: z.string().max(80).optional(),
  receivedAt: z.string().max(64),
  notificationId: z.string().max(128).nullable().optional(),
  title: z.string().max(120).optional(),
  body: z.string().max(240).optional(),
  tag: z.string().max(120).nullable().optional(),
  url: z.string().max(512).optional(),
});
