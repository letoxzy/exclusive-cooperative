import bcrypt from "bcryptjs";
import express from "express";
import crypto from "crypto";
import User from "../models/User.js";
import Loan from "../models/Loan.js";
import Withdrawal from "../models/Withdrawal.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireApprovedMember } from "../middleware/membershipMiddleware.js";
import { settleWithdrawal } from "../utils/withdrawalSettlement.js";

const router = express.Router();
const PAYSTACK_BASE = "https://api.paystack.co";
const LOCK_PERCENTAGE = 0.20;
const AVAILABLE_PERCENTAGE = 0.80;

// Create a separate 4-digit withdrawal PIN.
router.post("/pin", protect, requireApprovedMember, async (req, res) => {
  try {
    const { pin, confirmPin } = req.body;
    if (!/^\d{4}$/.test(String(pin || ""))) return res.status(400).json({ message: "Withdrawal PIN must be exactly 4 digits." });
    if (pin !== confirmPin) return res.status(400).json({ message: "Withdrawal PINs do not match." });
    if (req.user.withdrawalPinHash) return res.status(409).json({ message: "You already have a withdrawal PIN." });
    req.user.withdrawalPinHash = await bcrypt.hash(String(pin), 12);
    req.user.withdrawalPinFailedAttempts = 0;
    req.user.withdrawalPinLockedUntil = null;
    await req.user.save();
    res.status(201).json({ message: "Withdrawal PIN created successfully." });
  } catch (err) {
    console.error("Create withdrawal PIN:", err);
    res.status(500).json({ message: "Failed to create withdrawal PIN." });
  }
});

// Check whether the member has created a withdrawal PIN.
router.get("/pin/status", protect, requireApprovedMember, async (req, res) => {
  try {
    const member = await User.findById(req.user._id).select("+withdrawalPinHash +withdrawalPinLockedUntil");
    res.json({ hasWithdrawalPin: Boolean(member?.withdrawalPinHash), lockedUntil: member?.withdrawalPinLockedUntil || null });
  } catch (err) {
    res.status(500).json({ message: "Failed to check withdrawal PIN status." });
  }
});

// Change an existing withdrawal PIN.
router.patch("/pin", protect, requireApprovedMember, async (req, res) => {
  try {
    const { currentPin, newPin, confirmPin } = req.body;
    const member = await User.findById(req.user._id).select("+withdrawalPinHash +withdrawalPinFailedAttempts +withdrawalPinLockedUntil");
    if (!member?.withdrawalPinHash) return res.status(400).json({ message: "Create a withdrawal PIN first." });
    if (!/^\d{4}$/.test(String(currentPin || "")) || !/^\d{4}$/.test(String(newPin || ""))) return res.status(400).json({ message: "PIN must be exactly 4 digits." });
    if (newPin !== confirmPin) return res.status(400).json({ message: "New withdrawal PINs do not match." });
    const matches = await bcrypt.compare(String(currentPin), member.withdrawalPinHash);
    if (!matches) return res.status(401).json({ message: "Current withdrawal PIN is incorrect." });
    member.withdrawalPinHash = await bcrypt.hash(String(newPin), 12);
    member.withdrawalPinFailedAttempts = 0;
    member.withdrawalPinLockedUntil = null;
    await member.save();
    res.json({ message: "Withdrawal PIN changed successfully." });
  } catch (err) {
    console.error("Change withdrawal PIN:", err);
    res.status(500).json({ message: "Failed to change withdrawal PIN." });
  }
});

