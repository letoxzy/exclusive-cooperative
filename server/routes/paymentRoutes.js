import express from "express";
import SavingsTransaction from "../models/SavingsTransaction.js";
import Membership from "../models/Membership.js";
import Notification from "../models/Notification.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireApprovedMember } from "../middleware/membershipMiddleware.js";
import { sendPushNotification } from "../utils/pushNotification.js";
import { getContributionStatus } from "../utils/contributionRules.js";

const router = express.Router();
const PAYSTACK_BASE = "https://api.paystack.co";

const MIN_CONTRIBUTION = 10000;

function normalizeFrequency(value) {
  const frequency = String(value || "monthly").trim().toLowerCase();
  if (frequency === "daily") return "daily";
  if (frequency === "weekly") return "weekly";
  return "monthly";
}

function sameCalendarDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function sameCalendarMonth(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth()
  );
}

// GET /api/payments/contribution-status
// Returns the member's current contribution window/status for the mobile app.
router.get(
  "/contribution-status",
  protect,
  requireApprovedMember,
  async (req, res) => {
    try {
      const status = await getContributionStatus(req.user);
      return res.json(status);
    } catch (err) {
      console.error("Get contribution status:", err);
      return res.status(500).json({
        message: "Could not load contribution status.",
      });
    }
  },
);

// POST /api/payments/paystack/initialize
// Starts a real Paystack transaction and returns the checkout URL.
router.post(
  "/paystack/initialize",
  protect,
  requireApprovedMember,
  async (req, res) => {
    const { amount, mobile } = req.body;

    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < MIN_CONTRIBUTION) {
      return res.status(400).json({
        message: `The minimum contribution is ₦${MIN_CONTRIBUTION.toLocaleString()}.`,
      });
    }

    try {
      const membership = await Membership.findOne({
        user: req.user._id,
        status: "approved",
      }).select("frequency");

      const frequency = normalizeFrequency(membership?.frequency);
      const lastContribution = await SavingsTransaction.findOne({
        user: req.user._id,
        status: "approved",
      }).sort("-createdAt");

      if (lastContribution?.createdAt) {
        const now = new Date();
        const lastDate = new Date(lastContribution.createdAt);

        if (frequency === "daily" && sameCalendarDay(now, lastDate)) {
          return res.status(400).json({
            message: "You have already made your daily contribution. You can contribute again tomorrow.",
          });
        }

        if (frequency === "weekly") {
          const daysSinceLastContribution =
            (Date.now() - lastDate.getTime()) / (24 * 60 * 60 * 1000);

          if (daysSinceLastContribution < 7) {
            return res.status(400).json({
              message: "You have already made your weekly contribution. You can contribute again after 7 days.",
            });
          }
        }

        if (frequency === "monthly" && sameCalendarMonth(now, lastDate)) {
          return res.status(400).json({
            message: "You have already made your monthly contribution. You can contribute again next month.",
          });
        }
      }

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

    // Record the successful savings transaction.
    const transaction = await SavingsTransaction.create({
      user: req.user._id,
      amount,
      status: "approved",
      method: "paystack",
      reference,
    });

    // Update the member's savings balance.
    req.user.savingsBalance += amount;
    await req.user.save();

    // Create an in-app notification.
    await Notification.create({
      user: req.user._id,
      type: "savings",
      title: "Savings Payment Successful",
      message: `Your savings payment of ₦${amount.toLocaleString()} was successful.`,
      data: {
        reference,
        amount,
        transactionId: transaction._id.toString(),
      },
    });

    await sendPushNotification(req.user, {
  title: "Savings Payment Successful",
  body: `Your savings payment of ₦${amount.toLocaleString()} was successful.`,
  data: {
    type: "savings",
    reference,
    amount,
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