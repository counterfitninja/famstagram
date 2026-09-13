"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteMedia } from "@/lib/storage";
import { registerSchema } from "@/lib/validation";

export async function deletePostAsAdmin(postId: string) {
  await requireAdmin();

  const post = await db.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      author: { select: { username: true } },
      media: { select: { key: true } },
    },
  });
  if (!post) return;

  await db.post.delete({ where: { id: post.id } });
  await Promise.all(post.media.map((media) => deleteMedia(media.key)));

  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath(`/profile/${post.author.username}`);
}

export async function resetUserPasswordAsAdmin(userId: string, formData: FormData) {
  await requireAdmin();

  const password = String(formData.get("password") ?? "");
  const parsedPassword = registerSchema.shape.password.safeParse(password);
  if (!parsedPassword.success) {
    throw new Error(parsedPassword.error.issues[0]?.message ?? "Enter a valid password.");
  }

  await db.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(parsedPassword.data, 10) },
  }).catch(() => {});

  revalidatePath("/admin");
}

export async function setUserAdminRoleAsAdmin(userId: string, role: "admin" | "member") {
  const admin = await requireAdmin();
  if (admin.id === userId && role !== "admin") {
    throw new Error("You cannot remove your own admin access.");
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  if (!user) return;

  if (user.role === "admin" && role !== "admin" && await db.user.count({ where: { role: "admin" } }) <= 1) {
    throw new Error("At least one admin account must remain.");
  }

  await db.user.update({ where: { id: user.id }, data: { role } });
  revalidatePath("/admin");
  revalidatePath("/");
}

export async function deleteUserAsAdmin(userId: string) {
  const admin = await requireAdmin();
  if (admin.id === userId) {
    throw new Error("You cannot delete your own account.");
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      role: true,
      posts: { select: { media: { select: { key: true } } } },
    },
  });
  if (!user) return;

  if (user.role === "admin" && await db.user.count({ where: { role: "admin" } }) <= 1) {
    throw new Error("At least one admin account must remain.");
  }

  const mediaKeys = user.posts.flatMap((post) => post.media.map((media) => media.key));
  await db.$transaction(async (transaction) => {
    await transaction.notification.deleteMany({ where: { actorId: user.id } });
    await transaction.sharedPost.deleteMany({
      where: { OR: [{ fromUserId: user.id }, { toUserId: user.id }] },
    });
    await transaction.comment.deleteMany({ where: { authorId: user.id } });
    await transaction.invite.deleteMany({
      where: { OR: [{ createdById: user.id }, { usedById: user.id }] },
    });
    await transaction.post.deleteMany({ where: { authorId: user.id } });
    await transaction.user.delete({ where: { id: user.id } });
  });
  await Promise.all(mediaKeys.map((key) => deleteMedia(key)));

  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath(`/profile/${user.username}`);
}

export async function sendTestPushAsAdmin(targetUserId?: string) {
  await requireAdmin();
  const { sendTestPushNotification } = await import("@/lib/push");
  const result = await sendTestPushNotification(targetUserId);
  revalidatePath("/admin");
  return result;
}

export async function deletePushSubscriptionAsAdmin(subscriptionId: string) {
  await requireAdmin();
  await db.pushSubscription.deleteMany({ where: { id: subscriptionId } });
  revalidatePath("/admin");
}

export async function backfillGpsCoordinatesAsAdmin() {
  await requireAdmin();
  const { backfillMissingGpsCoordinates } = await import("@/lib/gps-backfill");
  const result = await backfillMissingGpsCoordinates();
  revalidatePath("/admin");
  revalidatePath("/map");
  return result;
}