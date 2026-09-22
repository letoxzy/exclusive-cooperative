import express from "express";
import SavingsTransaction from "../models/SavingsTransaction.js";
import Notification from "../models/Notification.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireApprovedMember } from "../middleware/membershipMiddleware.js";
import { sendPushNotification } from "../utils/pushNotification.js";
import {
  MINIMUM_CONTRIBUTION,
  LOCKED_SAVINGS_PERCENTAGE,
  WITHDRAWABLE_PERCENTAGE,
  getContributionStatus,
  getContributionWindow,
  getMemberContributionFrequency,
} from "../utils/contributionRules.js";

const router = express.Router();
const PAYSTACK_BASE = "https://api.paystack.co";

// GET /api/payments/contribution-status
// Returns the member's selected contribution frequency and whether the
// regular contribution for the current frequency window has been made.
router.get("/contribution-status", protect, requireApprovedMember, async (req, res) => {
  try {
    const status = await getContributionStatus(req.user);
    return res.json(status);
  } catch (err) {
    return res.status(500).json({ message: "Could not load contribution status." });
  }
});

// POST /api/payments/paystack/initialize
// Starts a real Paystack transaction and returns the checkout URL.
router.post(
  "/paystack/initialize",
  protect,
  requireApprovedMember,
  async (req, res) => {
    const { amount, mobile } = req.body;

    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < MINIMUM_CONTRIBUTION) {
      return res.status(400).json({
        message: `The minimum regular contribution is ₦${MINIMUM_CONTRIBUTION.toLocaleString()}.`,
      });
    }

    try {
      const contributionStatus = await getContributionStatus(req.user);
      if (!contributionStatus.canContribute) {
        return res.status(400).json({
          message: `You have already made your ${contributionStatus.frequency.toLowerCase()} contribution. Your next contribution is available in the next ${contributionStatus.frequency.toLowerCase()} period.`,
          ...contributionStatus,
        });
      }

      const contributionFrequency = contributionStatus.frequency;
      const contributionWindow = getContributionWindow(contributionFrequency);
      const callbackUrl = mobile
        ? "exclusivecooperative://payment-callback"
        : `${process.env.CLIENT_URL}/payment-callback`;

      const response = await fetch(
        `${PAYSTACK_BASE}/transaction/initialize`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: req.user.email,
            amount: Math.round(amount * 100),
            callback_url: callbackUrl,
            metadata: {
              userId: req.user._id.toString(),
              platform: mobile ? "mobile" : "web",
              contributionFrequency,
              contributionPeriod: contributionWindow.periodKey,
            },
          }),
        }
      );

      const data = await response.json();

      if (!data.status) {
        return res.status(400).json({
          message: data.message || "Could not start payment",
        });
      }

      res.json({
        authorizationUrl: data.data.authorization_url,
        reference: data.data.reference,
      });
    } catch (err) {
      res.status(500).json({
        message: err.message,
      });
    }
  }
);

// GET /api/payments/paystack/receipt/:reference
// Returns receipt data for a successful Paystack savings payment owned by the member.
router.get("/paystack/receipt/:reference", protect, requireApprovedMember, async (req, res) => {
  try {
    const transaction = await SavingsTransaction.findOne({
      user: req.user._id,
      reference: req.params.reference,
      method: "paystack",
      status: "approved",
    });

    if (!transaction) {
      return res.status(404).json({
        message: "Payment receipt not found.",
      });
    }

    return res.json({
      cooperativeName: "EXCLUSIVE (OSHODI/ISOLO) COOPERATIVE MULTIPURPOSE SOCIETY LIMITED",
      memberName: req.user.fullName || req.user.name || "Member",
      memberEmail: req.user.email || "",
      amount: Number(transaction.amount || 0),
      method: transaction.method,
      reference: transaction.reference,
      status: transaction.status,
      createdAt: transaction.createdAt,
    });
  } catch (err) {
    console.error("Get payment receipt:", err);
    return res.status(500).json({ message: "Could not load payment receipt." });
  }
});

// GET /api/payments/paystack/verify/:reference
// Called after the member returns from Paystack's checkout page.
router.get("/paystack/verify/:reference", protect, async (req, res) => {
  const { reference } = req.params;

  try {
    // Prevent the same Paystack payment from being credited twice.
    const existing = await SavingsTransaction.findOne({ reference });

    if (existing) {
      return res.json({
        status: "already_processed",
        amount: existing.amount,
      });
    }

    // Verify the transaction directly with Paystack.
    const response = await fetch(
      `${PAYSTACK_BASE}/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const data = await response.json();

    if (!data.status || data.data.status !== "success") {
      return res.status(400).json({
        message: "Payment was not successful",
      });
    }

    // Paystack returns the amount in kobo.
    const amount = data.data.amount / 100;
    if (amount < MINIMUM_CONTRIBUTION) {
      return res.status(400).json({
        message: `The minimum regular contribution is ₦${MINIMUM_CONTRIBUTION.toLocaleString()}.`,
      });
    }

    const contributionFrequency = await getMemberContributionFrequency(req.user);
    const contributionWindow = getContributionWindow(contributionFrequency);

    // Enforce the selected Daily/Weekly/Monthly contribution frequency on
    // successful payment as well as at checkout initialization.
    const existingContribution = await SavingsTransaction.findOne({
      user: req.user._id,
      status: "approved",
      createdAt: { $gte: contributionWindow.start, $lt: contributionWindow.end },
    });
    if (existingContribution) {
      return res.status(409).json({
        message: `You have already made your ${contributionFrequency.toLowerCase()} contribution for this period.`,
      });
    }

    const lockedAmount = Math.round(amount * LOCKED_SAVINGS_PERCENTAGE * 100) / 100;
    const withdrawalAmount = Math.round(amount * WITHDRAWABLE_PERCENTAGE * 100) / 100;

    // Record the full contribution and preserve the exact 60/40 split.
    const transaction = await SavingsTransaction.create({
      user: req.user._id,
      amount,
      lockedAmount,
      withdrawalAmount,
      contributionFrequency,
      contributionPeriod: contributionWindow.periodKey,
      status: "approved",
      method: "paystack",
      reference,
    });

    // Savings Balance represents the full amount the member has contributed.
    // The 60/40 split is used only to calculate monthly withdrawal eligibility.
    req.user.savingsBalance += amount;
    await req.user.save();

    // Create an in-app notification.
    await Notification.create({
      user: req.user._id,
      type: "savings",
      title: "Savings Payment Successful",
      message: `Your ₦${amount.toLocaleString()} contribution was successful. Your savings balance has been updated. Your monthly withdrawal amount is calculated separately.`,
      data: {
        reference,
        amount,
        lockedAmount,
        withdrawalAmount,
        transactionId: transaction._id.toString(),
      },
    });

    await sendPushNotification(req.user, {
  title: "Contribution Successful",
  body: `₦${amount.toLocaleString()} received. Your savings balance has been updated, and your monthly withdrawal amount is calculated separately.`,
  data: {
    type: "savings",
    reference,
    amount,
    lockedAmount,
    withdrawalAmount,
    transactionId: transaction._id.toString(),
  },
});

    res.json({
      status: "success",
      amount,
      savingsBalance: req.user.savingsBalance,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

export default router;