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
  "password-changed": {
    title: "Password Changed",
    message: () => `Your account password was changed. ${CONTACT}`,
  },
  "password-reset": {
    title: "Password Reset",
    message: () => `Your account password was reset. ${CONTACT}`,
  },
  "new-device": {
    title: "New Sign-in",
    message: ({ label, when }) =>
      `New sign-in to your account on ${label} at ${when}. If this was not you, change your password and contact the cooperative immediately.`,
  },
};

export async function alertSecurityChange(userId, kind, details = {}) {
  try {
    const alert = ALERTS[kind];
    if (!alert || !userId) return;

    await createNotificationAndPush({
      user: userId,
      type: "security",
      title: alert.title,
      message: alert.message(details),
      data: { kind },
    });
  } catch (err) {
    console.error("[security-alert] failed:", err?.message || err);
  }
}
