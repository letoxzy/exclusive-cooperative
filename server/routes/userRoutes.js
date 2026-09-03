import express from "express";
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