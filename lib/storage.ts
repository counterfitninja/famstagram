import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveApplicationPath } from "@/lib/runtime-path";

/**
 * Storage abstraction. Two drivers selected via STORAGE_DRIVER env var:
 *  - "local" (default): writes to UPLOAD_DIR (./uploads) on the server disk
 *  - "s3": S3-compatible object storage (e.g. MinIO) via the AWS SDK
 */

export interface StoredFile {
  body: Buffer | ReadableStream;
}

export interface StoredFileMetadata {
  size: number | null;
}

export interface StorageDriver {
  save(body: Buffer, key: string, mimeType: string): Promise<void>;
  get(key: string): Promise<StoredFile | null>;
  metadata(key: string): Promise<StoredFileMetadata | null>;
  remove(key: string): Promise<void>;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};

// ---------- local disk driver ----------

function uploadRoot() {
  const configuredPath = process.env.UPLOAD_DIR ?? "./uploads";
  return path.isAbsolute(configuredPath)
    ? configuredPath
    : resolveApplicationPath(configuredPath);
}

const localDriver: StorageDriver = {
  async save(body, key) {
    const filePath = path.join(uploadRoot(), key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    // Write then rename so background re-optimization never serves a partial file.
    const tempPath = `${filePath}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, body);
    await fs.rename(tempPath, filePath);
  },
  async get(key) {
    try {
      const body = await fs.readFile(path.join(uploadRoot(), key));
      return { body };
    } catch {
      return null;
    }
  },
  async metadata(key) {
    try {
      const stats = await fs.stat(path.join(uploadRoot(), key));
      return { size: stats.size };
    } catch {
      return null;
    }
  },
  async remove(key) {
    await fs.unlink(path.join(uploadRoot(), key)).catch(() => {});
  },
};

// ---------- S3 / MinIO driver (SDK loaded lazily) ----------

type S3ClientType = import("@aws-sdk/client-s3").S3Client;
let s3ClientInstance: S3ClientType | null = null;

async function s3Client(): Promise<S3ClientType> {
  if (s3ClientInstance) return s3ClientInstance;
  const { S3Client } = await import("@aws-sdk/client-s3");
  s3ClientInstance = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: true, // required by MinIO
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? "",
      secretAccessKey: process.env.S3_SECRET_KEY ?? "",
    },
  });
  return s3ClientInstance;
}

const s3Driver: StorageDriver = {
  async save(body, key, mimeType) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await s3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: mimeType,
      }),
    );
  },
  async get(key) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await s3Client();
    try {
      const res = await client.send(
        new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
      );
      if (!res.Body) return null;
      const body = (res.Body as { transformToWebStream(): ReadableStream }).transformToWebStream();
      return { body };
    } catch {
      return null;
    }
  },
  async metadata(key) {
    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await s3Client();
    try {
      const res = await client.send(
        new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
      );
      return { size: typeof res.ContentLength === "number" ? res.ContentLength : null };
    } catch {
      return null;
    }
  },
  async remove(key) {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await s3Client();
    await client
      .send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }))
      .catch(() => {});
  },
};

// ---------- public API ----------

function driver(): StorageDriver {
  return process.env.STORAGE_DRIVER === "s3" ? s3Driver : localDriver;
}

const OPTIMIZABLE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Whether a stored file can be shrunk by `optimizeImageBuffer`. */
export function isOptimizableImage(mimeType: string): boolean {
  // Sharp's bundled build does not decode HEIC/HEIF, and GIFs may be animated,
  // so those are kept byte-for-byte.
  return OPTIMIZABLE_IMAGE_TYPES.includes(mimeType);
}

async function optimizeImageBuffer(body: Buffer, mimeType: string): Promise<Buffer> {
  if (!isOptimizableImage(mimeType)) return body;

  const sharp = (await import("sharp")).default;
  let pipeline = sharp(body)
    .rotate()
    .resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true })
    .withMetadata();
  if (mimeType === "image/png") {
    pipeline = pipeline.png({ compressionLevel: 9, palette: true, quality: 80 });
  } else if (mimeType === "image/webp") {
    pipeline = pipeline.webp({ quality: 82 });
  } else {
    pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true });
  }
  return pipeline.toBuffer();
}

export async function streamToBuffer(body: Buffer | ReadableStream): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;

  const chunks: Uint8Array[] = [];
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Saves an uploaded file. By default supported raster images are optimized
 * inline; pass `{ optimize: false }` to store the original bytes untouched
 * (post uploads do this so metadata such as GPS is preserved, and are
 * optimized later by `optimizeStoredImage`).
 * When `feedId` is provided the storage key is namespaced `feeds/<feedId>/...` so
 * each feed's objects stay self-contained (splittable per FR-001) and the media
 * route can resolve the owning feed directly from the key.
 */
export async function saveMedia(
  file: File,
  feedId?: string,
  { optimize = true }: { optimize?: boolean } = {},
): Promise<{ key: string; mimeType: string }> {
  const original = Buffer.from(await file.arrayBuffer());
  const body = optimize ? await optimizeImageBuffer(original, file.type) : original;
  const ext = EXT_BY_MIME[file.type] ?? path.extname(file.name).toLowerCase();
  const key = feedId ? `feeds/${feedId}/${randomUUID()}${ext}` : `${randomUUID()}${ext}`;
  await driver().save(body, key, file.type);
  return { key, mimeType: file.type };
}

/**
 * Re-encodes a stored original image in place (same key and MIME type).
 * Returns the original bytes so callers can still read their metadata, or
 * null when the object no longer exists.
 */
export async function optimizeStoredImage(key: string, mimeType: string): Promise<Buffer | null> {
  const stored = await driver().get(key);
  if (!stored) return null;
  const original = await streamToBuffer(stored.body);
  if (!isOptimizableImage(mimeType)) return original;

  const optimized = await optimizeImageBuffer(original, mimeType);
  // Only replace the original when re-encoding actually saves space.
  if (optimized.length < original.length) {
    await driver().save(optimized, key, mimeType);
  }
  return original;
}

export async function getMedia(key: string): Promise<StoredFile | null> {
  return driver().get(key);
}

export async function getMediaMetadata(key: string): Promise<StoredFileMetadata | null> {
  return driver().metadata(key);
}

export async function deleteMedia(key: string): Promise<void> {
  return driver().remove(key);
}
