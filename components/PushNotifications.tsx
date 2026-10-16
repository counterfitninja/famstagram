"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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

export default function PushNotifications() {
  const router = useRouter();
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIosBrowser, setIsIosBrowser] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;

    void navigator.serviceWorker.register("/sw.js");

    function handleServiceWorkerMessage(event: MessageEvent) {
      if (event.data?.type === "famstagram-push-received") {
        router.refresh();
      }
    }

    navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));

    setIsStandalone(standalone);
    setIsIosBrowser(ios && !standalone);

    const isDismissed = localStorage.getItem("pwa_prompt_dismissed") === "true";

    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        const endpoint = subscription?.endpoint;
        return fetch(endpoint ? `/api/push/subscription?endpoint=${encodeURIComponent(endpoint)}` : "/api/push/subscription");
      })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data?.configured) return;
        setPublicKey(data.publicKey);
        const permission = Notification.permission;
        if (!data.currentSubscribed && permission !== "denied" && !isDismissed && standalone) {
          setShowPrompt(true);
        }
      })
      .catch(() => setStatus("error"));

    function captureInstallPrompt(event: Event) {
      event.preventDefault();
      if (standalone) return;
      setInstallPrompt(event as InstallPromptEvent);
      if (!isDismissed && Notification.permission !== "denied") {
        setShowPrompt(true);
      }
    }

    function hideInstallPrompt() {
      setInstallPrompt(null);
      setShowPrompt(false);
    }

    function handleResetBanner() {
      setShowPrompt(true);
    }

    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    window.addEventListener("appinstalled", hideInstallPrompt);
    window.addEventListener("reset-pwa-banner", handleResetBanner);

    return () => {
      navigator.serviceWorker.removeEventListener("message", handleServiceWorkerMessage);
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", hideInstallPrompt);
      window.removeEventListener("reset-pwa-banner", handleResetBanner);
    };
  }, []);

  async function subscribeToPush() {
    if (!publicKey) return;
    const registration = await navigator.serviceWorker.ready;
    const existingSubscription = await registration.pushManager.getSubscription();
    const subscription = existingSubscription ?? await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeVapidKey(publicKey),
    });
    const response = await fetch("/api/push/subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription),
    });
    if (!response.ok) throw new Error("Subscription could not be saved.");
  }

  async function installApp() {
    setStatus("saving");
    try {
      if (installPrompt) {
        await installPrompt.prompt();
        const choice = await installPrompt.userChoice;
        setInstallPrompt(null);
        if (choice.outcome === "accepted") {
          setShowPrompt(false);
        }
      } else if (!isIosBrowser) {
        if (Notification.permission === "denied") {
          setStatus("error");
          return;
        }
        const permission = await Notification.requestPermission();
        if (permission === "granted") await subscribeToPush();
        setShowPrompt(false);
      }
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  function handleDismiss() {
    localStorage.setItem("pwa_prompt_dismissed", "true");
    setShowPrompt(false);
  }

  if (!showPrompt) return null;

  return (
    <aside className="fixed inset-x-4 bottom-24 z-20 mx-auto max-w-sm rounded-xl border border-sky-200 bg-white p-4 shadow-lg sm:bottom-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">
            {isStandalone ? "Enable notifications" : "Install Famstagram to enable notifications"}
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            {isIosBrowser
              ? "Use Safari Share button, then tap 'Add to Home Screen' to enable notifications."
              : isStandalone
                ? "Turn on notifications to receive new family post and tag alerts."
                : "Install the app to enable notifications for new family posts and tag alerts."}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!isIosBrowser && (
            <button
              type="button"
              onClick={installApp}
              disabled={status === "saving"}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {isStandalone ? "Enable notifications" : "Install app & enable notifications"}
            </button>
          )}
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss banner"
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
          >
            ✕
          </button>
        </div>
      </div>
      {status === "error" && <p className="mt-2 text-xs text-red-600">Installation could not be completed.</p>}
    </aside>
  );
}
