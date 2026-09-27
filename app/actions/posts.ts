"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { reverseGeocodeLocation } from "@/lib/geocoding";
import { deleteMedia } from "@/lib/storage";
import { latitudeSchema, locationNameSchema, longitudeSchema } from "@/lib/validation";

export type DeletePostResult = { error?: string; success?: boolean };
export type UpdatePostLocationResult = {
  error?: string;
  success?: boolean;
  locationName?: string | null;
};

export async function deletePost(postId: string): Promise<DeletePostResult> {
  const user = await requireUser();
  const post = await db.post.findUnique({
    where: { id: postId },
    select: {
      authorId: true,
      feedId: true,
      author: { select: { username: true } },
      media: { select: { key: true } },
    },
  });

  if (!post) return { error: "Post not found." };
  // Feed membership gate: no existence leak across feeds (FR-010).
  const membership = await db.feedMembership.findUnique({
    where: { userId_feedId: { userId: user.id, feedId: post.feedId } },
    select: { id: true },
  });
  if (!membership) return { error: "Post not found." };
  if (post.authorId !== user.id) return { error: "You can only delete your own posts." };

  await db.post.delete({ where: { id: postId } });
  await Promise.all(post.media.map(({ key }) => deleteMedia(key)));

  revalidatePath("/");
  revalidatePath("/shared");
  revalidatePath(`/post/${postId}`);
  revalidatePath(`/profile/${post.author.username}`);
  return { success: true };
}

/** Admin-only: set or clear a post's map location from a search result or map pick. */
export async function updatePostLocation(
  postId: string,
  latitude: number | null,
  longitude: number | null,
  requestedLocationName?: string | null,
): Promise<UpdatePostLocationResult> {
  await requireAdmin();

  const post = await db.post.findUnique({ where: { id: postId }, select: { id: true } });
  if (!post) return { error: "Post not found." };

  if ((latitude === null) !== (longitude === null)) {
    return { error: "Choose a location, or clear both coordinates." };
  }

  let locationName: string | null = null;
  if (latitude !== null && longitude !== null) {
    const latCheck = latitudeSchema.safeParse(latitude);
    const lngCheck = longitudeSchema.safeParse(longitude);
    if (!latCheck.success) return { error: latCheck.error.issues[0].message };
    if (!lngCheck.success) return { error: lngCheck.error.issues[0].message };

    const nameCheck = locationNameSchema.safeParse(requestedLocationName);
    if (!nameCheck.success) return { error: nameCheck.error.issues[0].message };
    locationName = nameCheck.data || (await reverseGeocodeLocation(latitude, longitude));
  }

  await db.post.update({
    where: { id: postId },
    data: { latitude, longitude, locationName },
  });

  revalidatePath("/");
  revalidatePath("/shared");
  revalidatePath("/map");
  revalidatePath(`/post/${postId}`);
  return { success: true, locationName };
}