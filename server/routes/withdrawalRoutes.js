import express from "express";
import crypto from "crypto";
import Withdrawal from "../models/Withdrawal.js";
import User from "../models/User.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireApprovedMember } from "../middleware/membershipMiddleware.js";

const router = express.Router();
const PAYSTACK_BASE = "https://api.paystack.co";
const LOCK_PERCENT = 0.20;

async function paystack(path, options = {}) {
  const response = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function maskedAccount(accountNumber = "") {
  return accountNumber.length > 4
    ? `${"*".repeat(accountNumber.length - 4)}${accountNumber.slice(-4)}`
    : accountNumber;
}

// GET /api/withdrawals/banks
router.get("/banks", protect, async (req, res) => {
  try {
    const { response, data } = await paystack("/bank?currency=NGN&perPage=200");
    if (!response.ok || !data.status) {
      return res.status(400).json({ message: data.message || "Could not load banks" });
    }

    res.json(
      (data.data || [])
        .filter((bank) => bank.active && bank.type === "nuban")
        .map((bank) => ({ name: bank.name, code: bank.code }))
        .sort((a, b) => a.name.localeCompare(b.name))
    );
  } catch (err) {
    res.status(500).json({ message: "Unable to load banks right now" });
  }
});

// POST /api/withdrawals/resolve-account
router.post("/resolve-account", protect, requireApprovedMember, async (req, res) => {
  try {
    const { accountNumber, bankCode } = req.body;

    if (!/^\d{10}$/.test(String(accountNumber || "")) || !bankCode) {
      return res.status(400).json({ message: "Enter a valid 10-digit account number and bank." });
    }

    const { response, data } = await paystack(
      `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`
    );

    if (!response.ok || !data.status) {
      return res.status(400).json({
        message: data.message || "Could not verify this bank account.",
      });
    }

    res.json({
      accountName: data.data?.account_name || "",
      accountNumber: data.data?.account_number || accountNumber,
    });
  } catch (err) {
    res.status(500).json({ message: "Unable to verify the bank account right now." });
  }
});

// GET /api/withdrawals/me
router.get("/me", protect, async (req, res) => {
  try {
    const withdrawals = await Withdrawal.find({ user: req.user._id })
      .select("-accountNumber -gatewayResponse")
      .sort("-createdAt");

    res.json(withdrawals.map((item) => ({
      ...item.toObject(),
      accountNumber: maskedAccount(item.accountNumber),
    })));
  } catch (err) {
    res.status(500).json({ message: "Failed to load withdrawals" });
  }
});

// POST /api/withdrawals
// Creates a request only. Admin approval is required before money is sent.
router.post("/", protect, requireApprovedMember, async (req, res) => {
  try {
    const {
      amount,
      bankName,
      bankCode,
      accountName,
      accountNumber,
      password,
    } = req.body;

    const withdrawalAmount = Number(amount);
    const balance = Number(req.user.savingsBalance || 0);
    const lockedAmount = Math.round(balance * LOCK_PERCENT * 100) / 100;
    const maximumWithdrawable = Math.round((balance - lockedAmount) * 100) / 100;

    if (!Number.isFinite(withdrawalAmount) || withdrawalAmount <= 0) {
      return res.status(400).json({ message: "Enter a valid withdrawal amount" });
    }

    if (!password) {
      return res.status(400).json({ message: "Enter your account password to confirm this request" });
    }

    const passwordMatches = await req.user.matchPassword(password);
    if (!passwordMatches) {
      return res.status(401).json({ message: "The password you entered is incorrect" });
    }

    if (!bankName || !bankCode || !accountName || !/^\d{10}$/.test(String(accountNumber || ""))) {
      return res.status(400).json({
        message: "Enter a valid Nigerian bank, account name, and 10-digit account number",
      });
    }

    if (withdrawalAmount > maximumWithdrawable) {
      return res.status(400).json({
        message: `You can withdraw up to ₦${maximumWithdrawable.toLocaleString()}. 20% of your current savings remains protected.`,
      });
    }

    // Reserve the amount atomically so two withdrawal requests cannot
    // spend the same available balance at the same time.
    const reservedUser = await User.findOneAndUpdate(
      {
        _id: req.user._id,
        $expr: {
          $lte: [
            { $add: ["$withdrawalReserved", withdrawalAmount] },
            { $multiply: ["$savingsBalance", 0.8] },
          ],
        },
      },
      { $inc: { withdrawalReserved: withdrawalAmount } },
      { new: true }
    );

    if (!reservedUser) {
      const freshBalance = Number(req.user.savingsBalance || 0);
      const freshReserved = Number(req.user.withdrawalReserved || 0);
      const freshAvailable = Math.max(
        0,
        Math.round((freshBalance * 0.8 - freshReserved) * 100) / 100
      );

      return res.status(400).json({
        message: `Only ₦${freshAvailable.toLocaleString()} is currently available for withdrawal. 20% of your savings remains protected.`,
      });
    }

    let withdrawal;
    try {
      withdrawal = await Withdrawal.create({
        user: req.user._id,
        amount: withdrawalAmount,
        lockedAmountAtRequest: lockedAmount,
        bankName,
        bankCode,
        accountName,
        accountNumber: String(accountNumber),
        status: "pending",
      });
    } catch (createError) {
      await User.findByIdAndUpdate(req.user._id, {
        $inc: { withdrawalReserved: -withdrawalAmount },
      });
      throw createError;
    }

    res.status(201).json({
      message: "Withdrawal request submitted. An administrator must approve it before the transfer is sent.",
      withdrawal: {
        ...withdrawal.toObject(),
        accountNumber: maskedAccount(withdrawal.accountNumber),
      },
      availableBalance: Math.max(0, maximumWithdrawable - Number(reservedUser.withdrawalReserved || 0)),
      lockedAmount,
    });
  } catch (err) {
    console.error("Withdrawal request error:", err);
    res.status(500).json({ message: "Failed to create withdrawal request" });
  }
});

export { LOCK_PERCENT };
export default router;
