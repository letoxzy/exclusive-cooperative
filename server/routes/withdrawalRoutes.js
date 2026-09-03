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

// Withdrawal rules from the cooperative bye-law.
const WITHDRAWAL_PERCENTAGE = 0.60;
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

async function paystack(path, options = {}) {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    throw new Error("PAYSTACK_SECRET_KEY is not configured.");
  }

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
    const error = new Error(
      data.message || "Paystack request failed"
    );
    error.status = response.status;
    error.paystack = data;
    throw error;
  }

  return data.data;
}

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
        createdAt: { $gte: yearStart, $lt: yearEnd },
        status: { $in: ["processing", "success"] },
      }).sort("createdAt");

      const maxGrossDeduction = savings * WITHDRAWAL_PERCENTAGE;
      const availableAmount = Math.max(
        0,
        maxGrossDeduction - reserved
      );

      const hasOutstandingLoan = await Loan.exists({
        user: req.user._id,
        status: { $in: ["active", "defaulted"] },
        outstandingBalance: { $gt: 0 },
      });

      res.json({
        savingsBalance: savings,
        withdrawalPercentage: WITHDRAWAL_PERCENTAGE * 100,
        administrativeFee: ADMINISTRATIVE_FEE,
        maxGrossDeduction,
        availableAmount: annualWithdrawal ? 0 : availableAmount,
        reservedAmount: reserved,
        annualWithdrawalUsed: Boolean(annualWithdrawal),
        annualWithdrawal: annualWithdrawal || null,
        hasOutstandingLoan: Boolean(hasOutstandingLoan),
        withdrawals,
      });
    } catch (err) {
      res.status(500).json({
        message: err.message,
      });
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
      memberName: member?.fullName || "Member",
      memberEmail: member?.email || "",
      amount: withdrawal.amount,
      administrativeFee: withdrawal.administrativeFee ?? ADMINISTRATIVE_FEE,
      totalDeduction:
        withdrawal.totalDeduction ?? Number(withdrawal.amount || 0),
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
// The server:
// 1. verifies the 4-digit PIN
// 2. resolves the bank account again
// 3. checks the member has no outstanding loan
// 4. enforces one withdrawal per calendar year
// 5. limits the total savings deduction to 60% of savings
// 6. atomically reserves the withdrawal amount
// 7. creates the Paystack recipient and starts the transfer
//
// Paystack webhook later confirms success/failure/reversal.
router.post(
  "/",
  protect,
  requireApprovedMember,
  async (req, res) => {
    try {
      const amount = Number(req.body.amount);
      const pin = String(req.body.pin || "");
      const bankCode = String(req.body.bankCode || "").trim();
      const bankName = String(req.body.bankName || "").trim();
      const accountNumber = String(
        req.body.accountNumber || ""
      ).trim();
      const accountName = String(
        req.body.accountName || ""
      ).trim();

      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({
          message: "Enter a valid withdrawal amount.",
        });
      }

      if (!/^\d{4}$/.test(pin)) {
        return res.status(400).json({
          message: "Enter your 4-digit withdrawal PIN.",
        });
      }

      if (!bankCode || !bankName) {
        return res.status(400).json({
          message: "Select a valid bank.",
        });
      }

      if (!/^\d{10}$/.test(accountNumber)) {
        return res.status(400).json({
          message: "Enter a valid 10-digit account number.",
        });
      }

      if (!accountName) {
        return res.status(400).json({
          message:
            "Verify the bank account before withdrawing.",
        });
      }

      // Fresh member copy with the hidden PIN fields.
      const memberForPin = await User.findById(req.user._id).select(
        "+withdrawalPinHash +withdrawalPinFailedAttempts +withdrawalPinLockedUntil"
      );

      if (!memberForPin?.withdrawalPinHash) {
        return res.status(400).json({
          message:
            "Create your withdrawal PIN before withdrawing.",
        });
      }

      if (
        memberForPin.withdrawalPinLockedUntil &&
        memberForPin.withdrawalPinLockedUntil > new Date()
      ) {
        return res.status(429).json({
          message:
            "Withdrawal PIN is temporarily locked after too many failed attempts. Please try again later.",
          lockedUntil: memberForPin.withdrawalPinLockedUntil,
        });
      }

      const pinMatches = await bcrypt.compare(
        pin,
        memberForPin.withdrawalPinHash
      );

      if (!pinMatches) {
        memberForPin.withdrawalPinFailedAttempts =
          Number(
            memberForPin.withdrawalPinFailedAttempts || 0
          ) + 1;

        if (memberForPin.withdrawalPinFailedAttempts >= 3) {
          memberForPin.withdrawalPinLockedUntil = new Date(
            Date.now() + 15 * 60 * 1000
          );

          memberForPin.withdrawalPinFailedAttempts = 0;
        }

        await memberForPin.save();

        return res.status(401).json({
          message: "Incorrect withdrawal PIN.",
        });
      }

      memberForPin.withdrawalPinFailedAttempts = 0;
      memberForPin.withdrawalPinLockedUntil = null;
      await memberForPin.save();

      // Resolve the account again on the server.
      // Never trust the account name supplied by the browser.
      const resolved = await paystack(
        `/bank/resolve?account_number=${encodeURIComponent(
          accountNumber
        )}&bank_code=${encodeURIComponent(bankCode)}`
      );

      if (!resolved.account_name) {
        return res.status(400).json({
          message:
            "We could not verify this bank account.",
        });
      }

      // Get a fresh balance from MongoDB.
      const freshMember = await User.findById(req.user._id);

      if (!freshMember) {
        return res.status(404).json({
          message: "Member account not found.",
        });
      }

      const savings = Math.max(0, Number(freshMember.savingsBalance || 0));
      const reserved = Math.max(0, Number(freshMember.withdrawalReserved || 0));

      // The bye-law does not permit a member to withdraw while an
      // outstanding loan remains unpaid.
      const outstandingLoan = await Loan.findOne({
        user: freshMember._id,
        status: { $in: ["active", "defaulted"] },
        outstandingBalance: { $gt: 0 },
      }).select("outstandingBalance status");

      if (outstandingLoan) {
        return res.status(400).json({
          message: "You cannot withdraw while you have an outstanding loan. Please fully repay your loan first.",
        });
      }

      const yearStart = new Date(new Date().getFullYear(), 0, 1);
      const yearEnd = new Date(new Date().getFullYear() + 1, 0, 1);

      const annualWithdrawal = await Withdrawal.findOne({
        user: freshMember._id,
        createdAt: { $gte: yearStart, $lt: yearEnd },
        status: { $in: ["processing", "success"] },
      });

      if (annualWithdrawal) {
        return res.status(400).json({
          message: "You have already made a withdrawal this year. You can make another withdrawal next year.",
        });
      }

      // Section 14.3 permits a maximum withdrawal of 60% of total
      // contribution once per year. The ₦20,000 fee in section 15.8(iii)
      // specifically refers to withdrawal of membership, so it is not
      // applied to this ordinary savings-withdrawal endpoint.
      const maxGrossDeduction = savings * WITHDRAWAL_PERCENTAGE;
      const totalDeduction = amount;
      const availableBeforeReservation = Math.max(
        0,
        maxGrossDeduction - reserved
      );

      if (amount <= 0 || amount > availableBeforeReservation) {
        return res.status(400).json({
          message: `You can withdraw up to ₦${availableBeforeReservation.toLocaleString()} this year.`,
        });
      }

      /* Atomically reserve the exact amount that will be paid out. */
      const reservedUser = await User.findOneAndUpdate(
        {
          _id: freshMember._id,
          $expr: {
            $gte: [
              {
                $subtract: [
                  {
                    $multiply: [
                      "$savingsBalance",
                      WITHDRAWAL_PERCENTAGE,
                    ],
                  },
                  "$withdrawalReserved",
                ],
              },
              totalDeduction,
            ],
          },
        },
        {
          $inc: {
            withdrawalReserved: totalDeduction,
          },
        },
        { new: true }
      );

      if (!reservedUser) {
        return res.status(409).json({
          message:
            "Your available withdrawal changed. Refresh your balance and try again.",
        });
      }

      let withdrawal;

      try {
        const recipient = await paystack(
          "/transferrecipient",
          {
            method: "POST",
            body: JSON.stringify({
              type: "nuban",
              name: resolved.account_name,
              account_number: accountNumber,
              bank_code: bankCode,
              currency: "NGN",
              email: freshMember.email,
            }),
          }
        );

        const reference = `wd_${crypto
          .randomUUID()
          .replace(/-/g, "")
          .slice(0, 32)}`;

        withdrawal = await Withdrawal.create({
          user: freshMember._id,
          amount,
          administrativeFee: 0,
          totalDeduction,
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
          title: "Withdrawal Submitted",
          message: "Your withdrawal request has been submitted and is being processed.",
        });

        const transfer = await paystack(
          "/transfer",
          {
            method: "POST",
            body: JSON.stringify({
              source: "balance",
              amount: Math.round(amount * 100),
              recipient: recipient.recipient_code,
              reference,
              reason: `Exclusive Cooperative withdrawal for ${freshMember.fullName}`,
              currency: "NGN",
            }),
          }
        );

        withdrawal.transferCode =
          transfer.transfer_code || null;

        withdrawal.status =
          transfer.status === "success"
            ? "success"
            : "processing";

        if (withdrawal.status === "success") {
          await settleWithdrawal(
            withdrawal,
            "success"
          );

          await Notification.create({
            user: withdrawal.user,
            type: "withdrawal",
            title: "Withdrawal Successful",
            message: `Your withdrawal of ₦${Number(withdrawal.amount || 0).toLocaleString()} has been successfully processed.`,
          });
        } else {
          await withdrawal.save();
        }

        const finalUser = await User.findById(freshMember._id).select(
          "savingsBalance withdrawalReserved"
        );

        const finalSavings = Math.max(
          0,
          Number(finalUser?.savingsBalance || 0)
        );
        const finalReserved = Math.max(
          0,
          Number(finalUser?.withdrawalReserved || 0)
        );
        const finalAnnualWithdrawal =
          withdrawal.status === "success" || withdrawal.status === "processing";

        return res.status(201).json({
          message:
            withdrawal.status === "success"
              ? "Withdrawal completed successfully."
              : "Withdrawal submitted and is being processed.",
          withdrawal,
          savingsBalance: finalSavings,
          withdrawalPercentage: WITHDRAWAL_PERCENTAGE * 100,
          administrativeFee: 0,
          availableAmount: finalAnnualWithdrawal
            ? 0
            : Math.max(
                0,
                finalSavings * WITHDRAWAL_PERCENTAGE -
                  finalReserved
              ),
          annualWithdrawalUsed: finalAnnualWithdrawal,
          withdrawalReserved: finalReserved,
        });
      } catch (err) {
        if (withdrawal) {
          try {
            await settleWithdrawal(
              withdrawal,
              "failed",
              err.message ||
                "Transfer could not be initiated."
            );

            await Notification.create({
              user: withdrawal.user,
              type: "withdrawal",
              title: "Withdrawal Failed",
              message: `Your withdrawal of ₦${Number(withdrawal.amount || 0).toLocaleString()} could not be completed.`,
            });
          } catch (settleError) {
            console.error(
              "Withdrawal settlement error:",
              settleError
            );
          }
        } else {
          // No Withdrawal document exists yet, so release the
          // temporary reservation directly.
          await User.findOneAndUpdate(
            {
              _id: freshMember._id,
              withdrawalReserved: {
                $gte: totalDeduction,
              },
            },
            {
              $inc: {
                withdrawalReserved: -totalDeduction,
              },
            }
          );
        }

        return res.status(502).json({
          message:
            err.message ||
            "Could not start the bank transfer.",
        });
      }
    } catch (err) {
      console.error("Create withdrawal:", err);

      return res.status(500).json({
        message: err.message,
      });
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
