import express from "express";
import crypto from "crypto";
import SavingsTransaction from "../models/SavingsTransaction.js";
import Membership from "../models/Membership.js";
import Loan from "../models/Loan.js";
import LoanRepayment from "../models/LoanRepayment.js";
import mongoose from "mongoose";
import { protect } from "../middleware/authMiddleware.js";
import { requireApprovedMember } from "../middleware/membershipMiddleware.js";
import { getContributionStatus } from "../utils/contributionRules.js";
import { creditPaystackSavingsPayment } from "../utils/paystackSavingsSettlement.js";
import { creditPaystackLoanRepayment } from "../utils/loanRepaymentSettlement.js";

const router = express.Router();
const PAYSTACK_BASE = "https://api.paystack.co";

const MIN_CONTRIBUTION = 10000;

// Smallest online loan repayment (the final balance may be smaller).
const MIN_LOAN_REPAYMENT = 100;
const round2 = (n) => Math.round(Number(n) * 100) / 100;

// App deep-link schemes we are willing to send a member back to after paying.
// "exp"/"exps" are Expo Go (development); production builds use the app scheme.
const ALLOWED_APP_SCHEMES = (
  process.env.MOBILE_APP_SCHEMES || "exclusivecooperative,exp,exps"
)
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

// Accept the app's own return link only if it is a deep link with an allowed
// scheme (never http/https), so this cannot be used as an open redirect.
function safeAppReturnUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 300) return null;
  const match = raw.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (!match) return null;
  return ALLOWED_APP_SCHEMES.includes(match[1].toLowerCase()) ? raw : null;
}

