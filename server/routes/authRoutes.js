import express from "express";
import crypto from "crypto";
import User from "../models/User.js";
import generateToken from "../utils/generateToken.js";
import { protect } from "../middleware/authMiddleware.js";
import { adminAccessPayload } from "../utils/adminPermissions.js";
import {
  checkDateOfBirth,
  findLoginUserId,
  phoneAlreadyUsed,
  toStoredPhone,
} from "../utils/memberIdentity.js";
import { validatePassword } from "../utils/passwordPolicy.js";
import { recordLoginDevice } from "../utils/deviceTracker.js";
import {
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_RESENDS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_EXPIRY_MS,
  clearLoginOtp,
  codeMatches,
  createLoginOtp,
  loginOtpRequiredFor,
  otpChallengeResponse,
  readChallenge,
  sendLoginOtpEmail,
} from "../utils/loginOtp.js";
import { alertSecurityChange } from "../utils/securityAlerts.js";
import {
  getSecurityState,
  recordSecurityFailure,
  recordSecuritySuccess,
  notifyPermanentSecurityLock,
} from "../utils/accountSecurity.js";

const router = express.Router();

const PASSWORD_RESET_EXPIRY_MS = 60 * 60 * 1000;
const PASSWORD_RESET_MESSAGE =
  "If an account exists for that email, a password reset link has been sent.";

const hashResetToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

// Sends the JWT as an httpOnly cookie so the website never has to store
// it in JavaScript-readable storage. The JSON response still includes the
// token for the mobile app, which keeps using the Bearer header.
const isProduction = process.env.NODE_ENV === "production";

const authCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  // "none" is required for cross-site cookies (Vercel website -> Render API);
  // it requires secure: true, which is why both are production-only.
  sameSite: isProduction ? "none" : "lax",
  maxAge: 30 * 24 * 60 * 60 * 1000, // matches the 30-day JWT lifetime
};

const setAuthCookie = (res, token) => {
  res.cookie("token", token, authCookieOptions);
};

const sendPasswordResetEmail = async ({ email, link }) => {
  const { EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY, EMAILJS_PRIVATE_KEY } =
    process.env;

  if (!EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID || !EMAILJS_PUBLIC_KEY) {
    throw new Error("Password reset email service is not configured");
  }

  const body = {
    service_id: EMAILJS_SERVICE_ID,
    template_id: EMAILJS_TEMPLATE_ID,
    user_id: EMAILJS_PUBLIC_KEY,
    template_params: {
      email,
      link,
    },
  };

  if (EMAILJS_PRIVATE_KEY) {
    body.accessToken = EMAILJS_PRIVATE_KEY;
  }

  const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Unable to send password reset email");
  }
};

// POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    const { password, phone, dateOfBirth } = req.body;
    const fullName = String(req.body?.fullName || "").trim().replace(/\s+/g, " ");
    const email = String(req.body?.email || "").trim().toLowerCase();

    if (!fullName || !email || !password || !phone || !dateOfBirth) {
      return res.status(400).json({
        message: "Full name, email, phone number, date of birth and password are required",
      });
    }

    if (fullName.length < 2) {
      return res.status(400).json({ message: "Enter your full name." });
    }

    const storedPhone = toStoredPhone(phone);
    if (!storedPhone) {
      return res.status(400).json({ message: "Enter a valid Nigerian phone number." });
    }

    // The age rule is enforced here, on the server, so it cannot be bypassed
    // by editing the website or the app.
    const dob = checkDateOfBirth(dateOfBirth);
    if (!dob.ok) {
      return res.status(400).json({ code: dob.code, message: dob.message });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ message: passwordError });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: "An account with this email already exists" });
    }

    if (await phoneAlreadyUsed(storedPhone)) {
      return res.status(400).json({
        message: "An account with this phone number already exists. Try logging in instead.",
      });
    }

    const user = await User.create({
      fullName,
      email,
      password,
      phone: storedPhone,
      dateOfBirth: dob.date,
    });

    const token = generateToken(user._id);
    setAuthCookie(res, token);

    res.status(201).json({
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      savingsBalance: user.savingsBalance,
      contributionFrequency: user.contributionFrequency,
      avatarUrl: user.avatarUrl,
      isApprovedMember: user.isApprovedMember,
      mustChangePassword: user.mustChangePassword,
      isBlocked: user.isBlocked,
      hasAppPin: Boolean(user.appPinHash),
      autoLockSeconds: user.autoLockSeconds,
      biometricEnabled: user.biometricEnabled,
      createdAt: user.createdAt,
      token,
    });
  } catch (err) {
    if (err?.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0];
      return res.status(400).json({
        message:
          field === "phone"
            ? "An account with this phone number already exists. Try logging in instead."
            : "An account with this email already exists",
      });
    }
    res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/forgot-password
