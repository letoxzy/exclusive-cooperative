import User from "../models/User.js";
import { alertSecurityChange } from "./securityAlerts.js";
import { sendEmailJs } from "./emailjs.js";

/**
 * "Successful login" alerts, like a bank's "Mobile App Login" notice:
 *   - in-app notification + push (mobile push and website push)
 *   - an email, when LOGIN_ALERT_EMAIL_ENABLED=true
 *   - an SMS only if SMS_LOGIN_ALERTS=true (see smsNotify.js)
 *
 * Triggered from recordLoginDevice (email + password logins on the website and
 * the mobile app) and from the 6-digit PIN login on the mobile app. A login
 * from a device the member has not used before is sent as "New Sign-in".
 *
 * Nothing here throws, and callers must not await it, so an alert problem can
 * never break a login.
 *
 * Env:
 *   LOGIN_ALERTS_ENABLED=true          master switch (default on)
 *   LOGIN_ALERT_EMAIL_ENABLED=false    also send the email
 *   EMAILJS_LOGIN_ALERT_TEMPLATE_ID    EmailJS template for that email
 */

const flag = (name, fallback = false) => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return String(raw).toLowerCase() === "true";
};

// PIN logins happen every time the app is opened, so alert at most once per
// window per member (a fresh email + password login also starts the window).
const PIN_ALERT_WINDOW_MS = 30 * 60 * 1000;
const lastAlertAt = new Map();

/** "06 November, 2026 at 15:54:38" in Lagos time. */
export const formatLoginTime = (date = new Date()) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Lagos",
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return `${parts.day} ${parts.month}, ${parts.year} at ${parts.hour}:${parts.minute}:${parts.second}`;
};

export const channelOf = (req) => {
  const header = String(req.get("X-App-Platform") || "").toLowerCase();
  return header === "android" || header === "ios" ? "mobile" : "web";
};

const firstName = (fullName) => {
  const first = String(fullName || "").trim().split(/\s+/)[0] || "Member";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
};

async function sendAlertEmail({ member, newDevice, channel, when, label }) {
  if (!flag("LOGIN_ALERT_EMAIL_ENABLED")) return;
  const templateId = process.env.EMAILJS_LOGIN_ALERT_TEMPLATE_ID;
  if (!templateId || !member?.email) return;

  const channelLabel = channel === "mobile" ? "mobile app" : "website";
  const title = newDevice
    ? "New Sign-in"
    : channel === "mobile"
      ? "Mobile App Login"
      : "Website Login";

  await sendEmailJs(templateId, {
    email: member.email,
    name: firstName(member.fullName),
    title,
    channel: channelLabel,
    login_time: when,
    device: label || "Unknown device",
    new_device: newDevice ? "yes" : "",
  });
}

async function sendAlerts({ userId, label, newDevice, channel }) {
  const member = await User.findById(userId).select("email fullName role").lean();
  if (!member || member.role === "admin") return;

  const when = formatLoginTime();
  lastAlertAt.set(String(userId), Date.now());

  void alertSecurityChange(userId, newDevice ? "new-device" : "login", {
    label,
    when,
    channel,
    name: firstName(member.fullName),
  });

  try {
    await sendAlertEmail({ member, newDevice, channel, when, label });
  } catch (err) {
    console.error("[login-alert] email failed:", err?.message || err);
  }
}

/** After a successful email + password sign-in (website or mobile app). */
export async function notifyLogin(user, req, { label, newDevice = false } = {}) {
  try {
    if (!flag("LOGIN_ALERTS_ENABLED", true) || !user?._id) return;
    await sendAlerts({ userId: user._id, label, newDevice, channel: channelOf(req) });
  } catch (err) {
    console.error("[login-alert] failed:", err?.message || err);
  }
}

/** After a correct 6-digit PIN on the mobile app (throttled). */
export async function notifyPinLogin(userId, req, label) {
  try {
    if (!flag("LOGIN_ALERTS_ENABLED", true) || !userId) return;

    const last = lastAlertAt.get(String(userId)) || 0;
    if (Date.now() - last < PIN_ALERT_WINDOW_MS) return;

    await sendAlerts({ userId, label, newDevice: false, channel: "mobile" });
  } catch (err) {
    console.error("[login-alert] PIN alert failed:", err?.message || err);
  }
}
