import express from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import User from "../models/User.js";
import SavingsTransaction from "../models/SavingsTransaction.js";
import Loan from "../models/Loan.js";
import LoanRepayment from "../models/LoanRepayment.js";
import Withdrawal from "../models/Withdrawal.js";
import { DividendEntry } from "../models/Dividend.js";
import { protect } from "../middleware/authMiddleware.js";
import { uploadBufferToCloudinary } from "../utils/cloudinaryUpload.js";
import { validatePassword } from "../utils/passwordPolicy.js";

const router = express.Router();

const APP_AUTO_LOCK_OPTIONS = new Set([0, 60, 300, 600, 900, 1800, 3600]);
const APP_PIN_MAX_ATTEMPTS = 5;
const APP_PIN_LOCK_MINUTES = 15;


const uploadAvatar = multer({
  storage: multer.memoryStorage(),
});

// PATCH /api/users/me
// body: { fullName }
router.patch("/me", protect, async (req, res) => {
  try {
    const { fullName } = req.body;

    if (!fullName || !fullName.trim()) {
      return res.status(400).json({
        message: "Full name cannot be empty",
      });
    }

    req.user.fullName = fullName.trim();

    await req.user.save();

    res.json(req.user);
  } catch (err) {
    console.error("Profile update error:", err);

    res.status(500).json({
      message: "Failed to update profile",
    });
  }
});

// GET /api/users/me/security
// Account-level app security settings. The PIN hash is never returned.
router.get("/me/security", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "autoLockSeconds biometricEnabled appPinHash"
    );

    if (!user) return res.status(404).json({ message: "User no longer exists" });

    res.json({
      pinConfigured: Boolean(user.appPinHash),
      autoLockSeconds: Number.isFinite(user.autoLockSeconds)
        ? user.autoLockSeconds
        : 300,
      biometricEnabled: Boolean(user.biometricEnabled),
    });
  } catch (err) {
    console.error("Security settings fetch error:", err);
    res.status(500).json({ message: "Failed to load security settings" });
  }
});

// PATCH /api/users/me/security/pin
// Creates or changes the 6-digit app unlock PIN.
router.patch("/me/security/pin", protect, async (req, res) => {
  try {
    const pin = String(req.body?.pin || "");

    if (!/^\d{6}$/.test(pin)) {
      return res.status(400).json({ message: "PIN must be exactly 6 digits." });
    }

    const user = await User.findById(req.user._id).select(
      "+appPinHash +appPinFailedAttempts +appPinLockedUntil"
    );

    if (!user) return res.status(404).json({ message: "User no longer exists" });

    user.appPinHash = await bcrypt.hash(pin, 12);
    user.appPinFailedAttempts = 0;
    user.appPinLockedUntil = null;
    await user.save();

    res.json({ message: "App PIN saved successfully.", pinConfigured: true });
  } catch (err) {
    console.error("App PIN save error:", err);
    res.status(500).json({ message: "Failed to save app PIN" });
  }
});