async function ensureLoanFundsBalance(user) {
  let loanFunds = Number(user.loanFundsBalance || 0);

  if (loanFunds > 0) return loanFunds;

  const activeLoan = await Loan.findOne({
    user: user._id,
    status: "active",
  }).select("amount totalRepayment outstandingBalance");

  if (!activeLoan) return 0;

  const totalRepayment = Number(activeLoan.totalRepayment || activeLoan.amount || 0);
  const principalOutstanding = Math.min(
    Number(activeLoan.amount || 0),
    totalRepayment > 0
      ? (Number(activeLoan.outstandingBalance || 0) / totalRepayment) * Number(activeLoan.amount || 0)
      : 0,
  );

  loanFunds = Math.max(0, Math.round(principalOutstanding * 100) / 100);

  if (loanFunds > 0) {
    user.loanFundsBalance = loanFunds;
    await user.save();
  }

  return loanFunds;
}

function getWithdrawalBreakdown(savingsBalance, loanFundsBalance, reserved) {
  const loanFunds = Math.max(0, Math.min(savingsBalance, loanFundsBalance));
  const personalSavings = Math.max(0, savingsBalance - loanFunds);
  const lockedAmount = personalSavings * LOCK_PERCENTAGE;
  const availableAmount = Math.max(0, loanFunds + personalSavings * AVAILABLE_PERCENTAGE - reserved);

  return { loanFunds, personalSavings, lockedAmount, availableAmount };
}

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

  if (!response.ok || !data.status) {
    const error = new Error(data.message || "Paystack request failed");
    error.status = response.status;
    error.paystack = data;
    throw error;
  }

  return data.data;
}

// GET /api/withdrawals/banks
router.get("/banks", protect, requireApprovedMember, async (req, res) => {
  try {
    const data = await paystack("/bank?currency=NGN&country=nigeria&perPage=100");
    const banks = (Array.isArray(data) ? data : [])
      .filter((bank) => bank.active && !bank.is_deleted)
      .map((bank) => ({ name: bank.name, code: bank.code }));

    res.json(banks);
  } catch (err) {
    res.status(502).json({ message: err.message });
  }
});

// POST /api/withdrawals/verify-account
router.post("/verify-account", protect, requireApprovedMember, async (req, res) => {
  try {
    const accountNumber = String(req.body.accountNumber || "").trim();
    const bankCode = String(req.body.bankCode || "").trim();

    if (!/^\d{10}$/.test(accountNumber)) {
      return res.status(400).json({ message: "Enter a valid 10-digit account number." });
    }
    if (!bankCode) {
      return res.status(400).json({ message: "Select a bank." });
    }

    const data = await paystack(
      `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`
    );

    res.json({
      accountNumber: data.account_number,
      accountName: data.account_name,
    });
  } catch (err) {
    res.status(400).json({ message: err.message || "Could not verify this bank account." });
  }
});

