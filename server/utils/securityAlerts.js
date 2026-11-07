import { createNotificationAndPush } from "./createNotification.js";

/**
 * Security alerts: PIN / password changes and new-device sign-ins.
 * They go through createNotificationAndPush, so the member gets an in-app
 * notification, a push, and (when enabled) an SMS.
 *
 * alertSecurityChange never throws and callers should NOT await it
 * (`void alertSecurityChange(...)`), so an alert problem can never break a
 * password change, PIN change or login.
 */

const CONTACT = "If this was not you, contact the cooperative immediately.";

const ALERTS = {
  "pin-created": {
    title: "App PIN Created",
    message: () => `Your app PIN was set. ${CONTACT}`,
  },
  "pin-changed": {
    title: "App PIN Changed",
    message: () => `Your app PIN was changed. ${CONTACT}`,
  },
  "withdrawal-pin-created": {
    title: "Withdrawal PIN Created",
    message: () => `A withdrawal PIN was set on your account. ${CONTACT}`,
  },
  "password-changed": {
    title: "Password Changed",
    message: () => `Your account password was changed. ${CONTACT}`,
  },
  "password-reset": {
    title: "Password Reset",
    message: () => `Your account password was reset. ${CONTACT}`,
  },
  "other-devices-signed-out": {
    title: "Other Devices Signed Out",
    message: () =>
      "All your other devices were signed out of your account. If this was not you, change your password and contact the cooperative immediately.",
  },
  "new-device": {
    title: "New Sign-in",
    message: ({ label, when }) =>
      `New sign-in to your account on ${label} at ${when}. If this was not you, change your password and contact the cooperative immediately.`,
  },
  login: {
    title: ({ channel }) => (channel === "mobile" ? "Mobile App Login" : "Website Login"),
    message: ({ name, channel, when, label }) =>
      `Dear ${name || "Member"}, this is to notify you of a successful login on the Exclusive Cooperative ${
        channel === "mobile" ? "mobile app" : "website"
      } on ${when}${label ? ` (${label})` : ""}. If you did not initiate this session, change your password and contact the cooperative immediately.`,
  },
};

export async function alertSecurityChange(userId, kind, details = {}) {
  try {
    const alert = ALERTS[kind];
    if (!alert || !userId) return;

    await createNotificationAndPush({
      user: userId,
      type: "security",
      title: typeof alert.title === "function" ? alert.title(details) : alert.title,
      message: alert.message(details),
      data: { kind },
    });
  } catch (err) {
    console.error("[security-alert] failed:", err?.message || err);
  }
}