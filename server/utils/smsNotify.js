import User from "../models/User.js";
import Membership from "../models/Membership.js";
import { sendSms, normalizeNgPhone } from "../sms.js";

/**
 * SMS copies of in-app notifications.
 *
 * Hooked into createNotificationAndPush(), so every event that already creates
 * an in-app notification (and is already de-duplicated there) can also send ONE
 * SMS, without touching any payment or loan logic.
 *
 * Safety rules:
 *  - OFF unless SMS_NOTIFICATIONS_ENABLED=true.
 *  - Never throws and is never awaited by callers: an SMS failure can not
 *    affect a payment, a loan or a notification.
 *  - Only the notification types in SMS_NOTIFY_TYPES are sent.
 *  - "Submitted" acknowledgements are skipped (the app already shows those).
 *  - Members with User.smsNotifications === false are skipped.
 *  - Contribution reminders are texted only for the frequencies in
 *    SMS_CONTRIBUTION_REMINDER_FREQUENCIES (default "Weekly,Monthly", so
 *    daily savers are reminded in-app/push without a daily SMS bill).
 *  - New sign-in alerts can be switched off with SMS_NEW_DEVICE_ALERTS=false.
 */

const PREFIX = "Exclusive Cooperative: ";
const MAX_LENGTH = 300; // 2 SMS parts at most

const DEFAULT_TYPES = "savings,loan,repayment,withdrawal,dividend,security";

const enabled = () =>
  String(process.env.SMS_NOTIFICATIONS_ENABLED || "").toLowerCase() === "true";

const allowedTypes = () =>
  new Set(
    String(process.env.SMS_NOTIFY_TYPES || DEFAULT_TYPES)
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
  );

// "₦" and curly punctuation are not in the basic SMS alphabet; one such
// character switches the whole message to a format that fits only 70
// characters per part. Keep everything plain ASCII.
export function toSmsText(text) {
  return String(text || "")
    .replace(/₦\s*/g, "NGN ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x20-\x7E\n]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const money = (n) =>
  `NGN ${Number(n || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;

async function phoneFor(userId) {
  const rows = await Membership.find({ user: userId }).select("phone status").lean();
  const ordered = [...rows].sort(
    (a, b) => Number(b.status === "approved") - Number(a.status === "approved")
  );
  for (const row of ordered) {
    const phone = normalizeNgPhone(row.phone);
    if (phone) return phone;
  }
  return null;
}

// A short receipt reads better than the long in-app text.
async function buildText({ userId, type, title, message }) {
  const isSavingsCredit =
    type === "savings" && /(approved|successful)/i.test(title) && !/(rejected|failed)/i.test(title);

  if (isSavingsCredit) {
    const amount = String(message).match(/₦\s*([\d,]+(?:\.\d+)?)/);
    const user = await User.findById(userId).select("savingsBalance").lean();
    if (amount && user) {
      return `Contribution of NGN ${amount[1]} received. Savings balance: ${money(user.savingsBalance)}.`;
    }
  }
  return message;
}

function allowedByKind(data) {
  if (data?.kind === "contribution-reminder") {
    const frequencies = String(process.env.SMS_CONTRIBUTION_REMINDER_FREQUENCIES ?? "Weekly,Monthly")
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
    return frequencies.includes(String(data.frequency));
  }
  if (data?.kind === "new-device") {
    return String(process.env.SMS_NEW_DEVICE_ALERTS ?? "true").toLowerCase() !== "false";
  }
  return true;
}

export async function notifyMemberBySms({ user, type, title, message, data }) {
  try {
    if (!enabled()) return;
    // Reminders are gated by frequency (allowedByKind below), not by type.
    const isReminder = data?.kind === "contribution-reminder";
    if (!isReminder && !allowedTypes().has(String(type))) return;
    if (/submitted/i.test(String(title || ""))) return;
    if (!allowedByKind(data)) return;

    const userId = user?._id ?? user;
    if (!userId) return;

    const member = await User.findById(userId).select("smsNotifications").lean();
    if (!member || member.smsNotifications === false) return;

    const phone = await phoneFor(userId);
    if (!phone) return;

    const body = toSmsText(await buildText({ userId, type, title, message }));
    if (!body) return;

    const text = `${PREFIX}${body}`.slice(0, MAX_LENGTH);
    await sendSms(phone, text);
  } catch (err) {
    // Log the reason only, never the phone number or message.
    console.error("[sms] notification SMS failed:", err?.message || err);
  }
}
