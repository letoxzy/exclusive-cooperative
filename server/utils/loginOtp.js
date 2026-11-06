import crypto from "crypto";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

/**
 * Email one-time code (OTP) sign-in verification.
 *
 * Flow: POST /auth/login checks email + password, then (instead of signing the
 * member in) emails a 6-digit code and returns a short-lived "challenge token".
 * POST /auth/login/verify trades challenge token + code for the real session.
 *
 * Security notes
 *  - Only a keyed hash (HMAC) of the code is stored, never the code itself.
 *  - A code works once, expires after OTP_EXPIRY_MS, and allows OTP_MAX_ATTEMPTS
 *    guesses (counted atomically in MongoDB) before it is thrown away.
 *  - The challenge token is signed with a DIFFERENT secret and uses `uid`
 *    (not `id`), so it can never be accepted as a session token by `protect`.
 */

export const OTP_LENGTH = 6;
export const OTP_EXPIRY_MS = 10 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_RESENDS = 5;

const flag = (name) => String(process.env[name] || "").toLowerCase() === "true";

/** Off by default, so you can deploy the code first and switch it on later. */
export const loginOtpRequiredFor = (user) => {
  if (!flag("LOGIN_OTP_ENABLED")) return false;
  if (user.role === "admin") return flag("LOGIN_OTP_ADMINS");
  return true;
};

const challengeSecret = () => `${process.env.JWT_SECRET}:login-otp`;

const generateCode = () =>
  String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");

const hashCode = (nonce, code) =>
  crypto
    .createHmac("sha256", challengeSecret())
    .update(`${nonce}:${code}`)
    .digest("hex");

export const codeMatches = (user, nonce, code) => {
  const expected = Buffer.from(String(user.loginOtpHash || ""), "hex");
  const actual = Buffer.from(hashCode(nonce, code), "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

const signChallenge = (uid, nonce) =>
  jwt.sign({ uid: String(uid), nonce, purpose: "login_otp" }, challengeSecret(), {
    expiresIn: Math.floor(OTP_EXPIRY_MS / 1000),
  });

export const readChallenge = (token) => {
  try {
    const decoded = jwt.verify(String(token || ""), challengeSecret());
    if (decoded.purpose !== "login_otp" || !decoded.uid || !decoded.nonce) return null;
    return decoded;
  } catch {
    return null;
  }
};

export const maskEmail = (email) => {
  const [name = "", domain = ""] = String(email).split("@");
  return `${name.slice(0, 1)}${"*".repeat(Math.max(1, Math.min(name.length - 1, 5)))}@${domain}`;
};

/** Stores a fresh code for the user and returns the code (to email) + challenge token. */
export async function createLoginOtp(userId, { resends = 0 } = {}) {
  const code = generateCode();
  const nonce = crypto.randomBytes(16).toString("hex");

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        loginOtpHash: hashCode(nonce, code),
        loginOtpNonce: nonce,
        loginOtpExpires: new Date(Date.now() + OTP_EXPIRY_MS),
        loginOtpAttempts: 0,
        loginOtpSentAt: new Date(),
        loginOtpResends: resends,
      },
    }
  );

  return { code, nonce, challengeToken: signChallenge(userId, nonce) };
}

/** Throws the code away. Pass the nonce to make it a no-op if a newer code exists. */
export const clearLoginOtp = (userId, nonce) =>
  User.updateOne(nonce ? { _id: userId, loginOtpNonce: nonce } : { _id: userId }, {
    $set: {
      loginOtpHash: null,
      loginOtpNonce: null,
      loginOtpExpires: null,
      loginOtpAttempts: 0,
    },
  });

/**
 * Sends the code through EmailJS (same service as password reset).
 * Create a second EmailJS template and put its ID in EMAILJS_OTP_TEMPLATE_ID.
 * Template variables: {{email}} {{name}} {{code}} {{expires_minutes}}
 */
export async function sendLoginOtpEmail({ email, name, code }) {
  const {
    EMAILJS_SERVICE_ID,
    EMAILJS_OTP_TEMPLATE_ID,
    EMAILJS_PUBLIC_KEY,
    EMAILJS_PRIVATE_KEY,
  } = process.env;

  if (!EMAILJS_SERVICE_ID || !EMAILJS_OTP_TEMPLATE_ID || !EMAILJS_PUBLIC_KEY) {
    throw new Error("Login verification email is not configured");
  }

  const body = {
    service_id: EMAILJS_SERVICE_ID,
    template_id: EMAILJS_OTP_TEMPLATE_ID,
    user_id: EMAILJS_PUBLIC_KEY,
    template_params: {
      email,
      name: name || "Member",
      code,
      expires_minutes: String(Math.round(OTP_EXPIRY_MS / 60000)),
    },
  };
  if (EMAILJS_PRIVATE_KEY) body.accessToken = EMAILJS_PRIVATE_KEY;

  const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error((await response.text()) || "Unable to send verification email");
  }
}

export const otpChallengeResponse = (email, challengeToken) => ({
  otpRequired: true,
  challengeToken,
  email: maskEmail(email),
  codeLength: OTP_LENGTH,
  expiresInSeconds: Math.round(OTP_EXPIRY_MS / 1000),
  resendAfterSeconds: Math.round(OTP_RESEND_COOLDOWN_MS / 1000),
});