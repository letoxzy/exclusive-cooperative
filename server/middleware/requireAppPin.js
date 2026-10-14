import bcrypt from "bcryptjs";
import User from "../models/User.js";
import {
  getSecurityState,
  recordSecurityFailure,
  recordSecuritySuccess,
  notifyPermanentSecurityLock,
} from "../utils/accountSecurity.js";

const MOBILE_PLATFORMS = new Set(["android", "ios"]);

/**
 * Asks the mobile app for the member's 6-digit app PIN before a sensitive
 * action. Mount AFTER `protect` and BEFORE `idempotent(...)`, so a wrong PIN is
 * never stored as the answer for the request's Idempotency-Key.
 *
 * - Only enforced for requests from the mobile app (X-App-Platform: android|ios).
 *   The website has no app PIN and is unchanged.
 * - Uses the same failure counter and lock levels as /security/pin/verify.
 * - The PIN is removed from req.body once checked, so it is never hashed,
 *   stored or logged downstream.
 * - Set LOAN_REQUIRE_PIN=false to switch the check off.
 */
export const requireAppPin = (flag = "LOAN_REQUIRE_PIN") => async (req, res, next) => {
  try {
    if (String(process.env[flag] ?? "true").toLowerCase() === "false") return next();

    const platform = String(req.get("X-App-Platform") || "").toLowerCase();
    if (!MOBILE_PLATFORMS.has(platform)) return next();

    const pin = String(req.body?.pin ?? "");
    if (req.body) delete req.body.pin;

    const member = await User.findById(req.user._id).select(
      "+appPinHash +securityFailedAttempts +securityLockLevel +securityLockedUntil +securityLockedPermanently"
    );

    if (!member?.appPinHash) {
      return res.status(400).json({
        code: "PIN_NOT_SET",
        message: "Create your 6-digit app PIN before applying for a loan.",
      });
    }

    if (!/^\d{6}$/.test(pin)) {
      return res.status(400).json({
        code: "PIN_REQUIRED",
        message: "Enter your 6-digit PIN to continue.",
      });
    }

    const state = getSecurityState(member);
    if (state.permanent) {
      return res.status(403).json({
        code: "ACCOUNT_SECURITY_LOCKED",
        message:
          "Your account has been locked for security after repeated failed PIN or password attempts. Please contact the cooperative to unlock your account.",
      });
    }
    if (state.locked) {
      return res.status(429).json({
        code: "ACCOUNT_TEMPORARILY_LOCKED",
        message: `Too many incorrect attempts. Please try again in ${Math.max(
          1,
          Math.ceil((new Date(state.lockedUntil).getTime() - Date.now()) / 60000)
        )} minutes.`,
        lockedUntil: state.lockedUntil,
      });
    }

    const ok = await bcrypt.compare(pin, member.appPinHash);
    if (!ok) {
      const result = await recordSecurityFailure(member);
      if (result.permanent) {
        await notifyPermanentSecurityLock(member);
        return res.status(403).json({
          code: "ACCOUNT_SECURITY_LOCKED",
          message:
            "Your account has been locked for security after repeated failed PIN or password attempts. Please contact the cooperative to unlock your account.",
        });
      }
      if (result.locked) {
        return res.status(429).json({
          code: "ACCOUNT_TEMPORARILY_LOCKED",
          message: `Too many incorrect attempts. Your account is locked for ${result.lockMinutes} minutes.`,
          lockedUntil: result.lockedUntil,
        });
      }
      return res.status(401).json({
        code: "INCORRECT_PIN",
        message: `Incorrect PIN. ${result.remainingAttempts} attempt${
          result.remainingAttempts === 1 ? "" : "s"
        } remaining before a temporary lock.`,
        remainingAttempts: result.remainingAttempts,
      });
    }

    await recordSecuritySuccess(member);
    return next();
  } catch (err) {
    console.error("App PIN check error:", err);
    return res.status(500).json({ message: "Unable to verify your PIN" });
  }
};