router.post("/forgot-password", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();

    if (!email) {
      return res.status(400).json({ message: "Email address is required" });
    }

    const user = await User.findOne({ email }).select(
      "+passwordResetToken +passwordResetExpires"
    );

    // Always return the same message whether or not the account exists.
    // This prevents the endpoint from revealing registered email addresses.
    if (!user) {
      return res.json({ message: PASSWORD_RESET_MESSAGE });
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    user.passwordResetToken = hashResetToken(rawToken);
    user.passwordResetExpires = new Date(Date.now() + PASSWORD_RESET_EXPIRY_MS);
    await user.save();

    const clientUrl = (process.env.CLIENT_URL || "http://localhost:5173").replace(
      /\/$/,
      ""
    );
    const link = `${clientUrl}/reset-password/${rawToken}`;

    try {
      await sendPasswordResetEmail({ email: user.email, link });
    } catch (emailError) {
      user.passwordResetToken = null;
      user.passwordResetExpires = null;
      await user.save();
      console.error("Password reset email failed:", emailError.message);
    }

    res.json({ message: PASSWORD_RESET_MESSAGE });
  } catch (err) {
    console.error("Forgot password error:", err);
    res.status(500).json({
      message: "Unable to process the password reset request right now",
    });
  }
});

// POST /api/auth/reset-password/:token
router.post("/reset-password/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body || {};

    if (!token || !password) {
      return res.status(400).json({ message: "Reset token and new password are required" });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ message: passwordError });
    }

    const hashedToken = hashResetToken(token);
    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: new Date() },
    }).select("+passwordResetToken +passwordResetExpires");

    if (!user) {
      return res.status(400).json({
        message: "This password reset link is invalid or has expired. Please request a new one.",
      });
    }

    user.password = password;
    user.mustChangePassword = false;
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    await user.save();
    void alertSecurityChange(user._id, "password-reset");

    res.json({ message: "Your password has been reset successfully. You can now log in." });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ message: "Unable to reset your password right now" });
  }
});

// The JSON the website and mobile app receive once a member is fully signed in.
const buildLoginPayload = (user, token) => ({
  _id: user._id,
  fullName: user.fullName,
  email: user.email,
  role: user.role,
  savingsBalance: user.savingsBalance,
  contributionFrequency: user.contributionFrequency,
  avatarUrl: user.avatarUrl,
  isApprovedMember: user.isApprovedMember,
  mustChangePassword: user.mustChangePassword,
  isBlocked: user.isBlocked,
  hasAppPin: Boolean(user.appPinHash),
  autoLockSeconds: user.autoLockSeconds,
  biometricEnabled: user.biometricEnabled,
  createdAt: user.createdAt,
  // For administrators: which office they belong to and what it may do, so the
  // admin page can show only their own tabs. Empty for ordinary members.
  ...adminAccessPayload(user),
  token,
});

