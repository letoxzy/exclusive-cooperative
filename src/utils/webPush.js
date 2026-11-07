import request from "./api";

export const isPushSupported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

export const pushPermission = () =>
  isPushSupported() ? Notification.permission : "unsupported";

// The browser wants the public key as bytes, not base64 text.
const keyToBytes = (base64) => {
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

async function getRegistration() {
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

/**
 * Registers this browser for notifications on the signed-in account.
 * Pass { prompt: true } from a button click to ask permission; without it the
 * browser is only (re)registered when permission was already granted.
 * Resolves to { ok: true } or { ok: false, reason }.
 */
export async function subscribePush({ prompt = false } = {}) {
  if (!isPushSupported()) return { ok: false, reason: "unsupported" };

  let permission = Notification.permission;
  if (permission === "default" && prompt) {
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") return { ok: false, reason: permission };

  const { publicKey } = await request("/notifications/web-push/public-key");
  if (!publicKey) return { ok: false, reason: "not-configured" };

  const registration = await getRegistration();
  const options = {
    userVisibleOnly: true,
    applicationServerKey: keyToBytes(publicKey),
  };

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe(options);
  }

  try {
    await request("/notifications/web-push/subscribe", {
      method: "POST",
      body: { subscription: subscription.toJSON() },
    });
  } catch (err) {
    // A subscription made with an older key can't be reused: start fresh once.
    await subscription.unsubscribe().catch(() => {});
    subscription = await registration.pushManager.subscribe(options);
    await request("/notifications/web-push/subscribe", {
      method: "POST",
      body: { subscription: subscription.toJSON() },
    });
  }

  return { ok: true };
}

/** True when this browser is already registered for notifications. */
export async function isPushSubscribed() {
  try {
    if (!isPushSupported() || Notification.permission !== "granted") return false;
    const registration = await navigator.serviceWorker.getRegistration("/sw.js");
    return Boolean(await registration?.pushManager.getSubscription());
  } catch {
    return false;
  }
}

/** Detaches this browser from the account (used on log out). Never throws. */
export async function unsubscribePush() {
  try {
    if (!isPushSupported()) return;
    const registration = await navigator.serviceWorker.getRegistration("/sw.js");
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;

    await request("/notifications/web-push/subscribe", {
      method: "DELETE",
      body: { endpoint: subscription.endpoint },
    }).catch(() => {});
    await subscription.unsubscribe().catch(() => {});
  } catch {
    // Signing out must never be blocked by notification clean-up.
  }
}

export const sendTestPush = () =>
  request("/notifications/web-push/test", { method: "POST" });
