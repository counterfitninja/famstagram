"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { btnPrimary, inputCls } from "@/lib/ui";
import {
  MAX_IMAGES_PER_POST,
  MAX_VIDEO_SECONDS,
  VIDEO_TYPES,
  isVideo,
  normalizeSharedMediaFile,
  validateMediaFiles,
} from "@/lib/validation";

export interface FeedOption {
  feedId: string;
  feedName: string;
}

export default function UploadForm({
  feeds = [],
  defaultFeedId,
}: {
  feeds?: FeedOption[];
  defaultFeedId?: string | null;
}) {
  const router = useRouter();
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [feedId, setFeedId] = useState<string>(defaultFeedId ?? feeds[0]?.feedId ?? "");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionCaret, setMentionCaret] = useState<number | null>(null);
  const [mentionSuggestions, setMentionSuggestions] = useState<string[]>([]);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Build / clean up object URLs for previews.
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  // Fetch @mention suggestions with a short debounce while typing.
  useEffect(() => {
    if (mentionQuery === null) {
      setMentionSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/suggest?q=${encodeURIComponent(mentionQuery)}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          setMentionSuggestions([]);
          return;
        }
        const data = (await res.json()) as { users?: string[] };
        setMentionSuggestions(Array.isArray(data.users) ? data.users : []);
        setActiveMentionIndex(0);
      } catch {
        setMentionSuggestions([]);
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [mentionQuery]);

  function syncMentionState(value: string, caret: number) {
    const beforeCaret = value.slice(0, caret);
    const match = beforeCaret.match(/(^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]*)$/);
    if (!match) {
      setMentionQuery(null);
      setMentionStart(null);
      setMentionCaret(null);
      return;
    }

    setMentionQuery(match[2]);
    setMentionStart(caret - match[2].length - 1);
    setMentionCaret(caret);
  }

  function applyMention(username: string, textarea: HTMLTextAreaElement) {
    if (mentionStart === null || mentionCaret === null) return;

    const nextCaption =
      caption.slice(0, mentionStart) + `@${username} ` + caption.slice(mentionCaret);
    const nextCaret = mentionStart + username.length + 2;

    setCaption(nextCaption);
    setMentionQuery(null);
    setMentionSuggestions([]);
    setMentionStart(null);
    setMentionCaret(null);

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function checkVideoDuration(file: File): Promise<boolean> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(video.duration <= MAX_VIDEO_SECONDS + 1);
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(true); // if we can't read metadata, don't block the upload
      };
      video.src = url;
    });
  }

  async function onSelect(list: FileList | null) {
    setError(null);
    if (!list || list.length === 0) return;
    const selected = await Promise.all(Array.from(list).map(normalizeSharedMediaFile));

    const video = selected.find((f) => isVideo(f));
    // A post is either one video or a set of images, so a video always
    // replaces the selection; images are appended to the current images.
    const next = video
      ? selected
      : [
          ...files.filter((f) => !isVideo(f)),
          ...selected.filter(
            (f) =>
              !isVideo(f) &&
              !files.some((e) => e.name === f.name && e.size === f.size),
          ),
        ];

    const check = validateMediaFiles(next);
    if (check.error) {
      setError(check.error);
      return;
    }
    if (video && !(await checkVideoDuration(video))) {
      setError(`Videos must be ${MAX_VIDEO_SECONDS} seconds or shorter.`);
      return;
    }
    setFiles(next);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (files.length === 0) {
      setError("Please select at least one image or a video.");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("caption", caption);
      if (feedId) form.append("feedId", feedId);
      for (const f of files) form.append("media", f);

      const res = await fetch("/api/posts", { method: "POST", body: form });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Upload failed. Please try again.");
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 800));
      router.push("/");
      router.refresh();
    } finally {
      setUploading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 pb-24 sm:pb-0">
      {feeds.length > 1 && (
        <div>
          <label htmlFor="feed" className="mb-1 block text-xs font-medium text-neutral-600">
            Post to feed
          </label>
          <select
            id="feed"
            value={feedId}
            onChange={(e) => setFeedId(e.target.value)}
            className={inputCls}
          >
            {feeds.map((feed) => (
              <option key={feed.feedId} value={feed.feedId}>
                {feed.feedName}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-neutral-400">
            Only members of the selected feed will see this post.
          </p>
        </div>
      )}
      <div>
        <div className="rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 p-4 text-center text-sm text-neutral-500">
          <span className="mb-1 block text-2xl">📷</span>
          <p className="mb-3">
            {files.length > 0
              ? `${files.length} file${files.length > 1 ? "s" : ""} selected`
              : "Choose photos/video from your library, or take a new one"}
          </p>
          <div className="flex justify-center gap-2">
            <label
              htmlFor="media-library"
              className="cursor-pointer rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600"
            >
              Choose from Library
            </label>
            <label
              htmlFor="media-camera"
              className="cursor-pointer rounded-lg border border-sky-500 px-4 py-2 text-sm font-medium text-sky-600 hover:bg-sky-50"
            >
              Take Photo/Video
            </label>
          </div>
        </div>
        <input
          id="media-library"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,video/mp4,video/webm,video/quicktime"
          multiple
          className="hidden"
          onChange={(e) => {
            onSelect(e.target.files);
            e.target.value = ""; // allow picking the same file again
          }}
        />
        {/* Avoid image/* because some mobile browsers strip GPS EXIF from wildcard inputs. */}
        <input
          id="media-camera"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,video/mp4,video/webm,video/quicktime"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            onSelect(e.target.files);
            e.target.value = ""; // allow picking the same file again
          }}
        />
        <p className="mt-1.5 text-xs text-neutral-400">
          Up to {MAX_IMAGES_PER_POST} images (10 MB each) or 1 video up to {MAX_VIDEO_SECONDS}s /
          100 MB. Choose again to add more photos. Selecting a video replaces any other files.
        </p>
      </div>

      {previews.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {previews.map((src, i) =>
            isVideo(files[i]) ? (
              <video
                key={src}
                src={src}
                muted
                className="aspect-square w-full rounded-lg object-cover"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={src}
                src={src}
                alt=""
                className="aspect-square w-full rounded-lg object-cover"
              />
            ),
          )}
        </div>
      )}

      <div>
        <div className="relative">
          <textarea
            ref={captionRef}
            value={caption}
            onChange={(e) => {
              setCaption(e.target.value);
              syncMentionState(e.target.value, e.target.selectionStart);
            }}
            onClick={(e) => syncMentionState(e.currentTarget.value, e.currentTarget.selectionStart)}
            onKeyUp={(e) => syncMentionState(e.currentTarget.value, e.currentTarget.selectionStart)}
            onBlur={() => {
              // Delay close so suggestion clicks can still register.
              window.setTimeout(() => {
                setMentionQuery(null);
                setMentionSuggestions([]);
                setMentionStart(null);
                setMentionCaret(null);
              }, 120);
            }}
            onKeyDown={(e) => {
              if (mentionSuggestions.length === 0 || mentionStart === null || mentionCaret === null) return;

              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveMentionIndex((prev) => (prev + 1) % mentionSuggestions.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveMentionIndex(
                  (prev) => (prev - 1 + mentionSuggestions.length) % mentionSuggestions.length,
                );
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                applyMention(mentionSuggestions[activeMentionIndex], e.currentTarget);
                return;
              }
              if (e.key === "Escape") {
                setMentionQuery(null);
                setMentionSuggestions([]);
                setMentionStart(null);
                setMentionCaret(null);
              }
            }}
            maxLength={500}
            rows={3}
            placeholder="Write a short description about your photo…"
            className={inputCls}
          />

          {mentionQuery !== null && mentionSuggestions.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-44 w-full overflow-y-auto rounded-xl border border-neutral-200 bg-white py-1 shadow-lg">
              {mentionSuggestions.map((username, index) => (
                <li key={username}>
                  <button
                    type="button"
                    className={`w-full px-3 py-2 text-left text-sm ${
                      index === activeMentionIndex ? "bg-sky-50 text-sky-700" : "text-sky-900"
                    } hover:bg-sky-100 hover:text-sky-800`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (captionRef.current) {
                        applyMention(username, captionRef.current);
                      }
                    }}
                  >
                    @{username}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="mt-1 text-xs text-neutral-500">Type @ to mention a family member.</p>
        <p className="mt-1 text-right text-xs text-neutral-400">{caption.length}/500</p>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-600">{error}</p>}

      <button type="submit" disabled={uploading} className={`${btnPrimary} hidden sm:block`}>
        {uploading ? "Uploading…" : "Share"}
      </button>
      <button
        type="submit"
        disabled={uploading}
        className={`${btnPrimary} fixed inset-x-4 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-20 block !w-auto rounded-xl py-3 shadow-lg sm:hidden`}
      >
        {uploading ? "Uploading…" : "Share"}
      </button>
    </form>
  );
}