// POST /api/users/me/security/pin/verify
// Verifies the app PIN without ever returning the stored hash.
router.post("/me/security/pin/verify", protect, async (req, res) => {
  try {
    const pin = String(req.body?.pin || "");

    if (!/^\d{6}$/.test(pin)) {
      return res.status(400).json({ message: "PIN must be exactly 6 digits." });
    }

    const user = await User.findById(req.user._id).select(
      "+appPinHash +appPinFailedAttempts +appPinLockedUntil"
    );

    if (!user) return res.status(404).json({ message: "User no longer exists" });
    if (!user.appPinHash) {
      return res.status(409).json({ message: "No app PIN has been configured." });
    }

    if (user.appPinLockedUntil && user.appPinLockedUntil > new Date()) {
      return res.status(429).json({
        message: "Too many incorrect PIN attempts. Please try again later.",
        lockedUntil: user.appPinLockedUntil,
      });
    }

    const matches = await bcrypt.compare(pin, user.appPinHash);

    if (!matches) {
      user.appPinFailedAttempts = Number(user.appPinFailedAttempts || 0) + 1;

      if (user.appPinFailedAttempts >= APP_PIN_MAX_ATTEMPTS) {
        user.appPinFailedAttempts = 0;
        user.appPinLockedUntil = new Date(
          Date.now() + APP_PIN_LOCK_MINUTES * 60 * 1000
        );
      }

      await user.save();

      return res.status(401).json({
        message:
          user.appPinLockedUntil && user.appPinLockedUntil > new Date()
            ? "Too many incorrect PIN attempts. Please try again later."
            : "Incorrect PIN. Please try again.",
      });
    }

    user.appPinFailedAttempts = 0;
    user.appPinLockedUntil = null;
    await user.save();

    res.json({ verified: true });
  } catch (err) {
    console.error("App PIN verification error:", err);
    res.status(500).json({ message: "Unable to verify app PIN" });
  }
});

// PATCH /api/users/me/security/auto-lock
router.patch("/me/security/auto-lock", protect, async (req, res) => {
  try {
    const seconds = Number(req.body?.seconds);

    if (!Number.isInteger(seconds) || !APP_AUTO_LOCK_OPTIONS.has(seconds)) {
      return res.status(400).json({ message: "Invalid auto-lock setting." });
    }

    req.user.autoLockSeconds = seconds;
    await req.user.save();

    res.json({ autoLockSeconds: seconds });
  } catch (err) {
    console.error("Auto-lock update error:", err);
    res.status(500).json({ message: "Failed to update auto-lock setting" });
  }
});

// PATCH /api/users/me/security/biometric
// The biometric credential itself remains on the device; only the account preference is synced.
router.patch("/me/security/biometric", protect, async (req, res) => {
  try {
    if (typeof req.body?.enabled !== "boolean") {
      return res.status(400).json({ message: "Biometric setting must be true or false." });
    }

    req.user.biometricEnabled = req.body.enabled;
    await req.user.save();

    res.json({ biometricEnabled: req.user.biometricEnabled });
  } catch (err) {
    console.error("Biometric setting update error:", err);
    res.status(500).json({ message: "Failed to update biometric setting" });
  }
});

// PATCH /api/users/me/password
// body: { currentPassword, newPassword }
router.patch("/me/password", protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        message: "Both current and new password are required",
      });
    }

    // Validate the new password.
    // This uses the same password policy used during registration.
    const passwordError = validatePassword(newPassword);

    if (passwordError) {
      return res.status(400).json({
        message: passwordError,
      });
    }

    // protect() intentionally removes the password field.
    // Fetch the user again here so that we have access
    // to the stored password hash for bcrypt comparison.
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        message: "User no longer exists",
      });
    }

    // Compare the entered current password with the
    // hashed password stored in MongoDB.
    const matches = await user.matchPassword(currentPassword);

    if (!matches) {
      return res.status(401).json({
        message: "Current password is incorrect",
      });
    }

    // Set the new password.
    // User.js pre-save middleware will automatically hash it.
    user.password = newPassword;
    user.mustChangePassword = false;

    await user.save();

    res.json({
      message: "Password updated successfully",
    });
  } catch (err) {
    console.error("Password update error:", err);

    res.status(500).json({
      message: "Failed to update password",
    });
  }
});

// POST /api/users/me/avatar
// multipart/form-data, field name "avatar"
router.post(
  "/me/avatar",
  protect,
  uploadAvatar.single("avatar"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        message: "No image uploaded",
      });
    }

    try {
      const result = await uploadBufferToCloudinary(req.file.buffer, {
        folder: "exclusive-cooperative/avatars",
        transformation: [
          {
            width: 400,
            height: 400,
            crop: "fill",
            gravity: "face",
          },
        ],
      });

      req.user.avatarUrl = result.secure_url;

      await req.user.save();

      res.json({
        avatarUrl: req.user.avatarUrl,
      });
    } catch (err) {
      console.error("Avatar upload error:", err);

      res.status(500).json({
        message: err.message,
      });
    }
  }
);

