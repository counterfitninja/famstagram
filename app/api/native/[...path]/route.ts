import bcrypt from "bcryptjs";
import { sealData } from "iron-session";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fcmRegistrationSchema } from "@/lib/fcm-contract";
import { canManageFeed } from "@/lib/feed-context";
import { nativeCommandSchema, nativeFeedScope, nativeLoginSchema, nativePage, nativeRegisterSchema } from "@/lib/native-contract";
import { sessionOptions } from "@/lib/session";
import { postInclude, type PostWithRelations } from "@/lib/types";
import { addComment } from "@/app/actions/comments";
import { toggleLike } from "@/app/actions/likes";
import { deletePost, updatePostLocation } from "@/app/actions/posts";
import { markAllSharesRead, sharePost } from "@/app/actions/shares";
import { markAllNotificationsRead, setUserNotificationMute } from "@/app/actions/notifications";
import { addMember, createFeed, createFeedInvite, removeMember, setMemberRole } from "@/app/actions/feeds";
import { deletePostAsAdmin, deleteUserAsAdmin, resetUserPasswordAsAdmin, setUserAdminRoleAsAdmin } from "@/app/actions/admin";
import { deleteInvite } from "@/app/actions/invites";
import { updateProfilePhoto } from "@/app/actions/profile";
import { consumeNativeGrant } from "@/lib/native-login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
const publicUser = { id: true, username: true, avatarKey: true } as const;
class NativeRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

function serializePost(post: PostWithRelations, userId: string) {
  return {
    id: post.id, caption: post.caption, createdAt: post.createdAt,
    author: post.author, feed: post.feed, latitude: post.latitude,
    longitude: post.longitude, locationName: post.locationName,
    media: post.media.map(({ key, mimeType }) => ({ key, mimeType })),
    liked: post.likes.some((like) => like.userId === userId),
    likeCount: post._count.likes, comments: post.comments,
  };
}

// Native requests use a manually managed HttpOnly-session equivalent in the OS
// secure store. The custom header also prevents cross-site browser form CSRF.
function isNativeRequest(request: Request) {
  return request.headers.get("x-famstagram-native") === "1";
}

async function credentials(user: { id: string; username: string; role: string }) {
  const token = await sealData(
    { userId: user.id, username: user.username, role: user.role },
    { password: sessionOptions.password, ttl: 14 * 24 * 60 * 60 },
  );
  return { token, cookieName: sessionOptions.cookieName };
}

