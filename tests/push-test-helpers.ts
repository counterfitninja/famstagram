export function loadServiceWorkerSource() {
  return "";
}

export function normalizeTestPayload(payload: Record<string, unknown>) {
  const data = (payload.data && typeof payload.data === "object" ? payload.data : {}) as Record<string, unknown>;
  const notificationId = typeof payload.notificationId === "string"
    ? payload.notificationId
    : typeof data.notificationId === "string" ? data.notificationId : null;
  const url = typeof payload.url === "string" && payload.url.startsWith("/")
    ? payload.url
    : typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/notifications";
  return { notificationId, url };
}

export function expectedNotificationOptions(payload: Record<string, unknown>) {
  const normalized = normalizeTestPayload(payload);
  return {
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: typeof payload.tag === "string" ? payload.tag : normalized.notificationId ? `notification-${normalized.notificationId}` : undefined,
    data: { notificationId: normalized.notificationId, url: normalized.url },
  };
}

export function expectedClickTarget(payload: Record<string, unknown>) {
  return normalizeTestPayload(payload).url;
}