// GET /api/users/me/savings-requests
// History of a member's savings top-ups.
// Every top-up now comes through Paystack checkout.
router.get("/me/savings-requests", protect, async (req, res) => {
  try {
    const txns = await SavingsTransaction.find({
      user: req.user._id,
    }).sort("-createdAt");

    res.json(txns);
  } catch (err) {
    console.error("Savings requests error:", err);

    res.status(500).json({
      message: "Failed to load savings requests",
    });
  }
});

// GET /api/users/me/transactions
// Member transaction history
router.get("/me/transactions", protect, async (req, res) => {
  try {
    const [
      savingsTransactions,
      repayments,
      loans,
      withdrawals,
      dividendEntries,
    ] = await Promise.all([
      SavingsTransaction.find({
        user: req.user._id,
        status: "approved",
      }).sort("-createdAt"),

      LoanRepayment.find({
        user: req.user._id,
        status: "approved",
      }).sort("-createdAt"),

      Loan.find({
        user: req.user._id,
        status: {
          $in: ["active", "completed"],
        },
        disbursedDate: {
          $ne: null,
        },
      }).sort("-disbursedDate"),

      Withdrawal.find({
        user: req.user._id,
      }).sort("-createdAt"),

      DividendEntry.find({
        user: req.user._id,
        status: "paid",
      }).sort("-paidDate"),
    ]);

    const transactions = [
      // SAVINGS
      ...savingsTransactions.map((transaction) => ({
        id: `savings-${transaction._id}`,
        type: "Savings Deposit",
        description: "Savings top-up",
        amount: Number(transaction.amount || 0),
        status: transaction.status,
        direction: "credit",
        reference: transaction.reference || null,
        date: transaction.createdAt,
      })),

      // LOAN REPAYMENTS
      ...repayments.map((repayment) => ({
        id: `repayment-${repayment._id}`,
        type: "Loan Repayment",
        description: "Loan repayment confirmed",
        amount: Number(repayment.amount || 0),
        status: repayment.status,
        direction: "debit",
        reference: repayment._id,
        date: repayment.updatedAt || repayment.createdAt,
      })),

      // LOAN DISBURSEMENTS
      ...loans.map((loan) => ({
        id: `loan-${loan._id}`,
        type: "Loan Disbursement",
        description: `${loan.loanType || "Loan"} loan disbursed (not savings)`,
        amount: Number(loan.amount || 0),
        status: "approved",
        direction: "credit",
        reference: loan._id,
        date: loan.disbursedDate || loan.createdAt,
      })),

      // WITHDRAWALS
      ...withdrawals.map((withdrawal) => ({
        id: `withdrawal-${withdrawal._id}`,
        type: "Withdrawal",
        description: `${withdrawal.bankName} ····${withdrawal.accountNumberLast4}`,
        amount: Number(withdrawal.amount || 0),
        status: withdrawal.status,
        direction: "debit",
        reference: withdrawal.reference,
        date: withdrawal.paidAt || withdrawal.createdAt,
      })),

      // DIVIDENDS
      ...dividendEntries.map((entry) => ({
        id: `dividend-${entry._id}`,
        type: "Dividend",
        description: "Dividend paid",
        amount: Number(entry.dividendAmount || 0),
        status: entry.status,
        direction: "credit",
        reference: entry._id,
        date: entry.paidDate || entry.createdAt,
      })),
    ].sort(
      (a, b) =>
        new Date(b.date || 0) -
        new Date(a.date || 0)
    );

    res.json(transactions);
  } catch (err) {
    console.error("Transaction history error:", err);

    res.status(500).json({
      message: "Failed to load transactions",
    });
  }
});

export default router;