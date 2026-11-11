import Membership from "../models/Membership.js";
import User from "../models/User.js";
import { normalizeNgPhone } from "../sms.js";

/**
 * Helpers for who a member is: phone numbers, date of birth / age, and finding
 * the right account when someone signs in with an email, a phone number or a
 * name.
 */

export const MIN_AGE = 18;
const MAX_AGE = 110;

// ---- phone numbers -----------------------------------------------------------

/** The 10 significant digits of a Nigerian number (0803..., +234803... -> 803...). */
export const phoneKey = (value) => String(value || "").replace(/\D/g, "").slice(-10);

/** Stored form: +234XXXXXXXXXX. Returns null when it is not a Nigerian number. */
export const toStoredPhone = (value) => normalizeNgPhone(value);

// Membership.phone is free text ("0803 123 4567", "+234-803..."), so match the
// 10 significant digits while ignoring separators, then double-check.
const membershipPhonePattern = (key) =>
  new RegExp(`${key.split("").join("\\D*")}\\D*$`);

async function userIdsForPhone(key) {
  if (key.length < 10) return [];

  const ids = new Set();

  const users = await User.find({ phone: `+234${key}` }).select("_id").limit(5).lean();
  users.forEach((u) => ids.add(String(u._id)));

  const memberships = await Membership.find({
    user: { $ne: null },
    phone: { $regex: membershipPhonePattern(key) },
  })
    .select("user phone")
    .limit(10)
    .lean();
  memberships
    .filter((m) => phoneKey(m.phone) === key)
    .forEach((m) => ids.add(String(m.user)));

  return [...ids];
}

/** True when another account (or its membership form) already uses this number. */
export async function phoneAlreadyUsed(storedPhone) {
  const key = phoneKey(storedPhone);
  return (await userIdsForPhone(key)).length > 0;
}

// ---- date of birth and age ---------------------------------------------------

const DOB_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "YYYY-MM-DD" -> { y, mo, d, date } or null for anything that is not a real date. */
export function parseDateOfBirth(value) {
  const match = DOB_PATTERN.exec(String(value || "").trim());
  if (!match) return null;

  const y = Number(match[1]);
  const mo = Number(match[2]);
  const d = Number(match[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));

  // Rejects dates such as 2001-02-30 that JavaScript would roll over.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return { y, mo, d, date };
}

// Today's date as people in Lagos read it.
function todayInLagos() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Lagos",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  return { y: Number(parts.year), mo: Number(parts.month), d: Number(parts.day) };
}

export function ageOn({ y, mo, d }, today = todayInLagos()) {
  let age = today.y - y;
  if (today.mo < mo || (today.mo === mo && today.d < d)) age -= 1;
  return age;
}

/**
 * Checks a date of birth sent by a client.
 * @returns {{ ok: true, date: Date, age: number } | { ok: false, code: string, message: string }}
 */
export function checkDateOfBirth(value) {
  const parsed = parseDateOfBirth(value);
  if (!parsed) {
    return { ok: false, code: "DOB_INVALID", message: "Enter a valid date of birth." };
  }

  const today = todayInLagos();
  if (Date.UTC(parsed.y, parsed.mo - 1, parsed.d) > Date.UTC(today.y, today.mo - 1, today.d)) {
    return { ok: false, code: "DOB_INVALID", message: "Date of birth cannot be in the future." };
  }

  const age = ageOn(parsed, today);
  if (age > MAX_AGE) {
    return { ok: false, code: "DOB_INVALID", message: "Enter a valid date of birth." };
  }
  if (age < MIN_AGE) {
    return {
      ok: false,
      code: "UNDERAGE",
      message: `You must be at least ${MIN_AGE} years old to register.`,
    };
  }

  return { ok: true, date: parsed.date, age };
}

// ---- finding the account that is signing in ------------------------------------

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Works out which account a sign-in belongs to from what the person typed:
 *   - an email address (anyone, including staff),
 *   - a phone number (members only; must match exactly one member),
 *   - a full name (members only; must match exactly ONE member, because names
 *     are not unique).
 * Returns the user's id, or null when nothing matches or the match is not
 * unique. Callers must answer "not found" and "not unique" the same way.
 */
export async function findLoginUserId(identifier) {
  const raw = String(identifier || "").trim().slice(0, 120);
  if (!raw) return null;

  if (raw.includes("@")) {
    const user = await User.findOne({ email: raw.toLowerCase() }).select("_id").lean();
    return user ? user._id : null;
  }

  const digits = raw.replace(/\D/g, "");
  if (/^[+\d][\d\s().-]*$/.test(raw) && digits.length >= 10) {
    const ids = await userIdsForPhone(phoneKey(raw));
    if (!ids.length) return null;

    const members = await User.find({ _id: { $in: ids }, role: "member" }).select("_id").lean();
    return members.length === 1 ? members[0]._id : null;
  }

  const words = raw.split(/\s+/).filter(Boolean);
  if (!words.length) return null;

  const exactName = new RegExp(`^\\s*${words.map(escapeRegex).join("\\s+")}\\s*$`, "i");
  const matches = await User.find({ role: "member", fullName: exactName })
    .select("_id")
    .limit(2)
    .lean();

  return matches.length === 1 ? matches[0]._id : null;
}