// One message for "no such account", "name matches several members" and "wrong
// password", so nobody can use sign-in to find out who is a member.
const INVALID_LOGIN_MESSAGE =
  "Invalid login details. Check what you typed, or sign in with your email address.";

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    // Members may sign in with their email, phone number or full name. (The
    // mobile app of an older version still sends it as `email`.)
    const identifier = String(req.body?.identifier ?? req.body?.email ?? "").trim();
    const passwordValue = String(req.body?.password || "");
    const userId = await findLoginUserId(identifier);
    const user = userId
      ? await User.findById(userId).select(
          "+securityFailedAttempts +securityLockLevel +securityLockedUntil"
        )
      : null;

    if (!user) {
      return res.status(401).json({ message: INVALID_LOGIN_MESSAGE });
    }

    if (user.isBlocked) {
      return res.status(403).json({
        code: "ACCOUNT_BLOCKED",
        message: "Your account has been blocked by an administrator. Please contact the cooperative.",
      });
    }

    if (user.role !== "admin") {
      const securityState = getSecurityState(user);

      if (securityState.permanent) {
        return res.status(403).json({
          code: "ACCOUNT_SECURITY_LOCKED",
          message: "Your account has been locked for security after repeated failed sign-in attempts. Please contact the cooperative to unlock your account.",
        });
      }

      if (securityState.locked) {
        return res.status(429).json({
          code: "ACCOUNT_TEMPORARILY_LOCKED",
          message: `Too many incorrect sign-in attempts. Please try again in ${Math.ceil((new Date(securityState.lockedUntil).getTime() - Date.now()) / 60000)} minutes.`,
          lockedUntil: securityState.lockedUntil,
          securityLockLevel: securityState.level,
        });
      }
    }

    const passwordMatches = await user.matchPassword(passwordValue);

    if (!passwordMatches) {
      if (user.role !== "admin") {
        const result = await recordSecurityFailure(user);

        if (result.permanent) {
          await notifyPermanentSecurityLock(user);
          return res.status(403).json({
            code: "ACCOUNT_SECURITY_LOCKED",
            message: "Your account has been locked for security after repeated failed sign-in attempts. Please contact the cooperative to unlock your account.",
          });
        }

        if (result.locked) {
          return res.status(429).json({
            code: "ACCOUNT_TEMPORARILY_LOCKED",
            message: `Too many incorrect sign-in attempts. Your account is locked for ${result.lockMinutes} minutes.`,
            lockedUntil: result.lockedUntil,
            securityLockLevel: result.level,
          });
        }
      }

      return res.status(401).json({
        code: "INVALID_CREDENTIALS",
        message: INVALID_LOGIN_MESSAGE,
      });
    }

    // Step 2 of sign-in: the password was right, so email a one-time code and
    // stop here. No session (cookie/token) is issued until /login/verify.
    if (loginOtpRequiredFor(user)) {
      const otp = await createLoginOtp(user._id);

      try {
        await sendLoginOtpEmail({
          email: user.email,
          name: user.fullName,
          code: otp.code,
        });
      } catch (emailError) {
        await clearLoginOtp(user._id, otp.nonce);
        console.error("Login OTP email failed:", emailError.message);
        return res.status(503).json({
          code: "OTP_EMAIL_FAILED",
          message: "We could not send your verification code right now. Please try again shortly.",
        });
      }

      return res.json(otpChallengeResponse(user.email, otp.challengeToken));
    }

    if (user.role !== "admin") {
      await recordSecuritySuccess(user);
    }

    const token = generateToken(user._id);
    setAuthCookie(res, token);
    void recordLoginDevice(user, req);

    res.json(buildLoginPayload(user, token));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

const OTP_USER_FIELDS =
  "+loginOtpHash +loginOtpNonce +loginOtpExpires +loginOtpAttempts +loginOtpSentAt +loginOtpResends " +
  "+securityFailedAttempts +securityLockLevel +securityLockedUntil";

const otpExpired = (res) =>
  res.status(401).json({
    code: "OTP_CHALLENGE_EXPIRED",
    message: "Your verification session has expired. Please log in again.",
  });

const otpAccountBlocked = (user, res) => {
  if (user.isBlocked) {
    res.status(403).json({
      code: "ACCOUNT_BLOCKED",
      message: "Your account has been blocked by an administrator. Please contact the cooperative.",
    });
    return true;
  }
  if (user.securityLockedPermanently) {
    res.status(403).json({
      code: "ACCOUNT_SECURITY_LOCKED",
      message: "Your account has been locked for security. Please contact the cooperative to unlock your account.",
    });
    return true;
  }
  return false;
};

