import * as webPushModule from "web-push";
import User from "../models/User.js";

// Works whether the installed web-push version is CommonJS (has a default
// export) or ESM (named exports only).
const webpush = webPushModule.default ?? webPushModule;

/**
 * Browser (Web Push) notifications for the website.
 *
 * Needs three environment variables (generate the key pair once with
 * `npx web-push generate-vapid-keys`):
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (e.g. mailto:you@domain.com)
 * Without them everything here quietly does nothing, so deploying is safe.
 */

let configured = null;

function configure() {
  if (configured !== null) return configured;

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    configured = false;
    return configured;
  }

  webpush.setVapidDetails(
    VAPID_SUBJECT || `mailto:${process.env.ADMIN_EMAIL || "admin@exclusivecooperative.com"}`,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
  configured = true;
  return configured;
}

export const webPushEnabled = () => configure();
export const getVapidPublicKey = () => (configure() ? process.env.VAPID_PUBLIC_KEY : "");

// Where clicking the notification takes the member on the website.
const pageFor = (type, role) => {
  if (role === "admin") return "/admin";
  switch (type) {
    case "membership":
      return "/membership";
    case "withdrawal":
      return "/withdrawals";
    case "security":
      return "/profile";
    case "loan":
    case "loan-eligibility":
    case "repayment":
    case "savings":
    case "dividend":
    case "shareholding":
    case "announcement":
    default:
      return "/dashboard";
  }
};

const clip = (value, max) => String(value || "").slice(0, max);

// Chrome's spam protection looks at notification text, and "change your
// password / contact us immediately" reads like phishing. The full warning
// stays in the in-app notification and the email; the push carries the plain
// facts and the member opens the site to act on them.
const softenForPush = (type, text) => {
  const plain = String(text || "");
  if (type !== "security") return plain;

  const softened = plain
    .replace(/\s*If (this was not you|this was not|you did not)[^.]*\./gi, "")
    .replace(/\s*Please contact[^.]*\./gi, "")
    .replace(/\bimmediately\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return softened || "Open Exclusive Cooperative to review this account alert.";
};

/** Sends one notification to every browser the member has allowed. Never throws. */
export async function sendWebPushToUser(userRef, { type, title, body }) {
  try {
    if (!configure()) return { sent: 0 };

    const userId = userRef && typeof userRef === "object" && userRef._id ? userRef._id : userRef;
    const user = await User.findById(userId).select("+webPushSubscriptions role");
    const subscriptions = user?.webPushSubscriptions || [];
    if (!subscriptions.length) return { sent: 0 };

    const payload = JSON.stringify({
      title: clip(title, 100),
      body: clip(softenForPush(type, body), 240),
      url: pageFor(type, user.role),
    });

    const expired = [];
    let sent = 0;

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            { TTL: 60 * 60 * 24 }
          );
          sent += 1;
        } catch (err) {
          // 404/410 = the browser unsubscribed or the subscription expired.
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            expired.push(sub.endpoint);
          } else {
            console.error("Web push send failed:", err?.statusCode, err?.message);
          }
        }
      })
    );

    if (expired.length) {
      await User.updateOne(
        { _id: user._id },
        { $pull: { webPushSubscriptions: { endpoint: { $in: expired } } } }
      );
    }

    return { sent };
  } catch (error) {
    console.error("Web push error:", error?.message || error);
    return { sent: 0 };
  }
}
