import express from "express";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import Notification from "../models/Notification.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();
const MAX_PIN_ATTEMPTS_BEFORE_ALERT = 5;
const PIN_RETRY_LOCK_MS = 15 * 60 * 1000;

async function alertAdminsAboutPin(member) {
  const admins = await User.find({ role: "admin", isBlocked: false }).select("_id");
  if (!admins.length) return;

  await Notification.insertMany(
    admins.map((admin) => ({
      user: admin._id,
      type: "security",
      title: "Suspicious PIN Activity",
      message:
        `${member.fullName || member.email} has entered an incorrect app PIN ` +
        `${MAX_PIN_ATTEMPTS_BEFORE_ALERT} times. Review the account and block it if necessary.`,
    })),
  );
}

// GET /api/security
router.get("/", protect, async (req, res) => {
  const user = await User.findById(req.user._id).select(
    "+appPinHash +appPinLockedUntil",
  );

  res.json({
    hasPin: Boolean(user?.appPinHash),
    autoLockSeconds: Number(user?.autoLockSeconds ?? 300),
    biometricEnabled: Boolean(user?.biometricEnabled),
    pinLockedUntil: user?.appPinLockedUntil || null,
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
  const member = await User.findById(req.user._id).select(
    "+appPinHash +appPinFailedAttempts +appPinLockedUntil +appPinSecurityAlertedAt",
  );

  if (!member) return res.status(404).json({ message: "Account not found." });

  const hadPin = Boolean(member.appPinHash);

  if (!/^\d{6}$/.test(String(pin || "")) || String(pin) !== String(confirmPin || "")) {
    return res.status(400).json({ message: "PIN must be exactly 6 digits and both PINs must match." });
  }

  if (!member.appPinHash) {
    if (currentPin) {
      return res.status(400).json({ message: "This account has no existing app PIN." });
    }
  } else {
    if (!/^\d{6}$/.test(String(currentPin || ""))) {
      return res.status(400).json({ message: "Enter your current 6-digit PIN first." });
    }

    if (member.appPinLockedUntil && member.appPinLockedUntil > new Date()) {
      return res.status(429).json({
        code: "PIN_TEMPORARILY_LOCKED",
        message: "PIN changes are temporarily locked after too many incorrect attempts. Please try again later.",
        lockedUntil: member.appPinLockedUntil,
      });
    }

    const matches = await bcrypt.compare(String(currentPin), member.appPinHash);
    if (!matches) {
      member.appPinFailedAttempts = Number(member.appPinFailedAttempts || 0) + 1;

      if (member.appPinFailedAttempts >= MAX_PIN_ATTEMPTS_BEFORE_ALERT) {
        member.appPinLockedUntil = new Date(Date.now() + PIN_RETRY_LOCK_MS);

        const alreadyAlertedRecently =
          member.appPinSecurityAlertedAt &&
          Date.now() - new Date(member.appPinSecurityAlertedAt).getTime() < PIN_RETRY_LOCK_MS;

        if (!alreadyAlertedRecently) {
          member.appPinSecurityAlertedAt = new Date();
          await member.save();
          try {
            await alertAdminsAboutPin(member);
          } catch (notificationError) {
            console.error("PIN security alert failed:", notificationError);
          }
        } else {
          await member.save();
        }

        return res.status(429).json({
          code: "PIN_SECURITY_ALERT",
          message: "Too many incorrect PIN attempts. Your PIN actions are temporarily locked and the cooperative administrator has been alerted.",
        });
      }

      await member.save();
      return res.status(401).json({
        code: "INCORRECT_PIN",
        message: "Current PIN is incorrect.",
        attemptsRemaining: Math.max(0, MAX_PIN_ATTEMPTS_BEFORE_ALERT - member.appPinFailedAttempts),
      });
    }
  }

  member.appPinHash = await bcrypt.hash(String(pin), 12);
  member.appPinFailedAttempts = 0;
  member.appPinLockedUntil = null;
  member.appPinSecurityAlertedAt = null;
  await member.save();

  res.json({ message: hadPin ? "PIN changed successfully." : "PIN created successfully." });
});

// POST /api/security/pin/verify
router.post("/pin/verify", protect, async (req, res) => {
  const { pin } = req.body || {};
  const member = await User.findById(req.user._id).select(
    "+appPinHash +appPinFailedAttempts +appPinLockedUntil +appPinSecurityAlertedAt",
  );

  if (!member?.appPinHash) {
    return res.status(400).json({ code: "PIN_NOT_SET", message: "No app PIN has been set for this account." });
  }

  if (!/^\d{6}$/.test(String(pin || ""))) {
    return res.status(400).json({ message: "PIN must be exactly 6 digits." });
  }

  if (member.appPinLockedUntil && member.appPinLockedUntil > new Date()) {
    return res.status(429).json({
      code: "PIN_TEMPORARILY_LOCKED",
      message: "Too many incorrect PIN attempts. Please try again later.",
      lockedUntil: member.appPinLockedUntil,
    });
  }

  const matches = await bcrypt.compare(String(pin), member.appPinHash);
  if (!matches) {
    member.appPinFailedAttempts = Number(member.appPinFailedAttempts || 0) + 1;

    if (member.appPinFailedAttempts >= MAX_PIN_ATTEMPTS_BEFORE_ALERT) {
      member.appPinLockedUntil = new Date(Date.now() + PIN_RETRY_LOCK_MS);
      const alreadyAlertedRecently =
        member.appPinSecurityAlertedAt &&
        Date.now() - new Date(member.appPinSecurityAlertedAt).getTime() < PIN_RETRY_LOCK_MS;

      if (!alreadyAlertedRecently) {
        member.appPinSecurityAlertedAt = new Date();
        await member.save();
        try {
          await alertAdminsAboutPin(member);
        } catch (notificationError) {
          console.error("PIN security alert failed:", notificationError);
        }
      } else {
        await member.save();
      }

      return res.status(429).json({
        code: "PIN_SECURITY_ALERT",
        message: "Too many incorrect PIN attempts. The cooperative administrator has been alerted.",
      });
    }

    await member.save();
    return res.status(401).json({
      code: "INCORRECT_PIN",
      message: "Incorrect PIN. Please try again.",
      attemptsRemaining: Math.max(0, MAX_PIN_ATTEMPTS_BEFORE_ALERT - member.appPinFailedAttempts),
    });
  }

  member.appPinFailedAttempts = 0;
  member.appPinLockedUntil = null;
  member.appPinSecurityAlertedAt = null;
  await member.save();

  res.json({ valid: true });
});

export default router;