// POST /api/auth/login/verify — { challengeToken, code } -> real session
router.post("/login/verify", async (req, res) => {
  try {
    const challenge = readChallenge(req.body?.challengeToken);
    const code = String(req.body?.code || "").replace(/\D/g, "");

    if (!challenge) return otpExpired(res);

    if (code.length !== OTP_LENGTH) {
      return res.status(400).json({
        code: "OTP_INVALID",
        message: `Enter the ${OTP_LENGTH}-digit code.`,
      });
    }

    // Count this attempt in the database BEFORE checking the code, so many
    // parallel guesses cannot sneak past the attempt limit.
    const user = await User.findOneAndUpdate(
      { _id: challenge.uid, loginOtpNonce: challenge.nonce },
      { $inc: { loginOtpAttempts: 1 } },
      { new: true }
    ).select(OTP_USER_FIELDS);

    if (!user || !user.loginOtpHash || !user.loginOtpExpires || user.loginOtpExpires <= new Date()) {
      return otpExpired(res);
    }

    if (otpAccountBlocked(user, res)) return;

    if (user.loginOtpAttempts > OTP_MAX_ATTEMPTS) {
      await clearLoginOtp(user._id, challenge.nonce);
      return res.status(429).json({
        code: "OTP_TOO_MANY_ATTEMPTS",
        message: "Too many incorrect codes. Please log in again.",
      });
    }

    if (!codeMatches(user, challenge.nonce, code)) {
      const attemptsLeft = Math.max(OTP_MAX_ATTEMPTS - user.loginOtpAttempts, 0);

      if (attemptsLeft === 0) {
        await clearLoginOtp(user._id, challenge.nonce);
        return res.status(429).json({
          code: "OTP_TOO_MANY_ATTEMPTS",
          message: "Too many incorrect codes. Please log in again.",
        });
      }

      return res.status(401).json({
        code: "OTP_INVALID",
        message: `Incorrect code. ${attemptsLeft} ${attemptsLeft === 1 ? "attempt" : "attempts"} left.`,
        attemptsLeft,
      });
    }

    // Single use: only the request that clears the code may continue.
    const consumed = await clearLoginOtp(user._id, challenge.nonce);
    if (!consumed.modifiedCount) return otpExpired(res);

    if (user.role !== "admin") {
      await recordSecuritySuccess(user);
    }

    const token = generateToken(user._id);
    setAuthCookie(res, token);
    void recordLoginDevice(user, req);

    res.json(buildLoginPayload(user, token));
  } catch (err) {
    console.error("Login verify error:", err);
    res.status(500).json({ message: "Unable to verify the code right now" });
  }
});

// POST /api/auth/login/resend — { challengeToken } -> new code + new challengeToken
router.post("/login/resend", async (req, res) => {
  try {
    const challenge = readChallenge(req.body?.challengeToken);
    if (!challenge) return otpExpired(res);

    const user = await User.findOne({
      _id: challenge.uid,
      loginOtpNonce: challenge.nonce,
    }).select(OTP_USER_FIELDS);

    if (!user || !user.loginOtpHash) return otpExpired(res);
    if (otpAccountBlocked(user, res)) return;

    const waitMs =
      (user.loginOtpSentAt ? user.loginOtpSentAt.getTime() : 0) +
      OTP_RESEND_COOLDOWN_MS -
      Date.now();

    if (waitMs > 0) {
      return res.status(429).json({
        code: "OTP_RESEND_WAIT",
        message: "Please wait before requesting another code.",
        retryAfterSeconds: Math.ceil(waitMs / 1000),
      });
    }

    const resends = Number(user.loginOtpResends || 0);
    if (resends >= OTP_MAX_RESENDS) {
      await clearLoginOtp(user._id, challenge.nonce);
      return res.status(429).json({
        code: "OTP_TOO_MANY_RESENDS",
        message: "Too many codes requested. Please log in again.",
      });
    }

    const otp = await createLoginOtp(user._id, { resends: resends + 1 });

    try {
      await sendLoginOtpEmail({ email: user.email, name: user.fullName, code: otp.code });
    } catch (emailError) {
      await clearLoginOtp(user._id, otp.nonce);
      console.error("Login OTP resend failed:", emailError.message);
      return res.status(503).json({
        code: "OTP_EMAIL_FAILED",
        message: "We could not send a new code right now. Please log in again.",
      });
    }

    res.json({
      challengeToken: otp.challengeToken,
      expiresInSeconds: Math.round(OTP_EXPIRY_MS / 1000),
      resendAfterSeconds: Math.round(OTP_RESEND_COOLDOWN_MS / 1000),
    });
  } catch (err) {
    console.error("Login resend error:", err);
    res.status(500).json({ message: "Unable to resend the code right now" });
  }
});

// POST /api/auth/logout — clears the httpOnly auth cookie (website)
router.post("/logout", (req, res) => {
  res.clearCookie("token", { ...authCookieOptions, maxAge: undefined });
  res.json({ message: "Logged out" });
});

// GET /api/auth/me
router.get("/me", protect, async (req, res) => {
  const plain = typeof req.user.toObject === "function" ? req.user.toObject() : req.user;
  res.json({ ...plain, ...adminAccessPayload(req.user) });
});

export default router;
