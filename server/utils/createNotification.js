import User from "../models/User.js";
import Notification from "../models/Notification.js";
import { sendPushNotification } from "./pushNotification.js";
import { notifyMemberBySms } from "./smsNotify.js";

/**
 * Create the persistent in-app notification and send the same event
 * to the member's registered Expo devices.
 *
 * Push failures are intentionally non-fatal: the database notification
 * must still be created even when a device token is stale or Expo is
 * temporarily unavailable.
 *
 * The SMS copy (when enabled) is fire-and-forget for the same reason: it
 * can never delay or break the action that triggered the notification.
 */
export async function createNotificationAndPush({
  user,
  type,
  title,
  message,
  data,
}) {
  const notification = await Notification.create({
    user,
    type,
    title,
    message,
    ...(data !== undefined ? { data } : {}),
  });

  try {
    const member =
      user && typeof user === "object" && user.pushTokens
        ? user
        : await User.findById(user).select("pushTokens email fullName");

    if (member) {
      await sendPushNotification(member, {
        title,
        body: message,
        data: {
          type,
          ...(data || {}),
        },
      });
    }
  } catch (pushError) {
    console.error("Push notification delivery failed:", pushError);
  }

  // Not awaited on purpose. notifyMemberBySms never throws.
  notifyMemberBySms({ user, type, title, message, data });

  return notification;
}