function publicApiBase(req) {
  const configured = String(process.env.API_PUBLIC_URL || "").replace(/\/+$/, "");
  return configured || `${req.protocol}://${req.get("host")}`;
}

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Paystack sends the member here (a normal https page) after payment. We hand
// them straight back to the app. Public on purpose: it only redirects and
// carries the reference; the app verifies the payment with the server.
router.get("/paystack/mobile-return", (req, res) => {
  const base = safeAppReturnUrl(req.query.r) || "exclusivecooperative://payment-callback";
  const reference = String(req.query.reference || req.query.trxref || "").slice(0, 100);
  const target =
    base + (base.includes("?") ? "&" : "?") + "reference=" + encodeURIComponent(reference);

  res.set("Cache-Control", "no-store");
  res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
  res.status(200).type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Returning to the app</title>
<meta http-equiv="refresh" content="0;url=${escapeHtml(target)}"></head>
<body style="font-family:sans-serif;text-align:center;padding:48px 20px">
<h2>Payment received</h2>
<p>Taking you back to the app&hellip;</p>
<p><a href="${escapeHtml(target)}" style="display:inline-block;padding:12px 24px;background:#0b6b3a;color:#fff;border-radius:8px;text-decoration:none">Return to the app</a></p>
<script>window.location.replace(${JSON.stringify(target)});</script>
</body></html>`);
});

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
    const { amount, mobile, returnUrl } = req.body;

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

      // Mobile: Paystack returns to an https page on our API, which then opens
      // the app. Paystack does not reliably redirect straight to app:// links.
      const appReturn = safeAppReturnUrl(returnUrl) || "exclusivecooperative://payment-callback";
      const callbackUrl = mobile
        ? `${publicApiBase(req)}/api/payments/paystack/mobile-return?r=${encodeURIComponent(appReturn)}`
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
              type: "savings",
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

// POST /api/payments/paystack/loan-repayment/initialize
// { loanId, amount, mobile?, returnUrl? }
// Starts a Paystack checkout for a loan repayment. The member's balance is
// only changed after Paystack confirms the payment (verify or webhook).
router.post("/paystack/loan-repayment/initialize", protect, async (req, res) => {
  try {
    const { loanId, mobile, returnUrl } = req.body || {};
    const amount = round2(req.body?.amount);

    if (!mongoose.isValidObjectId(loanId)) {
      return res.status(400).json({ message: "Choose the loan you want to repay." });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Enter a valid repayment amount." });
    }

    const loan = await Loan.findOne({ _id: loanId, user: req.user._id });
    if (!loan) return res.status(404).json({ message: "Loan not found." });

    if (!["active", "overdue"].includes(loan.status) || !(loan.outstandingBalance > 0)) {
      return res.status(400).json({
        message: "This loan has no balance to repay right now.",
      });
    }

    const outstanding = round2(loan.outstandingBalance);
    if (amount > outstanding) {
      return res.status(400).json({
        message: `That is more than you currently owe (\u20a6${outstanding.toLocaleString()}).`,
      });
    }
    if (amount < MIN_LOAN_REPAYMENT && amount !== outstanding) {
      return res.status(400).json({
        message: `The smallest repayment is \u20a6${MIN_LOAN_REPAYMENT.toLocaleString()}, unless you are clearing your last balance.`,
      });
    }

    // Mobile: Paystack returns to an https page on our API, which opens the
    // app. Web: back to the website's payment page.
    const appReturn = safeAppReturnUrl(returnUrl) || "exclusivecooperative://payment-callback";
    const callbackUrl = mobile
      ? `${publicApiBase(req)}/api/payments/paystack/mobile-return?r=${encodeURIComponent(appReturn)}`
      : `${process.env.CLIENT_URL}/payment-callback`;

    const response = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: req.user.email,
        amount: Math.round(amount * 100),
        currency: "NGN",
        callback_url: callbackUrl,
        metadata: {
          userId: req.user._id.toString(),
          loanId: loan._id.toString(),
          type: "loan_repayment",
          platform: mobile ? "mobile" : "web",
          custom_fields: [
            { display_name: "Payment for", variable_name: "payment_for", value: "Loan repayment" },
          ],
        },
      }),
    });

    const data = await response.json();
    if (!data.status) {
      return res.status(400).json({ message: data.message || "Could not start payment" });
    }

    res.json({
      authorizationUrl: data.data.authorization_url,
      reference: data.data.reference,
    });
  } catch (err) {
    console.error("Paystack loan repayment initialize error:", err);
    res.status(500).json({ message: "Could not start payment. Please try again." });
  }
});

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
router.get("/paystack/verify/:reference", protect, requireApprovedMember, async (req, res) => {
  const { reference } = req.params;

  try {
    // A loan repayment that was already recorded (the webhook usually beats
    // the client here). Report it rather than re-verifying.
    const existingLoanPayment = await LoanRepayment.findOne({ reference });
    if (existingLoanPayment) {
      if (String(existingLoanPayment.user) !== String(req.user._id)) {
        return res.status(404).json({ message: "Payment not found." });
      }
      const loan = await Loan.findById(existingLoanPayment.loan).select("outstandingBalance status");
      return res.json({
        kind: "loan_repayment",
        status: "already_processed",
        amount: existingLoanPayment.amount,
        overpaidAmount: existingLoanPayment.overpaidAmount || 0,
        outstandingBalance: loan ? loan.outstandingBalance : null,
        loanStatus: loan ? loan.status : null,
      });
    }

    // Someone may have already confirmed this exact payment (the webhook
    // usually beats the client here). Report it rather than re-verifying.
    const existing = await SavingsTransaction.findOne({ reference });

    // A reference belonging to someone else must look like it doesn't exist.
    if (existing && String(existing.user) !== String(req.user._id)) {
      return res.status(404).json({ message: "Payment not found." });
    }

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

    // The payment must have been started by THIS member (we stamp the
    // member's id into the checkout metadata at initialize time) and be in
    // naira. Without this, anyone who learns another member's reference
    // (receipts show it) could claim that payment for their own account.
    if (String(data.data.metadata?.userId || "") !== String(req.user._id)) {
      return res.status(403).json({
        message: "This payment does not belong to your account.",
      });
    }

    if (data.data.currency && data.data.currency !== "NGN") {
      return res.status(400).json({ message: "Unsupported payment currency." });
    }

    // Paystack returns the amount in kobo.
    const amount = data.data.amount / 100;

    // Loan repayments are settled against the loan, never as savings.
    if (data.data.metadata?.type === "loan_repayment") {
      const loanResult = await creditPaystackLoanRepayment({
        userId: req.user._id,
        loanId: data.data.metadata?.loanId,
        amount,
        reference,
      });

      return res.json({
        kind: "loan_repayment",
        status: loanResult.alreadyProcessed ? "already_processed" : "success",
        amount: loanResult.amount,
        overpaidAmount: loanResult.overpaidAmount,
        outstandingBalance: loanResult.outstandingBalance,
        loanStatus: loanResult.loanStatus,
      });
    }

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

  // Verify against the exact bytes Paystack sent, not a re-serialized
  // copy of the parsed body (see server.js for where rawBody is captured).
  const payload = req.rawBody;

  if (!payload) {
    console.error("Paystack webhook: raw body unavailable, rejecting.");
    return res.sendStatus(401);
  }

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

  // Acknowledge only AFTER the credit is safely stored. If processing fails
  // we answer 500 so Paystack retries the event (it retries failed
  // deliveries for hours). Replying before processing meant a failure here
  // was silently lost with no retry. Duplicate deliveries are harmless:
  // crediting is idempotent on the reference.
  try {
    const { event, data } = req.body || {};

    if (event !== "charge.success" || !data?.reference) {
      return res.sendStatus(200);
    }

    // Only handle savings top-ups here; other charge.success events
    // (if this account ever adds other charge types) are ignored.
    const userId = data.metadata?.userId;
    if (!userId) return res.sendStatus(200);

    if (data.currency && data.currency !== "NGN") {
      console.error("Paystack webhook: non-NGN charge ignored", data.reference);
      return res.sendStatus(200);
    }

    const amount = Number(data.amount || 0) / 100;
    if (!amount) return res.sendStatus(200);

    // Loan repayments go to the loan, not to savings.
    if (data.metadata?.type === "loan_repayment") {
      await creditPaystackLoanRepayment({
        userId,
        loanId: data.metadata?.loanId,
        amount,
        reference: data.reference,
      });
      return res.sendStatus(200);
    }

    await creditPaystackSavingsPayment({
      userId,
      amount,
      reference: data.reference,
    });

    return res.sendStatus(200);
  } catch (err) {
    console.error("Paystack savings webhook processing error:", err);
    return res.sendStatus(500);
  }
});

export default router;