import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Famstagram",
    short_name: "Famstagram",
    description: "Private photo and video sharing for our family",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f5f5",
    theme_color: "#0369a1",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Lets other apps (e.g. Google Photos) "Share" images/video directly into Famstagram.
    share_target: {
      action: "/api/share-target",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        files: [
          {
            name: "media",
            accept: [
              "image/jpeg",
              "image/png",
              "image/webp",
              "image/gif",
              "video/mp4",
              "video/webm",
              "video/quicktime",
            ],
          },
        ],
      },
    },
  };
}
