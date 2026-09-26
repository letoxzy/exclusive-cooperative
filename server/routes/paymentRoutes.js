import express from "express";
import crypto from "crypto";
import SavingsTransaction from "../models/SavingsTransaction.js";
import Membership from "../models/Membership.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireApprovedMember } from "../middleware/membershipMiddleware.js";
import { getContributionStatus } from "../utils/contributionRules.js";
import { creditPaystackSavingsPayment } from "../utils/paystackSavingsSettlement.js";

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
      console.error("Paystack initialize error:", err);
      res.status(500).json({
        message: "Could not start payment. Please try again.",
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
    // Someone may have already confirmed this exact payment (the webhook
    // usually beats the client here). Report it rather than re-verifying.
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

    const result = await creditPaystackSavingsPayment({
      userId: req.user._id,
      amount,
      reference,
    });

    res.json({
      status: result.alreadyProcessed ? "already_processed" : "success",
      amount: result.amount,
      savingsBalance: result.savingsBalance,
    });
  } catch (err) {
    console.error("Paystack verify error:", err);
    res.status(500).json({
      message: "We could not confirm this payment right now. Please try again shortly.",
    });
  }
});

// POST /api/payments/paystack/webhook
//
// Server-to-server safety net: even if the member's app/browser never
// calls /verify (closed tab, killed app, dropped connection right after
// paying), Paystack still tells us here, so the deposit isn't lost.
//
// Configure this URL in:
// Paystack Dashboard -> API Keys & Webhooks
router.post("/paystack/webhook", async (req, res) => {
  const signature = req.headers["x-paystack-signature"];

  if (!signature) {
    return res.sendStatus(401);
  }

  const payload = JSON.stringify(req.body);

  const expected = crypto
    .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
    .update(payload)
    .digest("hex");

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return res.sendStatus(401);
  }

  // Acknowledge immediately so Paystack does not keep retrying.
  res.sendStatus(200);

  try {
    const { event, data } = req.body || {};

    if (event !== "charge.success" || !data?.reference) return;

    // Only handle savings top-ups here; other charge.success events
    // (if this account ever adds other charge types) are ignored.
    const userId = data.metadata?.userId;
    if (!userId) return;

    const amount = Number(data.amount || 0) / 100;
    if (!amount) return;

    await creditPaystackSavingsPayment({
      userId,
      amount,
      reference: data.reference,
    });
  } catch (err) {
    console.error("Paystack savings webhook processing error:", err);
  }
});

export default router;