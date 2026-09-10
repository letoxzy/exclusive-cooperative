import express from "express";
import SavingsTransaction from "../models/SavingsTransaction.js";
import Notification from "../models/Notification.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireApprovedMember } from "../middleware/membershipMiddleware.js";

const router = express.Router();
const PAYSTACK_BASE = "https://api.paystack.co";

// POST /api/payments/paystack/initialize
// Starts a real Paystack transaction and returns the checkout URL.
router.post(
  "/paystack/initialize",
  protect,
  requireApprovedMember,
  async (req, res) => {
    const { amount, mobile } = req.body;

    if (typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({
        message: "Enter a valid positive amount",
      });
    }

    try {
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
    await SavingsTransaction.create({
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