import crypto from "crypto";
import bcrypt from "bcryptjs";
import User from "../models/User.js";

/**
 * USSD activation codes.
 *
 * A member who has no smartphone can't create the app PIN in the mobile app,
 * so USSD would refuse them. Instead, office staff issue a one-time 8-digit
 * activation code (admin dashboard -> member -> "USSD Code"), hand it over in
 * person, and the member dials the USSD code, enters it, and chooses their own
 * 6-digit PIN. Staff never see or choose the PIN.
 *
 * Safeguards:
 *  - Only a bcrypt hash of the code is stored.
 *  - Valid for 48 hours and for ONE use.
 *  - Only works from the phone number registered on the member's membership
 *    (the USSD route looks the member up by phone number).
 *  - 5 wrong codes cancel it, and the office must issue a new one.
 *  - Obvious PINs (123456, 111111, ...) are refused.
 *
 * Issuing a code for a member who already has a PIN lets the office reset a
 * forgotten PIN in person.
 */

export const ACTIVATION_TTL_HOURS = 48;
const MAX_FAILURES = 5;
const CLEAR = { ussdActivationHash: "", ussdActivationExpires: "", ussdActivationFailures: "" };

export async function issueActivation(userId) {
  const code = String(crypto.randomInt(10_000_000, 100_000_000)); // always 8 digits
  const expiresAt = new Date(Date.now() + ACTIVATION_TTL_HOURS * 3600 * 1000);

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        ussdActivationHash: await bcrypt.hash(code, 10),
        ussdActivationExpires: expiresAt,
        ussdActivationFailures: 0,
      },
    }
  );
  return { code, expiresAt };
}

/** Returns { ok: true, hadPin } or { ok: false, message } (an END text). */
export async function checkActivation(userId, code) {
  const user = await User.findById(userId).select(
    "+appPinHash +ussdActivationHash +ussdActivationExpires +ussdActivationFailures"
  );

  if (!user?.ussdActivationHash || !user.ussdActivationExpires || new Date(user.ussdActivationExpires) <= new Date()) {
    return { ok: false, message: "This activation code is not valid or has expired. Please visit the cooperative office." };
  }

  const matches = await bcrypt.compare(String(code), user.ussdActivationHash);
  if (!matches) {
    const failures = Number(user.ussdActivationFailures || 0) + 1;
    if (failures >= MAX_FAILURES) {
      await User.updateOne({ _id: userId }, { $unset: CLEAR });
      return { ok: false, message: "Too many wrong codes. This code is cancelled. Please visit the cooperative office." };
    }
    await User.updateOne({ _id: userId }, { $inc: { ussdActivationFailures: 1 } });
    const left = MAX_FAILURES - failures;
    return { ok: false, message: `Wrong activation code. ${left} attempt${left === 1 ? "" : "s"} left.` };
  }

  return { ok: true, hadPin: Boolean(user.appPinHash) };
}

/** Sets the member's chosen PIN and uses up the code. */
export async function completeActivation(userId, pin) {
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        appPinHash: await bcrypt.hash(String(pin), 12), // same cost as the app
        securityFailedAttempts: 0,
        appPinFailedAttempts: 0,
        appPinLockedUntil: null,
      },
      $unset: CLEAR,
    }
  );
}

const SEQUENCE = "01234567890123456789";
const REVERSE = "98765432109876543210";

/** True for PINs that are trivially guessable. */
export function isWeakPin(pin) {
  const p = String(pin);
  if (!/^\d{6}$/.test(p)) return true;
  if (/^(\d)\1{5}$/.test(p)) return true; // 111111
  if (SEQUENCE.includes(p) || REVERSE.includes(p)) return true; // 123456, 654321, 567890
  if (/^(\d{3})\1$/.test(p) || /^(\d{2})\1\1$/.test(p)) return true; // 123123, 121212
  return false;
}
