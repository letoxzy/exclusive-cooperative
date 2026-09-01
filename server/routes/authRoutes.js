import express from "express";
import crypto from "crypto";
import User from "../models/User.js";
import generateToken from "../utils/generateToken.js";
import { protect } from "../middleware/authMiddleware.js";
import { validatePassword } from "../utils/passwordPolicy.js";

const router = express.Router();

const PASSWORD_RESET_EXPIRY_MS = 60 * 60 * 1000;
const PASSWORD_RESET_MESSAGE =
  "If an account exists for that email, a password reset link has been sent.";

const hashResetToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

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
    const { fullName, email, password } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ message: passwordError });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: "An account with this email already exists" });
    }

    const user = await User.create({ fullName, email, password });

    res.status(201).json({
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      savingsBalance: user.savingsBalance,
      avatarUrl: user.avatarUrl,
      isApprovedMember: user.isApprovedMember,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt,
      token: generateToken(user._id),
    });
  } catch (err) {
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

    res.json({ message: "Your password has been reset successfully. You can now log in." });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ message: "Unable to reset your password right now" });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    res.json({
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      savingsBalance: user.savingsBalance,
      avatarUrl: user.avatarUrl,
      isApprovedMember: user.isApprovedMember,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt,
      token: generateToken(user._id),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/auth/me
router.get("/me", protect, async (req, res) => {
  res.json(req.user);
});

export default router;