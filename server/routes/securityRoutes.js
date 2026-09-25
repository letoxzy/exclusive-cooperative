import express from "express";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// GET /api/security
router.get("/", protect, async (req, res) => {
  const user = await User.findById(req.user._id).select(
    "+appPinHash +appPinFailedAttempts +appPinLockedUntil",
  );

  res.json({
    hasPin: Boolean(user?.appPinHash),
    autoLockSeconds: Number(user?.autoLockSeconds ?? 300),
    biometricEnabled: Boolean(user?.biometricEnabled),
    pinLockedUntil: user?.appPinLockedUntil || null,
    pinFailedAttempts: Number(user?.appPinFailedAttempts || 0),
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
    "+appPinHash +appPinFailedAttempts +appPinLockedUntil",
  );

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
  member.appPinFailedAttempts = 0;
  member.appPinLockedUntil = null;
  await member.save();

  res.json({
    message: hadPin ? "PIN changed successfully." : "PIN created successfully.",
  });
});

// POST /api/security/pin/verify
// The server is the source of truth for consecutive failed attempts and lockouts.
// Biometric unlock uses the same lock timestamp and therefore cannot bypass it.
router.post("/pin/verify", protect, async (req, res) => {
  const { pin } = req.body || {};
  const member = await User.findById(req.user._id).select(
    "+appPinHash +appPinFailedAttempts +appPinLockedUntil",
  );

  if (!member?.appPinHash) {
    return res.status(400).json({
      code: "PIN_NOT_SET",
      message: "No app PIN has been set for this account.",
    });
  }

  if (!/^\d{6}$/.test(String(pin || ""))) {
    return res.status(400).json({
      code: "INVALID_PIN",
      message: "PIN must be exactly 6 digits.",
    });
  }

  const now = new Date();
  if (member.appPinLockedUntil && member.appPinLockedUntil > now) {
    return res.status(429).json({
      code: "PIN_LOCKED",
      message: "Your account has been temporarily locked for security.",
      lockedUntil: member.appPinLockedUntil,
    });
  }

  // A lock has expired. Keep the failed-attempt count so the next group of
  // failures moves to the next lock duration.
  if (member.appPinLockedUntil && member.appPinLockedUntil <= now) {
    member.appPinLockedUntil = null;
  }

  const matches = await bcrypt.compare(String(pin), member.appPinHash);

  if (!matches) {
    const failed = Number(member.appPinFailedAttempts || 0) + 1;
    member.appPinFailedAttempts = failed;

    let lockMinutes = 0;
    if (failed >= 10) lockMinutes = 24 * 60;
    else if (failed >= 7) lockMinutes = 60;
    else if (failed >= 4) lockMinutes = 30;
    else if (failed >= 1) lockMinutes = 10;

    member.appPinLockedUntil = new Date(Date.now() + lockMinutes * 60 * 1000);
    await member.save();

    const remainingInGroup = 3 - ((failed - 1) % 3);
    return res.status(401).json({
      code: "INCORRECT_PIN",
      message:
        failed >= 10
          ? "Too many incorrect PIN attempts. Your account is locked for 24 hours."
          : `Incorrect PIN. ${remainingInGroup} attempt${remainingInGroup === 1 ? "" : "s"} remaining before the next security lock.`,
      lockedUntil: member.appPinLockedUntil,
      failedAttempts: failed,
      lockMinutes,
    });
  }

  member.appPinFailedAttempts = 0;
  member.appPinLockedUntil = null;
  await member.save();

  res.json({ valid: true });
});

export default router;