export async function GET(request: Request, context: Context) {
  if (!isNativeRequest(request)) return json({ error: "Native client header required." }, 400);
  const user = await getCurrentUser();
  if (!user) return json({ error: "Sign in to continue." }, 401);
  const { path } = await context.params;
  const resource = path.join("/");
  const url = new URL(request.url);
  const memberships = await db.feedMembership.findMany({
    where: { userId: user.id }, include: { feed: true }, orderBy: { feed: { name: "asc" } },
  });
  const feedIds = nativeFeedScope(url.searchParams.get("feedId"), memberships);
  if (!feedIds) return json({ error: "Feed not found." }, 404);
  const page = nativePage(url.searchParams.get("page"));
  if (!page.success) return json({ error: "Invalid page." }, 400);
  const skip = (page.data - 1) * 10;

  if (resource === "me") {
    const [notifications, shares] = await Promise.all([
      db.notification.groupBy({ by: ["feedId"], where: { userId: user.id, feedId: { in: feedIds }, readAt: null }, _count: true }),
      db.sharedPost.count({ where: { toUserId: user.id, readAt: null, post: { feedId: { in: feedIds } } } }),
    ]);
    return json({
      user: { id: user.id, username: user.username, role: user.role, avatarKey: user.avatarKey },
      feeds: memberships.map((m) => ({
        id: m.feedId, name: m.feed.name, description: m.feed.description, role: m.role,
        unread: notifications.find((n) => n.feedId === m.feedId)?._count ?? 0,
      })),
      unreadNotifications: notifications.reduce((sum, n) => sum + n._count, 0), unreadShares: shares,
    });
  }
  if (resource === "posts" || resource === "map" || path[0] === "profile") {
    const username = path[0] === "profile" ? path[1] : undefined;
    const where: Prisma.PostWhereInput = {
      feedId: { in: feedIds },
      ...(username ? { author: { username } } : {}),
      ...(resource === "map" ? { latitude: { not: null }, longitude: { not: null } } : {}),
    };
    const posts = await db.post.findMany({
      where, include: postInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip, take: 11,
    });
    const profile = username ? await db.user.findFirst({
      where: { username, OR: [{ id: user.id }, { feedMemberships: { some: { feedId: { in: feedIds } } } }] },
      select: publicUser,
    }) : null;
    if (username && !profile) return json({ error: "Member not found." }, 404);
    return json({ posts: posts.slice(0, 10).map((p) => serializePost(p, user.id)), hasMore: posts.length > 10, profile });
  }
  if (path[0] === "post" && path.length === 2) {
    const post = await db.post.findFirst({
      where: { id: path[1], feedId: { in: feedIds } }, include: postInclude,
    });
    if (!post) return json({ error: "Post not found." }, 404);
    const members = await db.user.findMany({
      where: { id: { not: user.id }, feedMemberships: { some: { feedId: post.feedId } } },
      select: publicUser, orderBy: { username: "asc" },
    });
    return json({ post: serializePost(post, user.id), members });
  }
  if (resource === "users" || resource === "settings") {
    const users = await db.user.findMany({
      where: { feedMemberships: { some: { feedId: { in: feedIds } } }, username: { contains: (url.searchParams.get("q") ?? "").slice(0, 200) } },
      select: publicUser, orderBy: { username: "asc" }, take: 100,
    });
    const mutes = resource === "settings" ? await db.notificationMute.findMany({
      where: { userId: user.id }, select: { mutedUserId: true },
    }) : [];
    return json({ users, mutedUserIds: mutes.map((m) => m.mutedUserId) });
  }
  if (resource === "notifications") {
    const items = await db.notification.findMany({
      where: { userId: user.id, feedId: { in: feedIds } },
      include: { actor: { select: publicUser }, feed: { select: { name: true } }, comment: { select: { text: true } }, post: { select: { caption: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21, skip: (page.data - 1) * 20,
    });
    return json({ items: items.slice(0, 20), hasMore: items.length > 20 });
  }
  if (resource === "shares") {
    const items = await db.sharedPost.findMany({
      where: { toUserId: user.id, post: { feedId: { in: feedIds } } },
      include: { fromUser: { select: publicUser }, post: { include: postInclude } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 11, skip,
    });
    return json({ items: items.slice(0, 10).map((item) => ({ ...item, post: serializePost(item.post, user.id) })), hasMore: items.length > 10 });
  }
  if (resource === "feeds") {
    const feeds = await db.feed.findMany({
      where: user.role === "admin" ? {} : { memberships: { some: { userId: user.id } } },
      include: { _count: { select: { memberships: true } } }, orderBy: { name: "asc" },
    });
    return json({ feeds: feeds.map((f) => ({
      ...f, canManage: canManageFeed(user, memberships.map((m) => ({ feedId: m.feedId, feedName: m.feed.name, role: m.role })), f.id),
    })) });
  }
  if (path[0] === "feed" && path.length === 2) {
    const manager = canManageFeed(user, memberships.map((m) => ({ feedId: m.feedId, feedName: m.feed.name, role: m.role })), path[1]);
    if (!manager) return json({ error: "You do not manage this feed." }, 403);
    const feed = await db.feed.findUnique({
      where: { id: path[1] },
      include: {
        memberships: { include: { user: { select: publicUser } }, orderBy: { user: { username: "asc" } } },
        invites: { where: { usedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, token: true, expiresAt: true } },
      },
    });
    if (!feed) return json({ error: "Feed not found." }, 404);
    // Same directory available to web feed managers when adding existing members.
    const users = await db.user.findMany({ select: publicUser, orderBy: { username: "asc" } });
    return json({ feed, users });
  }
  if (resource === "admin") {
    if (user.role !== "admin") return json({ error: "Admin access required." }, 403);
    const [users, posts] = await Promise.all([
      db.user.findMany({ select: { ...publicUser, role: true, createdAt: true }, orderBy: { username: "asc" } }),
      db.post.findMany({ include: postInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 11, skip }),
    ]);
    return json({ users, posts: posts.slice(0, 10).map((p) => serializePost(p, user.id)), hasMore: posts.length > 10 });
  }
  return json({ error: "Endpoint not found." }, 404);
}

export async function POST(request: Request, context: Context) {
  if (!isNativeRequest(request)) return json({ error: "Native client header required." }, 400);
  const { path } = await context.params;
  const resource = path.join("/");
  try {
    if (resource === "login") {
      const { identifier, password } = nativeLoginSchema.parse(await request.json());
      const user = await db.user.findFirst({
        where: { OR: [{ username: identifier }, { email: identifier.toLowerCase() }] },
      });
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) return json({ error: "Invalid credentials. Please try again." }, 401);
      return json(await credentials(user));
    }
    if (resource === "exchange") {
      const { code, verifier } = z.object({
        code: z.string().regex(/^[a-f0-9]{64}$/), verifier: z.string().regex(/^[a-f0-9]{64}$/),
      }).parse(await request.json());
      const user = await consumeNativeGrant(code, verifier);
      if (!user) return json({ error: "This app sign-in expired or was already used. Start again." }, 401);
      return json(await credentials(user));
    }
    if (resource === "register") {
      const input = nativeRegisterSchema.parse(await request.json());
      const passwordHash = await bcrypt.hash(input.password, 10);
      const user = await db.$transaction(async (tx) => {
        const invite = await tx.invite.findUnique({ where: { token: input.token } });
        if (!invite || invite.usedAt || invite.expiresAt <= new Date()) throw new NativeRequestError("This invite is invalid, already used, or expired.", 400);
        const claimed = await tx.invite.updateMany({
          where: { id: invite.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() },
        });
        if (claimed.count !== 1) throw new NativeRequestError("This invite has already been used.", 409);
        const created = await tx.user.create({
          data: { username: input.username, email: input.email.toLowerCase(), passwordHash, feedMemberships: { create: { feedId: invite.feedId } } },
        });
        await tx.invite.update({ where: { id: invite.id }, data: { usedById: created.id } });
        return created;
      });
      return json(await credentials(user));
    }
    const user = await getCurrentUser();
    if (!user) return json({ error: "Sign in to continue." }, 401);
    if (resource === "push") {
      const { token, enabled, provider } = fcmRegistrationSchema.parse(await request.json());
      if (enabled) {
        await db.nativePushToken.upsert({ where: { token }, create: { token, provider, userId: user.id }, update: { provider, userId: user.id } });
      } else {
        await db.nativePushToken.deleteMany({ where: { token, userId: user.id } });
      }
      return json({ ok: true });
    }
    if (resource === "avatar") {
      const result = await updateProfilePhoto(null, await request.formData());
      return result?.error ? json(result, 400) : json({ ok: true });
    }
    if (resource !== "command") return json({ error: "Endpoint not found." }, 404);
    const input = nativeCommandSchema.parse(await request.json());
    if ("postId" in input && !input.action.startsWith("admin")) {
      const post = await db.post.findFirst({
        where: { id: input.postId, feed: { memberships: { some: { userId: user.id } } } },
        select: { id: true },
      });
      if (!post) return json({ error: "Post not found." }, 404);
    }
    if (input.action === "location" && user.role !== "admin") return json({ error: "Admin access required." }, 403);
    let result: { error?: string; token?: string } | void | null;
    switch (input.action) {
      case "like": result = await toggleLike(input.postId); break;
      case "comment": {
        const form = new FormData(); form.set("text", input.text);
        result = await addComment(input.postId, null, form); break;
      }
      case "share": result = await sharePost(input.postId, input.userId, input.message); break;
      case "deletePost": result = await deletePost(input.postId); break;
      case "readNotifications": result = await markAllNotificationsRead(); break;
      case "readShares": result = await markAllSharesRead(); break;
      case "mute": {
        const sharedFeed = await db.feedMembership.findFirst({
          where: { userId: input.userId, feed: { memberships: { some: { userId: user.id } } } },
        });
        if (!sharedFeed) return json({ error: "Member not found." }, 404);
        result = await setUserNotificationMute(input.userId, input.muted); break;
      }
      case "createFeed": result = await createFeed(input); break;
      case "invite": result = await createFeedInvite(input.feedId); break;
      case "addMember": result = await addMember(input.feedId, input.userId); break;
      case "removeMember": result = await removeMember(input.feedId, input.userId); break;
      case "memberRole": result = await setMemberRole(input.feedId, input.userId, input.role); break;
      case "location": result = await updatePostLocation(input.postId, input.latitude, input.longitude, input.locationName); break;
      // Guard before calling redirecting admin actions, so the API always returns JSON.
      default: {
        if (user.role !== "admin") return json({ error: "Admin access required." }, 403);
        switch (input.action) {
          case "adminDeletePost": result = await deletePostAsAdmin(input.postId); break;
          case "adminDeleteUser": result = await deleteUserAsAdmin(input.userId); break;
          case "adminRole": result = await setUserAdminRoleAsAdmin(input.userId, input.role); break;
          case "adminPassword": {
            const form = new FormData(); form.set("password", input.password);
            result = await resetUserPasswordAsAdmin(input.userId, form); break;
          }
          case "deleteInvite": result = await deleteInvite(input.inviteId); break;
        }
      }
    }
    return result?.error ? json(result, 400) : json(result ?? { ok: true });
  } catch (error) {
    if (error instanceof NativeRequestError) return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError) return json({ error: error.issues[0]?.message ?? "Invalid request." }, 400);
    if (error instanceof SyntaxError) return json({ error: "Invalid JSON." }, 400);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return json({ error: "That name or email is already in use." }, 409);
    // Do not return database/storage details or redirect exceptions to the client.
    console.error("Native API mutation failed", error);
    return json({ error: "The change could not be saved. Check your access and try again." }, 500);
  }
}
