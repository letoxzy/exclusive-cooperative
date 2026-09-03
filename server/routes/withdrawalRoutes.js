import bcrypt from "bcryptjs";
import express from "express";
import crypto from "crypto";
import mongoose from "mongoose";
import User from "../models/User.js";
import Loan from "../models/Loan.js";
import Withdrawal from "../models/Withdrawal.js";
import Notification from "../models/Notification.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireApprovedMember } from "../middleware/membershipMiddleware.js";
import { settleWithdrawal } from "../utils/withdrawalSettlement.js";


const router = express.Router();

const PAYSTACK_BASE = "https://api.paystack.co";

// Small server-side Paystack helper used by bank lookup, account verification,
// recipient creation, and transfers. The secret key never reaches the client.
async function paystack(path, options = {}) {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    throw new Error("Paystack is not configured on the server.");
  }

  const response = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Paystack returned an invalid response (${response.status}).`);
  }

  if (!response.ok || !payload?.status) {
    throw new Error(
      payload?.message || `Paystack request failed (${response.status}).`
    );
  }

  return payload.data;
}

// Withdrawal rules from the cooperative bye-law.
const WITHDRAWAL_PERCENTAGE = 0.60;
// Section 15.8(iii) applies its N20,000 fee to membership withdrawal,
// not ordinary savings or loan-funds withdrawal.
const ADMINISTRATIVE_FEE = 0;

// Create a separate 4-digit withdrawal PIN.
router.post(
  "/pin",
  protect,
  requireApprovedMember,
  async (req, res) => {
    try {
      const { pin, confirmPin } = req.body;

      if (!/^\d{4}$/.test(String(pin || ""))) {
        return res.status(400).json({
          message: "Withdrawal PIN must be exactly 4 digits.",
        });
      }

      if (pin !== confirmPin) {
        return res.status(400).json({
          message: "Withdrawal PINs do not match.",
        });
      }

      const member = await User.findById(req.user._id).select(
        "+withdrawalPinHash +withdrawalPinFailedAttempts +withdrawalPinLockedUntil"
      );

      if (!member) {
        return res.status(404).json({
          message: "Member account not found.",
        });
      }

      if (member.withdrawalPinHash) {
        return res.status(409).json({
          message: "You already have a withdrawal PIN.",
        });
      }

      member.withdrawalPinHash = await bcrypt.hash(String(pin), 12);
      member.withdrawalPinFailedAttempts = 0;
      member.withdrawalPinLockedUntil = null;

      await member.save();

      return res.status(201).json({
        message: "Withdrawal PIN created successfully.",
        hasWithdrawalPin: true,
      });
    } catch (err) {
      console.error("Create withdrawal PIN:", err);

      return res.status(500).json({
        message: "Failed to create withdrawal PIN.",
      });
    }
  }
);

// Check whether the member has created a withdrawal PIN.
router.get(
  "/pin/status",
  protect,
  requireApprovedMember,
  async (req, res) => {
    try {
      const member = await User.findById(req.user._id).select(
        "+withdrawalPinHash +withdrawalPinLockedUntil"
      );

      res.json({
        hasWithdrawalPin: Boolean(member?.withdrawalPinHash),
        lockedUntil: member?.withdrawalPinLockedUntil || null,
      });
    } catch (err) {
      res.status(500).json({
        message: "Failed to check withdrawal PIN status.",
      });
    }
  }
);

// Change an existing withdrawal PIN.
// This endpoint is intended for the Profile > Security section.
router.patch(
  "/pin",
  protect,
  requireApprovedMember,
  async (req, res) => {
    try {
      const { currentPin, newPin, confirmPin } = req.body;

      const member = await User.findById(req.user._id).select(
        "+withdrawalPinHash +withdrawalPinFailedAttempts +withdrawalPinLockedUntil"
      );

      if (!member?.withdrawalPinHash) {
        return res.status(400).json({
          message: "Create a withdrawal PIN first.",
        });
      }

      if (
        !/^\d{4}$/.test(String(currentPin || "")) ||
        !/^\d{4}$/.test(String(newPin || ""))
      ) {
        return res.status(400).json({
          message: "PIN must be exactly 4 digits.",
        });
      }

      if (newPin !== confirmPin) {
        return res.status(400).json({
          message: "New withdrawal PINs do not match.",
        });
      }

      if (
        member.withdrawalPinLockedUntil &&
        member.withdrawalPinLockedUntil > new Date()
      ) {
        return res.status(429).json({
          message:
            "Withdrawal PIN is temporarily locked. Please try again later.",
          lockedUntil: member.withdrawalPinLockedUntil,
        });
      }

      const matches = await bcrypt.compare(
        String(currentPin),
        member.withdrawalPinHash
      );

      if (!matches) {
        return res.status(401).json({
          message: "Current withdrawal PIN is incorrect.",
        });
      }

      member.withdrawalPinHash = await bcrypt.hash(String(newPin), 12);
      member.withdrawalPinFailedAttempts = 0;
      member.withdrawalPinLockedUntil = null;

      await member.save();

      return res.json({
        message: "Withdrawal PIN changed successfully.",
      });
    } catch (err) {
      console.error("Change withdrawal PIN:", err);

      return res.status(500).json({
        message: "Failed to change withdrawal PIN.",
      });
    }
  }
);

// GET /api/withdrawals/banks
router.get(
  "/banks",
  protect,
  requireApprovedMember,
  async (req, res) => {
    try {
      const data = await paystack(
        "/bank?currency=NGN&country=nigeria&perPage=100"
      );

      const banks = (Array.isArray(data) ? data : [])
        .filter((bank) => bank.active && !bank.is_deleted)
        .map((bank) => ({
          name: bank.name,
          code: bank.code,
        }));

      res.json(banks);
    } catch (err) {
      res.status(502).json({
        message: err.message,
      });
    }
  }
);

// POST /api/withdrawals/verify-account
router.post(
  "/verify-account",
  protect,
  requireApprovedMember,
  async (req, res) => {
    try {
      const accountNumber = String(
        req.body.accountNumber || ""
      ).trim();

      const bankCode = String(req.body.bankCode || "").trim();

      if (!/^\d{10}$/.test(accountNumber)) {
        return res.status(400).json({
          message: "Enter a valid 10-digit account number.",
        });
      }

      if (!bankCode) {
        return res.status(400).json({
          message: "Select a bank.",
        });
      }

      const data = await paystack(
        `/bank/resolve?account_number=${encodeURIComponent(
          accountNumber
        )}&bank_code=${encodeURIComponent(bankCode)}`
      );

      res.json({
        accountNumber: data.account_number,
        accountName: data.account_name,
      });
    } catch (err) {
      res.status(400).json({
        message:
          err.message || "Could not verify this bank account.",
      });
    }
  }
);

// GET /api/withdrawals/me
router.get(
  "/me",
  protect,
  requireApprovedMember,
  async (req, res) => {
    try {
      const withdrawals = await Withdrawal.find({
        user: req.user._id,
      }).sort("-createdAt");

      const savings = Math.max(0, Number(req.user.savingsBalance || 0));
      const reserved = Math.max(0, Number(req.user.withdrawalReserved || 0));

      const yearStart = new Date(new Date().getFullYear(), 0, 1);
      const yearEnd = new Date(new Date().getFullYear() + 1, 0, 1);

      const annualWithdrawal = await Withdrawal.findOne({
        user: req.user._id,
        $or: [
          { source: "savings" },
          { source: { $exists: false } },
        ],
        createdAt: { $gte: yearStart, $lt: yearEnd },
        status: { $in: ["processing", "success"] },
      }).sort("createdAt");

      const maxGrossDeduction = savings * WITHDRAWAL_PERCENTAGE;
      const availableAmount = Math.max(0, maxGrossDeduction - reserved);

      const activeLoan = await Loan.findOne({
        user: req.user._id,
        status: "active",
      }).sort("-disbursedDate -createdAt");

      const debtLoan = await Loan.findOne({
        user: req.user._id,
        status: { $in: ["active", "defaulted"] },
        outstandingBalance: { $gt: 0 },
      }).sort("-disbursedDate -createdAt");

      const outstandingLoan = debtLoan
        ? Math.max(0, Number(debtLoan.outstandingBalance || 0))
        : 0;
      const loanAmount = activeLoan
        ? Math.max(0, Number(activeLoan.amount || 0))
        : 0;
      const loanFundsWithdrawn = activeLoan
        ? Math.max(0, Number(activeLoan.loanFundsWithdrawn || 0))
        : 0;
      const loanFundsReserved = activeLoan
        ? Math.max(0, Number(activeLoan.loanFundsReserved || 0))
        : 0;
      const availableLoanFunds = activeLoan
        ? Math.max(0, loanAmount - loanFundsWithdrawn - loanFundsReserved)
        : 0;

      res.json({
        savingsBalance: savings,
        withdrawalPercentage: WITHDRAWAL_PERCENTAGE * 100,
        administrativeFee: ADMINISTRATIVE_FEE,
        maxGrossDeduction,
        availableAmount: annualWithdrawal ? 0 : availableAmount,
        reservedAmount: reserved,
        annualWithdrawalUsed: Boolean(annualWithdrawal),
        annualWithdrawal: annualWithdrawal || null,
        hasOutstandingLoan: outstandingLoan > 0,
        outstandingLoan,
        loanFunds: {
          hasActiveLoan: Boolean(activeLoan),
          loanId: activeLoan?._id || null,
          approvedAmount: loanAmount,
          totalRepayment: activeLoan ? Number(activeLoan.totalRepayment || 0) : 0,
          amountPaid: activeLoan ? Number(activeLoan.amountPaid || 0) : 0,
          outstandingBalance: outstandingLoan,
          amountWithdrawn: loanFundsWithdrawn,
          reservedAmount: loanFundsReserved,
          availableAmount: availableLoanFunds,
          status: activeLoan?.status || null,
        },
        withdrawals,
      });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

// GET /api/withdrawals/:id/receipt
// Returns receipt data only for the member who owns a successful withdrawal.
router.get("/:id/receipt", protect, requireApprovedMember, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid withdrawal ID." });
    }

    const withdrawal = await Withdrawal.findOne({
      _id: req.params.id,
      user: req.user._id,
    }).lean();

    if (!withdrawal) {
      return res.status(404).json({ message: "Withdrawal not found." });
    }

    if (withdrawal.status !== "success") {
      return res.status(409).json({
        message: "A receipt is available only after the withdrawal is successful.",
      });
    }

    const member = await User.findById(req.user._id)
      .select("fullName email")
      .lean();

    return res.json({
      cooperativeName: "EXCLUSIVE (OSHODI/ISOLO) COOPERATIVE MULTIPURPOSE SOCIETY LIMITED",
      source: withdrawal.source || "savings",
      loan: withdrawal.loan || null,
      memberName: member?.fullName || "Member",
      memberEmail: member?.email || "",
      amount: withdrawal.amount,
      administrativeFee: Number(withdrawal.administrativeFee || 0),
      totalDeduction: Number(withdrawal.totalDeduction ?? withdrawal.amount ?? 0),
      bankName: withdrawal.bankName,
      accountName: withdrawal.accountName,
      accountNumberLast4: withdrawal.accountNumberLast4,
      reference: withdrawal.reference,
      transferCode: withdrawal.transferCode || null,
      createdAt: withdrawal.createdAt,
      paidAt: withdrawal.paidAt || withdrawal.updatedAt || withdrawal.createdAt,
      status: withdrawal.status,
    });
  } catch (err) {
    console.error("Get withdrawal receipt:", err);
    return res.status(500).json({ message: "Could not load withdrawal receipt." });
  }
});

// POST /api/withdrawals
//
// source = "savings": ordinary savings withdrawal, subject to the 60%
// once-per-calendar-year rule.
// source = "loan": draw down unused funds from an active loan.
// These two ledgers are kept completely separate.
router.post(
  "/",
  protect,
  requireApprovedMember,
  async (req, res) => {
    try {
      const source = String(req.body.source || "savings").trim().toLowerCase();
      const amount = Number(req.body.amount);
      const pin = String(req.body.pin || "");
      const bankCode = String(req.body.bankCode || "").trim();
      const bankName = String(req.body.bankName || "").trim();
      const accountNumber = String(req.body.accountNumber || "").trim();
      const accountName = String(req.body.accountName || "").trim();

      if (!["savings", "loan"].includes(source)) {
        return res.status(400).json({ message: "Choose savings or loan funds." });
      }
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

      const memberForPin = await User.findById(req.user._id).select(
        "+withdrawalPinHash +withdrawalPinFailedAttempts +withdrawalPinLockedUntil"
      );
      if (!memberForPin?.withdrawalPinHash) {
        return res.status(400).json({ message: "Create your withdrawal PIN before withdrawing." });
      }
      if (memberForPin.withdrawalPinLockedUntil && memberForPin.withdrawalPinLockedUntil > new Date()) {
        return res.status(429).json({
          message: "Withdrawal PIN is temporarily locked after too many failed attempts. Please try again later.",
          lockedUntil: memberForPin.withdrawalPinLockedUntil,
        });
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

      const resolved = await paystack(
        `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`
      );
      if (!resolved.account_name) {
        return res.status(400).json({ message: "We could not verify this bank account." });
      }

      const freshMember = await User.findById(req.user._id);
      if (!freshMember) {
        return res.status(404).json({ message: "Member account not found." });
      }

      let loanForWithdrawal = null;
      let annualWithdrawal = null;
      let reservationCreated = false;

      if (source === "savings") {
        const outstandingLoan = await Loan.findOne({
          user: freshMember._id,
          status: { $in: ["active", "defaulted"] },
          outstandingBalance: { $gt: 0 },
        }).select("outstandingBalance");
        if (outstandingLoan) {
          return res.status(400).json({
            message: "You cannot withdraw from savings while you have an outstanding loan. Please fully repay your loan first.",
          });
        }

        const yearStart = new Date(new Date().getFullYear(), 0, 1);
        const yearEnd = new Date(new Date().getFullYear() + 1, 0, 1);
        annualWithdrawal = await Withdrawal.findOne({
          user: freshMember._id,
          $or: [
            { source: "savings" },
            { source: { $exists: false } },
          ],
          createdAt: { $gte: yearStart, $lt: yearEnd },
          status: { $in: ["processing", "success"] },
        });
        if (annualWithdrawal) {
          return res.status(400).json({
            message: "You have already made a savings withdrawal this year. You can make another one next year.",
          });
        }

        const savings = Math.max(0, Number(freshMember.savingsBalance || 0));
        const reserved = Math.max(0, Number(freshMember.withdrawalReserved || 0));
        const availableBeforeReservation = Math.max(0, savings * WITHDRAWAL_PERCENTAGE - reserved);
        if (amount > availableBeforeReservation) {
          return res.status(400).json({
            message: `You can withdraw up to ₦${availableBeforeReservation.toLocaleString()} from savings this year.`,
          });
        }

        const reservedUser = await User.findOneAndUpdate(
          {
            _id: freshMember._id,
            $expr: {
              $gte: [
                { $subtract: [{ $multiply: ["$savingsBalance", WITHDRAWAL_PERCENTAGE] }, "$withdrawalReserved"] },
                amount,
              ],
            },
          },
          { $inc: { withdrawalReserved: amount } },
          { new: true }
        );
        if (!reservedUser) {
          return res.status(409).json({ message: "Your savings withdrawal balance changed. Refresh and try again." });
        }
        reservationCreated = true;
      } else {
        loanForWithdrawal = await Loan.findOneAndUpdate(
          {
            user: freshMember._id,
            status: { $in: ["active", "defaulted"] },
            $expr: {
              $gte: [
                {
                  $subtract: [
                    "$amount",
                    { $add: ["$loanFundsWithdrawn", "$loanFundsReserved"] },
                  ],
                },
                amount,
              ],
            },
          },
          { $inc: { loanFundsReserved: amount } },
          { new: true }
        );
        if (!loanForWithdrawal) {
          return res.status(400).json({
            message: "You do not have enough available loan funds for this withdrawal, or you do not have an active loan.",
          });
        }
        reservationCreated = true;
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
            email: freshMember.email,
          }),
        });

        const reference = `wd_${crypto.randomUUID().replace(/-/g, "").slice(0, 32)}`;
        withdrawal = await Withdrawal.create({
          user: freshMember._id,
          source,
          loan: source === "loan" ? loanForWithdrawal._id : null,
          amount,
          administrativeFee: 0,
          totalDeduction: amount,
          bankCode,
          bankName,
          accountName: resolved.account_name,
          accountNumberLast4: accountNumber.slice(-4),
          recipientCode: recipient.recipient_code,
          reference,
          status: "processing",
        });

        await Notification.create({
          user: freshMember._id,
          type: "withdrawal",
          title: source === "loan" ? "Loan Funds Withdrawal Submitted" : "Savings Withdrawal Submitted",
          message:
            source === "loan"
              ? `Your withdrawal of ₦${amount.toLocaleString()} from your available loan funds has been submitted and is being processed.`
              : `Your savings withdrawal of ₦${amount.toLocaleString()} has been submitted and is being processed.`,
        });

        const transfer = await paystack("/transfer", {
          method: "POST",
          body: JSON.stringify({
            source: "balance",
            amount: Math.round(amount * 100),
            recipient: recipient.recipient_code,
            reference,
            reason:
              source === "loan"
                ? `Exclusive Cooperative loan funds withdrawal for ${freshMember.fullName}`
                : `Exclusive Cooperative savings withdrawal for ${freshMember.fullName}`,
            currency: "NGN",
          }),
        });

        withdrawal.transferCode = transfer.transfer_code || null;
        withdrawal.status = transfer.status === "success" ? "success" : "processing";

        if (withdrawal.status === "success") {
          await settleWithdrawal(withdrawal, "success");
          await Notification.create({
            user: withdrawal.user,
            type: "withdrawal",
            title: "Withdrawal Successful",
            message: `Your ${source === "loan" ? "loan-funds" : "savings"} withdrawal of ₦${amount.toLocaleString()} has been successfully processed.`,
          });
        } else {
          await withdrawal.save();
        }

        const finalUser = await User.findById(freshMember._id).select("savingsBalance withdrawalReserved");
        const finalLoan = source === "loan"
          ? await Loan.findById(loanForWithdrawal._id).select("amount totalRepayment amountPaid outstandingBalance loanFundsWithdrawn loanFundsReserved status")
          : null;
        const finalLoanAvailable = finalLoan
          ? Math.max(0, Number(finalLoan.amount || 0) - Number(finalLoan.loanFundsWithdrawn || 0) - Number(finalLoan.loanFundsReserved || 0))
          : 0;

        return res.status(201).json({
          message:
            withdrawal.status === "success"
              ? source === "loan" ? "Loan funds withdrawal completed successfully." : "Savings withdrawal completed successfully."
              : source === "loan" ? "Loan funds withdrawal submitted and is being processed." : "Savings withdrawal submitted and is being processed.",
          withdrawal,
          source,
          savingsBalance: Number(finalUser?.savingsBalance || 0),
          withdrawalPercentage: WITHDRAWAL_PERCENTAGE * 100,
          administrativeFee: 0,
          availableAmount:
            source === "savings"
              ? withdrawal.status === "success" || withdrawal.status === "processing"
                ? 0
                : Math.max(0, Number(finalUser?.savingsBalance || 0) * WITHDRAWAL_PERCENTAGE - Number(finalUser?.withdrawalReserved || 0))
              : Math.max(0, Number(finalUser?.savingsBalance || 0) * WITHDRAWAL_PERCENTAGE - Number(finalUser?.withdrawalReserved || 0)),
          annualWithdrawalUsed: source === "savings" && (withdrawal.status === "success" || withdrawal.status === "processing"),
          withdrawalReserved: Number(finalUser?.withdrawalReserved || 0),
          loanFunds: finalLoan
            ? {
                loanId: finalLoan._id,
                approvedAmount: Number(finalLoan.amount || 0),
                totalRepayment: Number(finalLoan.totalRepayment || 0),
                amountPaid: Number(finalLoan.amountPaid || 0),
                outstandingBalance: Number(finalLoan.outstandingBalance || 0),
                amountWithdrawn: Number(finalLoan.loanFundsWithdrawn || 0),
                reservedAmount: Number(finalLoan.loanFundsReserved || 0),
                availableAmount: finalLoanAvailable,
                status: finalLoan.status,
              }
            : null,
        });
      } catch (err) {
        if (withdrawal) {
          try {
            await settleWithdrawal(withdrawal, "failed", err.message || "Transfer could not be initiated.");
          } catch (settleError) {
            console.error("Withdrawal settlement error:", settleError);
          }
        } else if (reservationCreated && source === "loan" && loanForWithdrawal) {
          await Loan.findOneAndUpdate(
            { _id: loanForWithdrawal._id, loanFundsReserved: { $gte: amount } },
            { $inc: { loanFundsReserved: -amount } }
          );
        } else if (reservationCreated && source === "savings") {
          await User.findOneAndUpdate(
            { _id: freshMember._id, withdrawalReserved: { $gte: amount } },
            { $inc: { withdrawalReserved: -amount } }
          );
        }
        return res.status(502).json({ message: err.message || "Could not start the bank transfer." });
      }
    } catch (err) {
      console.error("Create withdrawal:", err);
      return res.status(500).json({ message: err.message });
    }
  }
);

// POST /api/withdrawals/paystack/webhook
//
// Configure this URL in:
// Paystack Dashboard -> API Keys & Webhooks
router.post("/paystack/webhook", async (req, res) => {
  const signature =
    req.headers["x-paystack-signature"];

  if (!signature) {
    return res.sendStatus(401);
  }

  const payload = JSON.stringify(req.body);

  const expected = crypto
    .createHmac(
      "sha512",
      process.env.PAYSTACK_SECRET_KEY
    )
    .update(payload)
    .digest("hex");

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    signatureBuffer.length !==
      expectedBuffer.length ||
    !crypto.timingSafeEqual(
      signatureBuffer,
      expectedBuffer
    )
  ) {
    return res.sendStatus(401);
  }

  // Acknowledge immediately so Paystack does not keep retrying.
  res.sendStatus(200);

  try {
    const { event, data } = req.body || {};

    if (!data?.reference) return;

    if (
      ![
        "transfer.success",
        "transfer.failed",
        "transfer.reversed",
      ].includes(event)
    ) {
      return;
    }

    const withdrawal =
      await Withdrawal.findOne({
        reference: data.reference,
      });

    if (!withdrawal) return;

    // Idempotency: don't settle a transfer twice.
    if (
      ["success", "failed", "reversed", "rejected"].includes(
        withdrawal.status
      )
    ) {
      return;
    }

    if (event === "transfer.success") {
  withdrawal.transferCode =
    data.transfer_code ||
    withdrawal.transferCode;

  await settleWithdrawal(
    withdrawal,
    "success"
  );

  await Notification.create({
    user: withdrawal.user,
    type: "withdrawal",
    title: "Withdrawal Successful",
    message: `Your withdrawal of ₦${Number(
      withdrawal.amount || 0
    ).toLocaleString()} has been successfully processed.`,
  });

  return;
}

    const finalStatus =
  event === "transfer.reversed"
    ? "reversed"
    : "failed";

withdrawal.transferCode =
  data.transfer_code ||
  withdrawal.transferCode;

await settleWithdrawal(
  withdrawal,
  finalStatus,
  data.failures ||
    data.message ||
    `Paystack transfer ${finalStatus}.`
);

const notificationTitle =
  finalStatus === "reversed"
    ? "Withdrawal Reversed"
    : "Withdrawal Failed";

const notificationMessage =
  finalStatus === "reversed"
    ? `Your withdrawal of ₦${Number(
        withdrawal.amount || 0
      ).toLocaleString()} has been reversed.`
    : `Your withdrawal of ₦${Number(
        withdrawal.amount || 0
      ).toLocaleString()} could not be completed.`;

await Notification.create({
  user: withdrawal.user,
  type: "withdrawal",
  title: notificationTitle,
  message: notificationMessage,
});
  } catch (err) {
    console.error(
      "Withdrawal webhook processing error:",
      err
    );
  }
});

export default router;
