import { z } from "zod";
import { captionSchema, feedDescriptionSchema, feedNameSchema, latitudeSchema, locationNameSchema, longitudeSchema, registerSchema } from "./validation";

export const nativeLoginSchema = z.object({
  identifier: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(100),
});

export const nativeRegisterSchema = registerSchema.extend({
  token: z.string().min(1).max(200),
  confirmAccount: z.literal(true),
});

const id = z.string().min(1).max(200);
export const nativeCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("like"), postId: id }),
  z.object({ action: z.literal("comment"), postId: id, text: captionSchema.trim().min(1) }),
  z.object({ action: z.literal("share"), postId: id, userId: id, message: z.string().max(200) }),
  z.object({ action: z.literal("deletePost"), postId: id }),
  z.object({ action: z.literal("readNotifications") }),
  z.object({ action: z.literal("readShares") }),
  z.object({ action: z.literal("mute"), userId: id, muted: z.boolean() }),
  z.object({ action: z.literal("createFeed"), name: feedNameSchema, description: feedDescriptionSchema }),
  z.object({ action: z.literal("invite"), feedId: id }),
  z.object({ action: z.literal("addMember"), feedId: id, userId: id }),
  z.object({ action: z.literal("removeMember"), feedId: id, userId: id }),
  z.object({ action: z.literal("memberRole"), feedId: id, userId: id, role: z.enum(["manager", "member"]) }),
  z.object({ action: z.literal("location"), postId: id, latitude: latitudeSchema.nullable(), longitude: longitudeSchema.nullable(), locationName: locationNameSchema }),
  z.object({ action: z.literal("adminDeletePost"), postId: id }),
  z.object({ action: z.literal("adminDeleteUser"), userId: id }),
  z.object({ action: z.literal("adminPassword"), userId: id, password: registerSchema.shape.password }),
  z.object({ action: z.literal("adminRole"), userId: id, role: z.enum(["admin", "member"]) }),
  z.object({ action: z.literal("deleteInvite"), inviteId: id }),
]);
export type NativeCommand = z.infer<typeof nativeCommandSchema>;

/** Explicit native scopes never widen to other feeds, even for global admins. */
export function nativeFeedScope(requested: string | null, memberships: { feedId: string }[]) {
  const allowed = memberships.map((membership) => membership.feedId);
  if (!requested || requested === "all") return allowed;
  return allowed.includes(requested) ? [requested] : null;
}

export function nativePage(value: string | null) {
  return z.coerce.number().int().min(1).max(10000).default(1).safeParse(value ?? undefined);
}
