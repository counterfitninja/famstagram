self.__famstagramSwVersion = "2026-09-23-native-push-v1";

const FAMSTAGRAM_ORIGIN_PATH = "/";
const ICON_PATH = "/icons/icon-192.png";

function normalizePushText(value, fallback) {
  const normalized = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim() : "";
  return normalized || fallback;
}

function normalizePushPayload(input) {
  const raw = input && typeof input === "object" ? input : {};
  const rawData = raw.data && typeof raw.data === "object" ? raw.data : {};
  const notificationId = typeof raw.notificationId === "string"
    ? raw.notificationId
    : typeof rawData.notificationId === "string" ? rawData.notificationId : null;
  const rawUrl = typeof raw.url === "string" ? raw.url : typeof rawData.url === "string" ? rawData.url : "";
  const url = rawUrl.startsWith("/") && !rawUrl.startsWith("//") ? rawUrl.slice(0, 512) : "/notifications";
  const title = normalizePushText(raw.title, "Famstagram").slice(0, 80);
  const body = normalizePushText(raw.body, "You have a new notification.").slice(0, 180);
  const tag = typeof raw.tag === "string" && raw.tag.trim()
    ? raw.tag.trim().slice(0, 120)
    : `notification-${notificationId || "unknown"}`.slice(0, 120);
  return {
    notificationId,
    title,
    body,
    url,
    tag,
    icon: ICON_PATH,
    badge: ICON_PATH,
    data: {
      notificationId,
      url,
      ...(typeof raw.feedId === "string" ? { feedId: raw.feedId } : typeof rawData.feedId === "string" ? { feedId: rawData.feedId } : {}),
      ...(typeof raw.commentId === "string" ? { commentId: raw.commentId } : typeof rawData.commentId === "string" ? { commentId: rawData.commentId } : {}),
    },
  };
}

function getNotificationOptions(payload) {
  const normalized = normalizePushPayload(payload);
  return {
    body: normalized.body,
    icon: normalized.icon,
    badge: normalized.badge,
    tag: normalized.tag,
    renotify: false,
    data: normalized.data,
  };
}

function isFamstagramClient(client) {
  try {
    const url = new URL(client.url);
    return url.origin === self.location.origin && url.pathname.startsWith(FAMSTAGRAM_ORIGIN_PATH);
  } catch {
    return false;
  }
}

function shouldSuppressForegroundNotification(windowClients) {
  return windowClients.some((client) => isFamstagramClient(client) && client.visibilityState === "visible");
}

function resolveClickUrl(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/notifications";
  return value.slice(0, 512);
}

function absoluteClickUrl(value) {
  return new URL(resolveClickUrl(value), self.location.origin).href;
}

self.__famstagramPush = { normalizePushPayload, getNotificationOptions, shouldSuppressForegroundNotification, resolveClickUrl };

function broadcastToWindows(message) {
  return clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((windowClients) => {
      windowClients.forEach((client) => client.postMessage(message));
    });
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function rememberPush(payload) {
  const normalized = normalizePushPayload(payload);
  const entry = {
    serviceWorkerVersion: self.__famstagramSwVersion,
    receivedAt: new Date().toISOString(),
    notificationId: normalized.notificationId,
    tag: normalized.tag,
    url: normalized.url,
  };
  self.__lastPushDebug = entry;
  return Promise.allSettled([
    fetch("/api/push/receipt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ...entry, action: "receipt" }),
    }),
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      windowClients.forEach((client) => client.postMessage({ type: "famstagram-push-received", entry }));
    }),
  ]);
}

self.addEventListener("push", (event) => {
  let rawPayload;
  try {
    rawPayload = event.data?.json() ?? {};
  } catch {
    rawPayload = { body: event.data?.text() };
  }
  const payload = normalizePushPayload(rawPayload);
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      const suppress = shouldSuppressForegroundNotification(windowClients);
      const tasks = [rememberPush(payload)];
      if (!suppress && !self.__displayedPushTags?.has(payload.tag)) {
        self.__displayedPushTags = self.__displayedPushTags || new Set();
        self.__displayedPushTags.add(payload.tag);
        tasks.push(self.registration.showNotification(payload.title, getNotificationOptions(payload)));
      }
      return Promise.allSettled(tasks);
    }),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "famstagram-get-last-push") {
    event.waitUntil(broadcastToWindows({ type: "famstagram-last-push", entry: self.__lastPushDebug ?? null }));
  }
  if (event.data?.type === "famstagram-get-sw-version") {
    event.waitUntil(broadcastToWindows({ type: "famstagram-sw-version", version: self.__famstagramSwVersion }));
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const notificationId = event.notification.data?.notificationId;
  if (notificationId) {
    self.__handledNotificationIds = self.__handledNotificationIds || new Set();
    if (self.__handledNotificationIds.has(notificationId)) return;
    self.__handledNotificationIds.add(notificationId);
  }
  const url = absoluteClickUrl(event.notification.data?.url);
  event.waitUntil(
    Promise.allSettled([
      notificationId
        ? fetch("/api/push/receipt", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ action: "acknowledge", notificationId, receivedAt: new Date().toISOString() }),
          })
        : Promise.resolve(),
      clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windowClients) => {
        const famstagramClient = windowClients.find(isFamstagramClient);
        if (famstagramClient) {
          if (typeof famstagramClient.navigate === "function") await famstagramClient.navigate(url);
          return famstagramClient.focus();
        }
        return clients.openWindow(url);
      }),
    ]),
  );
});
