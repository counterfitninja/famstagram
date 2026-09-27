import { z } from "zod";

// ---------- auth ----------

export const registerSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(20, "Username must be at most 20 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "Username may only contain letters, numbers and underscores"),
  email: z.string().email("Enter a valid email address").max(200),
  password: z.string().min(8, "Password must be at least 8 characters").max(100),
});

// ---------- posts ----------

export const captionSchema = z.string().max(500, "Captions are limited to 500 characters");

export const commentSchema = z.string().trim().min(1).max(500);

// ---------- feeds ----------

export const FEED_NAME_MIN = 1;
export const FEED_NAME_MAX = 50;

export const feedNameSchema = z
  .string()
  .trim()
  .min(FEED_NAME_MIN, "Feed name is required")
  .max(FEED_NAME_MAX, "Feed name must be at most 50 characters");

export const feedDescriptionSchema = z.string().trim().max(200, "Description is limited to 200 characters");

/** Special feed-switch target meaning the amalgamated "all my feeds" view. */
export const ALL_FEEDS = "all";

// ---------- location & maps ----------

export const latitudeSchema = z.number().min(-90, "Latitude must be between -90 and 90").max(90, "Latitude must be between -90 and 90");
export const longitudeSchema = z.number().min(-180, "Longitude must be between -180 and 180").max(180, "Longitude must be between -180 and 180");
export const locationNameSchema = z.string().trim().max(200, "Location name is limited to 200 characters").optional().nullable();

export const MAP_LIMIT_DEFAULT = 50;
export const MAP_LIMIT_PRESETS = [25, 50, 100, 250] as const;

export const mapQuerySchema = z.object({
  feedId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(MAP_LIMIT_DEFAULT),
});

// ---------- media ----------

export const IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
];
export const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

export const MAX_IMAGES_PER_POST = 10;
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB per image
export const MAX_AVATAR_SIZE = 5 * 1024 * 1024;
export const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100 MB
export const MAX_VIDEO_SECONDS = 60; // enforced client-side when picking the file

export function isImage(file: { type: string }) {
  return IMAGE_TYPES.includes(file.type);
}

export function isVideo(file: { type: string }) {
  return VIDEO_TYPES.includes(file.type);
}

const MEDIA_TYPE_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "video/x-m4v": "video/mp4",
};

const MEDIA_TYPE_BY_EXTENSION: Record<string, string> = {
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".webm": "video/webm",
  ".webp": "image/webp",
};

function inferMediaTypeFromBytes(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "GIF8") return "image/gif";
  if (
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) return "image/webp";
  if (String.fromCharCode(...bytes.slice(4, 8)) === "ftyp") {
    const brand = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase();
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1"].includes(brand)) {
      return "image/heic";
    }
    if (["avif", "avis"].includes(brand)) return "image/avif";
    if (["isom", "iso2", "mp41", "mp42", "avc1", "3gp4", "3gp5", "3g2a", "mmp4", "qt  "].includes(brand)) {
      return "video/mp4";
    }
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video/webm";
  return null;
}

/** Repairs generic MIME metadata commonly supplied by Android share providers. */
export async function normalizeSharedMediaFile(file: File): Promise<File> {
  const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
  const extensionType = extension ? MEDIA_TYPE_BY_EXTENSION[extension] : undefined;

  // Some mobile pickers report HEIC/HEIF photos as video/mp4 because both use
  // the ISO-BMFF container. Trust the photo extension for those files.
  if (extensionType === "image/heic" || extensionType === "image/heif") {
    return file.type === extensionType
      ? file
      : new File([file], file.name, { type: extensionType, lastModified: file.lastModified });
  }
  if (isImage(file) || isVideo(file)) return file;

  const aliasType = MEDIA_TYPE_ALIASES[file.type.toLowerCase()];
  const inferredType =
    aliasType ??
    (extension ? MEDIA_TYPE_BY_EXTENSION[extension] : undefined) ??
    inferMediaTypeFromBytes(new Uint8Array(await file.slice(0, 16).arrayBuffer()));

  return inferredType && (IMAGE_TYPES.includes(inferredType) || VIDEO_TYPES.includes(inferredType))
    ? new File([file], file.name, { type: inferredType, lastModified: file.lastModified })
    : file;
}

/**
 * Validates the media selection for a post:
 * either 1-10 images, or exactly 1 short video. Used on both client and server.
 */
export function validateMediaFiles(files: { type: string; size: number }[]): { error?: string } {
  if (files.length === 0) {
    return { error: "Please select at least one image or a video." };
  }
  const images = files.filter(isImage);
  const videos = files.filter(isVideo);
  if (images.length + videos.length !== files.length) {
    return { error: "Unsupported file type. Use JPG, PNG, WebP, GIF, HEIC or HEIF images, or an MP4/WebM/MOV video." };
  }
  if (videos.length > 0) {
    if (files.length > 1) {
      return { error: "A post can contain either up to 10 images or a single video." };
    }
    if (videos[0].size > MAX_VIDEO_SIZE) {
      return { error: "The video is too large (max 100 MB)." };
    }
  } else {
    if (images.length > MAX_IMAGES_PER_POST) {
      return { error: `You can upload at most ${MAX_IMAGES_PER_POST} images per post.` };
    }
    for (const img of images) {
      if (img.size > MAX_IMAGE_SIZE) {
        return { error: "Each image must be smaller than 10 MB." };
      }
    }
  }
  return {};
}
