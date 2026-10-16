"use client";

import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function decodeVapidKey(key: string) {
  const padding = "=".repeat((4 - (key.length % 4)) % 4);
  const base64 = (key + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = atob(base64);
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

type PushPermission = NotificationPermission | "unsupported";

export function getPushCapabilityLabel(capability: { supported: boolean; standalone: boolean; iosBrowser: boolean }) {
  if (!capability.supported) return "Push notifications are not supported in this browser.";
  if (capability.iosBrowser) return "Install Famstagram to enable push notifications on iOS.";
  return capability.standalone ? "Push notifications are available on this device." : "Install the app for reliable push delivery.";
}

export function getPushStateLabel(state: { permission: PushPermission; currentSubscribed: boolean; serverVerified: boolean }) {
  if (state.permission === "unsupported") return "Not supported";
  if (state.permission === "denied") return "Blocked by browser";
  if (state.currentSubscribed && state.serverVerified) return "Enabled on this device";
  if (state.permission === "granted" && state.currentSubscribed) return "Needs setup";
  return "Not enabled";
}

export default function PushSubscriptionControl() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIosBrowser, setIsIosBrowser] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [serverVerified, setServerVerified] = useState(false);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [permission, setPermission] = useState<PushPermission>("unsupported");
  const [capability, setCapability] = useState({ supported: false, standalone: false, iosBrowser: false });
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const standalone = supported && (window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone)));
    setCapability({ supported, standalone, iosBrowser: ios && !standalone });
    setIsStandalone(standalone);
    setIsIosBrowser(ios && !standalone);
    if (!supported) {
      setPermission("unsupported");
      return;
    }

    setPermission(Notification.permission);
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        const currentEndpoint = subscription?.endpoint ?? null;
        setEndpoint(currentEndpoint);
        setIsSubscribed(Boolean(subscription));
        return fetch(currentEndpoint ? `/api/push/subscription?endpoint=${encodeURIComponent(currentEndpoint)}` : "/api/push/subscription");
      })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setServerVerified(Boolean(data.currentSubscribed ?? data.subscribed));
      })
      .catch(() => {});

    function captureInstall(e: Event) {
      e.preventDefault();
      setInstallPrompt(e as InstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", captureInstall);
    return () => window.removeEventListener("beforeinstallprompt", captureInstall);
  }, []);

  async function handleTogglePush() {
    setStatus("loading");
    setMessage(null);
    try {
      if (isSubscribed) {
        // Unsubscribe
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          const response = await fetch("/api/push/subscription", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          });
          if (!response.ok) throw new Error("Could not disable subscription.");
          await subscription.unsubscribe();
        }
        setIsSubscribed(false);
        setEndpoint(null);
        setServerVerified(false);
        setStatus("success");
        setMessage("Push notifications turned off for this device.");
        return;
      }

      if (permission === "denied") {
        setStatus("error");
        setMessage("Notifications are blocked. Allow them in your browser settings, then try again.");
        return;
      }
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        setStatus("error");
        setMessage("Notification permission was not granted. You can try again when ready.");
        return;
      }

      const res = await fetch("/api/push/subscription");
      const data = await res.json();
      if (!data.configured || !data.publicKey) {
        setStatus("error");
        setMessage("Push notifications are not configured on the server.");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const existingSubscription = await registration.pushManager.getSubscription();
      const subscription = existingSubscription ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeVapidKey(data.publicKey),
      });

      const saveRes = await fetch("/api/push/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription),
      });

      if (!saveRes.ok) throw new Error("Could not save subscription.");

      const verifyRes = await fetch(`/api/push/subscription?endpoint=${encodeURIComponent(subscription.endpoint)}`);
      const verifyData = verifyRes.ok ? await verifyRes.json() : null;
      if (!verifyData?.currentSubscribed) throw new Error("Server did not confirm the saved subscription.");

      setIsSubscribed(true);
      setEndpoint(subscription.endpoint);
      setServerVerified(true);
      setStatus("success");
      setMessage("Push notifications enabled on this device.");
    } catch {
      setStatus("error");
      setMessage("Failed to update push notifications.");
    }
  }

  async function handleInstallPwa() {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setInstallPrompt(null);
    } else if (isIosBrowser) {
      alert("To install on iOS: Tap the Share icon in Safari, then select 'Add to Home Screen'.");
    } else {
      alert("To install: Click the install icon in your browser address bar or menu.");
    }
  }

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Push notifications on this device</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Get instant alerts when family members share photos or tag you.
          </p>
          <p className="mt-2 text-xs font-medium text-neutral-700">
            {getPushStateLabel({ permission, currentSubscribed: isSubscribed, serverVerified })}
          </p>
        </div>
        <button
          type="button"
          onClick={handleTogglePush}
          disabled={status === "loading" || !capability.supported}
          className={`relative h-6 w-11 rounded-full transition ${
            isSubscribed ? "bg-sky-600" : "bg-neutral-300"
          }`}
          aria-pressed={isSubscribed}
          aria-label={isSubscribed ? "Disable push notifications" : "Enable push notifications"}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
              isSubscribed ? "left-5" : "left-0.5"
            }`}
          />
        </button>
      </div>

      <p className="text-xs text-neutral-500">{getPushCapabilityLabel(capability)}</p>

      {!isStandalone && (
        <div className="flex items-center justify-between border-t border-neutral-100 pt-3">
          <div>
            <p className="text-xs font-medium text-neutral-800">PWA App Installation</p>
            <p className="text-[11px] text-neutral-500">
              {isIosBrowser
                ? "Install via Safari Share > Add to Home Screen."
                : "Install app to your home screen or desktop."}
            </p>
          </div>
          <button
            type="button"
            onClick={handleInstallPwa}
            className="rounded-lg bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100"
          >
            {installPrompt ? "Install App" : "Install Guide"}
          </button>
        </div>
      )}

      {message && (
        <p
          className={`text-xs ${
            status === "error" ? "text-red-600" : "text-emerald-600 font-medium"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}