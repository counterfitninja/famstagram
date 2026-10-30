import { z } from "zod";
import { db } from "./db";

const ticketSchema = z.object({
  status: z.enum(["ok", "error"]),
  details: z.object({ error: z.string().optional() }).optional(),
});
export async function sendNativePush(recipients: { id: string }[], postId: string, feedId: string) {
  if (!recipients.length) return;
  const tokens = await db.nativePushToken.findMany({
    where: { userId: { in: recipients.map((r) => r.id) }, user: { feedMemberships: { some: { feedId } } } },
  });
  for (let offset = 0; offset < tokens.length; offset += 100) {
    const batch = tokens.slice(offset, offset + 100);
    try {
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(batch.map((entry) => ({
          to: entry.token, title: "Famstagram", body: "There's a new update in your private family feed.",
          data: { postId, feedId }, sound: "default", channelId: "family-updates",
        }))),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Expo push service returned ${response.status}`);
      const result = z.object({ data: z.array(ticketSchema) }).parse(await response.json());
      if (result.data.length !== batch.length) throw new Error("Expo push ticket count did not match.");
      for (let index = 0; index < result.data.length; index++) {
        const ticket = result.data[index];
        if (ticket.status === "error") {
          if (ticket.details?.error === "DeviceNotRegistered") await db.nativePushToken.deleteMany({ where: { token: batch[index].token } });
          else console.error("Native push rejected", { reason: ticket.details?.error ?? "unknown" });
        }
      }
    } catch (error) {
      console.error("Native push delivery failed", error instanceof Error ? error.message : "Unknown push error");
    }
  }
}
