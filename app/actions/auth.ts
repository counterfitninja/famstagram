"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { deleteMedia, saveMedia } from "@/lib/storage";
import { IMAGE_TYPES, MAX_AVATAR_SIZE, registerSchema } from "@/lib/validation";
import { getSafeLoginRedirect } from "@/lib/auth-redirect";

export type AuthState = { error?: string } | null;

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const identifier = String(formData.get("identifier") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = getSafeLoginRedirect(String(formData.get("next") ?? ""));
  if (!identifier || !password) {
    return { error: "Please enter your username/email and password." };
  }

  const user = await db.user.findFirst({
    where: { OR: [{ username: identifier }, { email: identifier.toLowerCase() }] },
  });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return { error: "Invalid credentials. Please try again." };
  }

  const session = await getSession();
  session.userId = user.id;
  session.username = user.username;
  session.role = user.role;
  await session.save();

  redirect(next);
}

export async function logout() {
  const session = await getSession();
  session.destroy();
  redirect("/login");
}

export async function register(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const token = String(formData.get("token") ?? "");
  if (formData.get("confirmAccount") !== "on") {
    return { error: "Please confirm that you want to create this account." };
  }

  const parsed = registerSchema.safeParse({
    username: String(formData.get("username") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check your details." };
  }
  const { username, email, password } = parsed.data;

  const invite = await db.invite.findUnique({ where: { token } });
  if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
    return { error: "This invite link is invalid, already used, or expired." };
  }

  const existing = await db.user.findFirst({
    where: { OR: [{ username }, { email: email.toLowerCase() }] },
  });
  if (existing) {
    return { error: "That username or email is already taken." };
  }

  const photo = formData.get("photo");
  let avatar: { key: string; mimeType: string } | null = null;
  if (photo instanceof File && photo.size > 0) {
    if (!IMAGE_TYPES.includes(photo.type)) {
      return { error: "Profile photos must be JPG, PNG, WebP or GIF images." };
    }
    if (photo.size > MAX_AVATAR_SIZE) {
      return { error: "Profile photos must be smaller than 5 MB." };
    }
    avatar = await saveMedia(photo);
  }

  let user;
  try {
    user = await db.user.create({
      data: {
        username,
        email: email.toLowerCase(),
        passwordHash: await bcrypt.hash(password, 10),
        avatarKey: avatar?.key,
        avatarMimeType: avatar?.mimeType,
      },
    });
    // The new account joins exactly the feed the invite was scoped to (FR-012),
    // and the invite is consumed — all atomically.
    await db.$transaction([
      db.feedMembership.create({
        data: { userId: user.id, feedId: invite.feedId, role: "member" },
      }),
      db.invite.update({
        where: { id: invite.id },
        data: { usedAt: new Date(), usedById: user.id },
      }),
    ]);

  } catch (error) {
    if (avatar) await deleteMedia(avatar.key);
    throw error;
  }

  const session = await getSession();
  session.userId = user.id;
  session.username = user.username;
  session.role = user.role;
  // Land the new account in the feed it was invited into (FR-012).
  session.activeFeedId = invite.feedId;
  session.feedViewMode = "feed";
  await session.save();

  redirect("/");
}
