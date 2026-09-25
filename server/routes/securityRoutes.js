import express from "express";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  getSecurityState,
  recordSecurityFailure,
  recordSecuritySuccess,
  notifyPermanentSecurityLock,
} from "../utils/accountSecurity.js";

const router = express.Router();

// GET /api/security
router.get("/", protect, async (req, res) => {
  const user = await User.findById(req.user._id).select("+appPinHash");

  res.json({
    hasPin: Boolean(user?.appPinHash),
    autoLockSeconds: Number(user?.autoLockSeconds ?? 300),
    biometricEnabled: Boolean(user?.biometricEnabled),
    securityLockLevel: Number(user?.securityLockLevel ?? 0),
    securityLockedUntil: user?.securityLockedUntil || null,
    securityLockedPermanently: Boolean(user?.securityLockedPermanently),
  });
});

// PUT /api/security/auto-lock
router.put("/auto-lock", protect, async (req, res) => {
  const seconds = Number(req.body?.seconds);
  const allowed = [0, 60, 300, 600, 900, 1800, 3600];

  if (!Number.isInteger(seconds) || !allowed.includes(seconds)) {
    return res.status(400).json({ message: "Invalid auto-lock setting." });
  }

  req.user.autoLockSeconds = seconds;
  await req.user.save();

  res.json({ autoLockSeconds: seconds });
});

// PUT /api/security/biometric
router.put("/biometric", protect, async (req, res) => {
  const enabled = req.body?.enabled;

  if (typeof enabled !== "boolean") {
    return res.status(400).json({ message: "Biometric setting must be true or false." });
  }

  req.user.biometricEnabled = enabled;
  await req.user.save();

  res.json({ biometricEnabled: enabled });
});

// POST /api/security/pin
// First-time setup: { pin, confirmPin }
// Change: { currentPin, pin, confirmPin }
router.post("/pin", protect, async (req, res) => {
  const { currentPin, pin, confirmPin } = req.body || {};

  const member = await User.findById(req.user._id).select("+appPinHash");

  if (!member) {
    return res.status(404).json({ message: "Account not found." });
  }

  const hadPin = Boolean(member.appPinHash);

  if (
    !/^\d{6}$/.test(String(pin || "")) ||
    String(pin) !== String(confirmPin || "")
  ) {
    return res.status(400).json({
      message: "PIN must be exactly 6 digits and both PINs must match.",
    });
  }

  if (!member.appPinHash) {
    if (currentPin) {
      return res.status(400).json({
        message: "This account has no existing app PIN.",
      });
    }
  } else {
    if (!/^\d{6}$/.test(String(currentPin || ""))) {
      return res.status(400).json({
        message: "Enter your current 6-digit PIN first.",
      });
    }

    const matches = await bcrypt.compare(String(currentPin), member.appPinHash);

    if (!matches) {
      return res.status(401).json({
        code: "INCORRECT_PIN",
        message: "Current PIN is incorrect.",
      });
    }
  }

  member.appPinHash = await bcrypt.hash(String(pin), 12);
  await member.save();

  res.json({
    message: hadPin ? "PIN changed successfully." : "PIN created successfully.",
  });
});

// POST /api/security/pin/verify
// App PIN failures use the same account-level escalation as website password
// failures: 5 failures -> 10 minutes, next 5 -> 30 minutes, next 5 ->
// permanent security lock requiring an administrator to unlock the account.
router.post("/pin/verify", protect, async (req, res) => {
  try {
    const { pin } = req.body || {};

    const member = await User.findById(req.user._id).select(
      "+appPinHash +securityFailedAttempts +securityLockLevel +securityLockedUntil"
    );

    if (!member?.appPinHash) {
      return res.status(400).json({
        code: "PIN_NOT_SET",
        message: "No app PIN has been set for this account.",
      });
    }

    if (!/^\d{6}$/.test(String(pin || ""))) {
      return res.status(400).json({
        message: "PIN must be exactly 6 digits.",
      });
    }

    const securityState = getSecurityState(member);

    if (securityState.permanent) {
      return res.status(403).json({
        code: "ACCOUNT_SECURITY_LOCKED",
        message: "Your account has been locked for security after repeated failed PIN or password attempts. Please contact the cooperative to unlock your account.",
      });
    }

    if (securityState.locked) {
      return res.status(429).json({
        code: "ACCOUNT_TEMPORARILY_LOCKED",
        message: `Too many incorrect attempts. Please try again in ${Math.ceil((new Date(securityState.lockedUntil).getTime() - Date.now()) / 60000)} minutes.`,
        lockedUntil: securityState.lockedUntil,
        securityLockLevel: securityState.level,
      });
    }

    const matches = await bcrypt.compare(String(pin), member.appPinHash);

    if (!matches) {
      const result = await recordSecurityFailure(member);

      if (result.permanent) {
        await notifyPermanentSecurityLock(member);
        return res.status(403).json({
          code: "ACCOUNT_SECURITY_LOCKED",
          message: "Your account has been locked for security after repeated failed PIN or password attempts. Please contact the cooperative to unlock your account.",
        });
      }

      if (result.locked) {
        return res.status(429).json({
          code: "ACCOUNT_TEMPORARILY_LOCKED",
          message: `Too many incorrect attempts. Your account is locked for ${result.lockMinutes} minutes.`,
          lockedUntil: result.lockedUntil,
          securityLockLevel: result.level,
        });
      }

      return res.status(401).json({
        code: "INCORRECT_PIN",
        message: `Incorrect PIN. ${result.remainingAttempts} attempt${result.remainingAttempts === 1 ? "" : "s"} remaining before a temporary lock.`,
        remainingAttempts: result.remainingAttempts,
      });
    }

    await recordSecuritySuccess(member);

    res.json({ valid: true });
  } catch (err) {
    console.error("App PIN verification error:", err);
    res.status(500).json({ message: "Unable to verify your PIN" });
  }
});

export default router;
