self.__famstagramSwVersion = "2026-09-29-push-click-routing-v1";

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

function resolveNotificationUrl(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return new URL("/notifications", self.location.origin).href;
  }
  return new URL(value.slice(0, 512), self.location.origin).href;
}

function isFamstagramClient(client) {
  try {
    return new URL(client.url).origin === self.location.origin;
  } catch {
    return false;
  }
}

function rememberPush(data) {
  const entry = {
    serviceWorkerVersion: self.__famstagramSwVersion,
    receivedAt: new Date().toISOString(),
    title: data.title ?? "Famstagram",
    body: data.body ?? "You have a new notification.",
    tag: data.tag ?? null,
    url: resolveNotificationUrl(data.url),
  };
  self.__lastPushDebug = entry;
  return Promise.allSettled([
    fetch("/api/push/receipt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(entry),
    }),
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      windowClients.forEach((client) => client.postMessage({ type: "famstagram-push-received", entry }));
    }),
  ]);
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    Promise.all([
      rememberPush(data),
      self.registration.showNotification(data.title ?? "Famstagram", {
        body: data.body ?? "You have a new notification.",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: data.tag,
        data: { url: resolveNotificationUrl(data.url) },
      }),
    ]),
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
  const url = resolveNotificationUrl(event.notification.data?.url);
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windowClients) => {
      const appClient = windowClients.find(isFamstagramClient);
      if (appClient) {
        if (typeof appClient.navigate === "function") await appClient.navigate(url);
        return appClient.focus();
      }
      return clients.openWindow(url);
    }),
  );
});
