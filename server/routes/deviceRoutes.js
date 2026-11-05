import express from "express";
import User from "../models/User.js";
import { protect } from "../middleware/authMiddleware.js";
import generateToken from "../utils/generateToken.js";
import { describeDevice, deviceKind } from "../utils/deviceTracker.js";
import { alertSecurityChange } from "../utils/securityAlerts.js";
import {
  getSecurityState,
  recordSecurityFailure,
  recordSecuritySuccess,
  notifyPermanentSecurityLock,
} from "../utils/accountSecurity.js";

/**
 * "My devices" (mobile app: Profile -> Security -> My devices).
 *
 *   GET  /api/devices                    devices that have signed in
 *   POST /api/devices/sign-out-others    { password }  ends every other session
 *
 * The list comes from the sign-in tracking in utils/deviceTracker.js, so it
 * shows when each device LAST SIGNED IN (not live activity), and only devices
 * that signed in since that tracking was added.
 *
 * "Sign out other devices" works by stamping User.sessionsValidAfter; the auth
 * middleware then rejects every login token issued before that moment. This
 * phone gets a fresh token in the response so it stays signed in.
 */

const router = express.Router();

// Checks the account password with the same lock-out rules as sign-in.
// Returns the user when it is right; otherwise sends the response and returns null.
async function confirmPassword(req, res) {
  const password = String(req.body?.password || "");
  if (!password) {
    res.status(400).json({ message: "Enter your password to confirm." });
    return null;
  }

  const user = await User.findById(req.user._id).select(
    "+securityFailedAttempts +securityLockLevel +securityLockedUntil +securityLockedPermanently"
  );
  if (!user) {
    res.status(404).json({ message: "User no longer exists" });
    return null;
  }

  const state = getSecurityState(user);
  if (state.permanent) {
    res.status(403).json({
      code: "ACCOUNT_SECURITY_LOCKED",
      message:
        "Your account has been locked for security after repeated failed attempts. Please contact the cooperative to unlock your account.",
    });
    return null;
  }
  if (state.locked) {
    res.status(429).json({
      code: "ACCOUNT_TEMPORARILY_LOCKED",
      message: `Too many incorrect attempts. Please try again in ${Math.ceil(
        (new Date(state.lockedUntil).getTime() - Date.now()) / 60000
      )} minutes.`,
      lockedUntil: state.lockedUntil,
    });
    return null;
  }

  if (!(await user.matchPassword(password))) {
    const result = await recordSecurityFailure(user);
    if (result.permanent) {
      await notifyPermanentSecurityLock(user);
      res.status(403).json({
        code: "ACCOUNT_SECURITY_LOCKED",
        message:
          "Your account has been locked for security after repeated failed attempts. Please contact the cooperative to unlock your account.",
      });
    } else if (result.locked) {
      res.status(429).json({
        code: "ACCOUNT_TEMPORARILY_LOCKED",
        message: `Too many incorrect attempts. Your account is locked for ${result.lockMinutes} minutes.`,
        lockedUntil: result.lockedUntil,
      });
    } else {
      res.status(401).json({ message: "That password is not correct." });
    }
    return null;
  }

  await recordSecuritySuccess(user);
  return user;
}

// GET /api/devices
router.get("/", protect, async (req, res) => {
  try {
    const current = describeDevice(req);
    const stored = await User.findById(req.user._id).select("+knownDevices").lean();

    const devices = (stored?.knownDevices || []).map((d) => ({
      id: d.id,
      name: d.label,
      kind: deviceKind(d.label),
      firstSeen: d.firstSeen || null,
      lastSeen: d.lastSeen || null,
      current: d.id === current.id,
    }));

    // The phone asking is always shown, even if it signed in before the
    // tracking existed.
    if (!devices.some((d) => d.current)) {
      devices.push({
        id: current.id,
        name: current.label,
        kind: deviceKind(current.label),
        firstSeen: null,
        lastSeen: new Date().toISOString(),
        current: true,
      });
    }

    devices.sort(
      (a, b) =>
        Number(b.current) - Number(a.current) ||
        new Date(b.lastSeen || 0).getTime() - new Date(a.lastSeen || 0).getTime()
    );

    res.setHeader("Cache-Control", "no-store");
    return res.json({ devices });
  } catch (err) {
    console.error("List devices error:", err);
    return res.status(500).json({ message: "Unable to load your devices." });
  }
});

// POST /api/devices/sign-out-others   { password }
router.post("/sign-out-others", protect, async (req, res) => {
  try {
    // The website keeps its session in a cookie that this response can not
    // refresh, so this action is for the mobile app (Bearer token) only.
    if (!req.headers.authorization?.startsWith("Bearer ")) {
      return res.status(400).json({ message: "This action is available in the mobile app." });
    }

    const user = await confirmPassword(req, res);
    if (!user) return;

    // Whole-second precision: JWT "iat" is in seconds, so the fresh token
    // issued below is not older than this moment and stays valid.
    const validAfter = new Date(Math.floor(Date.now() / 1000) * 1000);

    // Forget the other devices, so signing in from one of them again triggers
    // a new-sign-in alert.
    const current = describeDevice(req);
    const stored = await User.findById(user._id).select("+knownDevices").lean();
    const keep = (stored?.knownDevices || []).filter((d) => d.id === current.id);
    if (!keep.length) {
      const now = new Date();
      keep.push({ id: current.id, label: current.label, firstSeen: now, lastSeen: now });
    }

    await User.updateOne(
      { _id: user._id },
      { $set: { sessionsValidAfter: validAfter, knownDevices: keep } }
    );

    void alertSecurityChange(user._id, "other-devices-signed-out");

    res.setHeader("Cache-Control", "no-store");
    return res.json({
      message: "All other devices have been signed out.",
      token: generateToken(user._id),
    });
  } catch (err) {
    console.error("Sign out other devices error:", err);
    return res.status(500).json({ message: "Unable to sign out other devices." });
  }
});

export default router;