// GET /api/withdrawals/me
router.get("/me", protect, requireApprovedMember, async (req, res) => {
  try {
    const withdrawals = await Withdrawal.find({ user: req.user._id }).sort("-createdAt");
    const savings = Number(req.user.savingsBalance || 0);
    const reserved = Number(req.user.withdrawalReserved || 0);
    const loanFunds = await ensureLoanFundsBalance(req.user);
    const breakdown = getWithdrawalBreakdown(savings, loanFunds, reserved);

    res.json({
      savingsBalance: savings,
      loanFundsBalance: breakdown.loanFunds,
      personalSavingsBalance: breakdown.personalSavings,
      lockedAmount: breakdown.lockedAmount,
      availableAmount: breakdown.availableAmount,
      reservedAmount: reserved,
      withdrawals,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/withdrawals
// Password is verified before any withdrawal reservation is created.
// Once validated, Paystack transfer is initiated automatically.
router.post("/", protect, requireApprovedMember, async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    const pin = String(req.body.pin || "");
    const bankCode = String(req.body.bankCode || "").trim();
    const bankName = String(req.body.bankName || "").trim();
    const accountNumber = String(req.body.accountNumber || "").trim();
    const accountName = String(req.body.accountName || "").trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Enter a valid withdrawal amount." });
    }
    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({ message: "Enter your 4-digit withdrawal PIN." });
    }
    if (!bankCode || !bankName) {
      return res.status(400).json({ message: "Select a valid bank." });
    }
    if (!/^\d{10}$/.test(accountNumber)) {
      return res.status(400).json({ message: "Enter a valid 10-digit account number." });
    }
    if (!accountName) {
      return res.status(400).json({ message: "Verify the bank account before withdrawing." });
    }

    const memberForPin = await User.findById(req.user._id).select("+withdrawalPinHash +withdrawalPinFailedAttempts +withdrawalPinLockedUntil");
    if (!memberForPin?.withdrawalPinHash) return res.status(400).json({ message: "Create your withdrawal PIN before withdrawing." });
    if (memberForPin.withdrawalPinLockedUntil && memberForPin.withdrawalPinLockedUntil > new Date()) {
      return res.status(429).json({ message: "Withdrawal PIN is temporarily locked after too many failed attempts. Please try again later.", lockedUntil: memberForPin.withdrawalPinLockedUntil });
    }
    const pinMatches = await bcrypt.compare(pin, memberForPin.withdrawalPinHash);
    if (!pinMatches) {
      memberForPin.withdrawalPinFailedAttempts = Number(memberForPin.withdrawalPinFailedAttempts || 0) + 1;
      if (memberForPin.withdrawalPinFailedAttempts >= 3) {
        memberForPin.withdrawalPinLockedUntil = new Date(Date.now() + 15 * 60 * 1000);
        memberForPin.withdrawalPinFailedAttempts = 0;
      }
      await memberForPin.save();
      return res.status(401).json({ message: "Incorrect withdrawal PIN." });
    }
    memberForPin.withdrawalPinFailedAttempts = 0;
    memberForPin.withdrawalPinLockedUntil = null;
    await memberForPin.save();

    // Resolve the account again on the server. Never trust the account name
    // or bank details supplied by the browser for a money-moving operation.
    const resolved = await paystack(
      `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`
    );

    if (!resolved.account_name) {
      return res.status(400).json({ message: "We could not verify this bank account." });
    }

    const savings = Number(req.user.savingsBalance || 0);
    const reserved = Number(req.user.withdrawalReserved || 0);
    const loanFunds = await ensureLoanFundsBalance(req.user);
    const breakdown = getWithdrawalBreakdown(savings, loanFunds, reserved);
    const available = breakdown.availableAmount;

    if (amount > available) {
      return res.status(400).json({
        message: `You can withdraw up to ₦${available.toLocaleString()} based on your current 20% savings reserve.`,
      });
    }

    // Reserve the amount atomically so two simultaneous withdrawal requests
    // cannot spend the same available balance.
    const reservedUser = await User.findOneAndUpdate(
      {
        _id: req.user._id,
        $expr: {
          $gte: [
            {
              $subtract: [
                {
                  $add: [
                    "$loanFundsBalance",
                    {
                      $multiply: [
                        { $max: [{ $subtract: ["$savingsBalance", "$loanFundsBalance"] }, 0] },
                        AVAILABLE_PERCENTAGE,
                      ],
                    },
                  ],
                },
                "$withdrawalReserved",
              ],
            },
            amount,
          ],
        },
      },
      { $inc: { withdrawalReserved: amount } },
      { new: true }
    );

    if (!reservedUser) {
      return res.status(409).json({
        message: "Your available withdrawal changed. Refresh your balance and try again.",
      });
    }

    let withdrawal;

    try {
      const recipient = await paystack("/transferrecipient", {
        method: "POST",
        body: JSON.stringify({
          type: "nuban",
          name: resolved.account_name,
          account_number: accountNumber,
          bank_code: bankCode,
          currency: "NGN",
          email: req.user.email,
        }),
      });

      const reference = `wd_${crypto.randomUUID().replace(/-/g, "").slice(0, 32)}`;

      withdrawal = await Withdrawal.create({
        user: req.user._id,
        amount,
        bankCode,
        bankName,
        accountName: resolved.account_name,
        accountNumberLast4: accountNumber.slice(-4),
        recipientCode: recipient.recipient_code,
        reference,
        status: "processing",
      });

      const transfer = await paystack("/transfer", {
        method: "POST",
        body: JSON.stringify({
          source: "balance",
          amount: Math.round(amount * 100),
          recipient: recipient.recipient_code,
          reference,
          reason: `Exclusive Cooperative withdrawal for ${req.user.fullName}`,
          currency: "NGN",
        }),
      });

      withdrawal.transferCode = transfer.transfer_code || null;
      withdrawal.status = transfer.status === "success" ? "success" : "processing";

      if (withdrawal.status === "success") {
        await settleWithdrawal(withdrawal, "success");
      } else {
        await withdrawal.save();
      }

      const freshUser = await User.findById(req.user._id).select("savingsBalance withdrawalReserved loanFundsBalance");
      const freshBreakdown = getWithdrawalBreakdown(
        Number(freshUser.savingsBalance || 0),
        Number(freshUser.loanFundsBalance || 0),
        Number(freshUser.withdrawalReserved || 0),
      );

      return res.status(201).json({
        message:
          withdrawal.status === "success"
            ? "Withdrawal completed successfully."
            : "Withdrawal submitted and is being processed by Paystack.",
        withdrawal,
        savingsBalance: freshUser.savingsBalance,
        loanFundsBalance: freshBreakdown.loanFunds,
        personalSavingsBalance: freshBreakdown.personalSavings,
        lockedAmount: freshBreakdown.lockedAmount,
        availableAmount: freshBreakdown.availableAmount,
        withdrawalReserved: freshUser.withdrawalReserved,
      });
    } catch (err) {
      if (withdrawal) {
        try {
          await settleWithdrawal(
            withdrawal,
            "failed",
            err.message || "Paystack transfer could not be initiated."
          );
        } catch (settleError) {
          console.error("Withdrawal settlement error:", settleError);
        }
      } else {
        await User.findByIdAndUpdate(req.user._id, {
          $inc: { withdrawalReserved: -amount },
        });
      }

      return res.status(502).json({
        message: err.message || "Could not start the bank transfer.",
      });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/withdrawals/paystack/webhook
// Configure this URL in Paystack Dashboard -> API Keys & Webhooks.
router.post("/paystack/webhook", async (req, res) => {
  const signature = req.headers["x-paystack-signature"];
  const payload = JSON.stringify(req.body);
  const expected = crypto
    .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
    .update(payload)
    .digest("hex");

  if (!signature) return res.sendStatus(401);

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return res.sendStatus(401);
  }

  // Acknowledge immediately; Paystack retries webhook events when it doesn't
  // receive a 200 response. Processing here is intentionally small/idempotent.
  res.sendStatus(200);

  try {
    const { event, data } = req.body || {};
    if (!data?.reference) return;

    if (!["transfer.success", "transfer.failed", "transfer.reversed"].includes(event)) {
      return;
    }

    const withdrawal = await Withdrawal.findOne({ reference: data.reference });
    if (!withdrawal) return;

    if (event === "transfer.success") {
      if (withdrawal.status === "success") return;
      withdrawal.transferCode = data.transfer_code || withdrawal.transferCode;
      await settleWithdrawal(withdrawal, "success");
      return;
    }

    const finalStatus = event === "transfer.reversed" ? "reversed" : "failed";
    if (["success", "failed", "reversed", "rejected"].includes(withdrawal.status)) return;

    withdrawal.transferCode = data.transfer_code || withdrawal.transferCode;
    await settleWithdrawal(
      withdrawal,
      finalStatus,
      data.failures || data.message || `Paystack transfer ${finalStatus}.`
    );
  } catch (err) {
    console.error("Paystack withdrawal webhook error:", err);
  }
});

export default router;
