import express from "express";
import SavingsTransaction from "../models/SavingsTransaction.js";
import LoanRepayment from "../models/LoanRepayment.js";
import { protect } from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/adminMiddleware.js";
import { creditPaystackSavingsPayment } from "../utils/paystackSavingsSettlement.js";
import { creditPaystackLoanRepayment } from "../utils/loanRepaymentSettlement.js";
import { audit } from "../utils/audit.js";

const router = express.Router();
router.use(protect, adminOnly);

const PAYSTACK_BASE = "https://api.paystack.co";
const PER_PAGE = 100;
const MAX_PAGES = 50; // caps one run at 5,000 Paystack transactions
const MAX_WINDOW_DAYS = 92;

const paystackHeaders = () => ({
  Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
});

function parseWindow(query) {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { error: "Enter valid from/to dates." };
  }
  if (from >= to) return { error: "The start date must be before the end date." };
  if ((to - from) / 86400000 > MAX_WINDOW_DAYS) {
    return { error: `Choose a window of ${MAX_WINDOW_DAYS} days or less.` };
  }
  return { from, to };
}

async function fetchPaystackSuccesses(from, to) {
  const rows = [];
  let truncated = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      `${PAYSTACK_BASE}/transaction?status=success&perPage=${PER_PAGE}&page=${page}` +
      `&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
    const res = await fetch(url, { headers: paystackHeaders() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.status) {
      throw new Error(body.message || `Paystack responded with ${res.status}`);
    }
    rows.push(...(body.data || []));
    const pageCount = Number(body.meta?.pageCount || 1);
    if (page >= pageCount) return { rows, truncated };
  }
  truncated = true;
  return { rows, truncated };
}

// GET /api/admin/reconciliation/paystack?from=&to=
// Compares what Paystack says it collected with what we recorded.
router.get("/paystack", async (req, res) => {
  const win = parseWindow(req.query);
  if (win.error) return res.status(400).json({ message: win.error });

  try {
    const { rows, truncated } = await fetchPaystackSuccesses(win.from, win.to);

    const ngn = rows.filter((r) => !r.currency || r.currency === "NGN");
    const refs = ngn.map((r) => r.reference);
    const ours = await SavingsTransaction.find({ reference: { $in: refs } })
      .select("reference amount status user")
      .lean();
    const byRef = new Map(ours.map((t) => [t.reference, t]));

    // Loan repayments are recorded in their own collection. A repayment is
    // "matched" when what we applied plus anything flagged for refund equals
    // what Paystack collected.
    const loanOurs = await LoanRepayment.find({ reference: { $in: refs } })
      .select("reference amount overpaidAmount status")
      .lean();
    const loanByRef = new Map(loanOurs.map((t) => [t.reference, t]));

    const missingInSystem = [];
    const amountMismatch = [];
    let matched = 0;
    let unclassified = 0;
    let paystackTotalKobo = 0;

    for (const r of ngn) {
      const hasMember = Boolean(r.metadata?.userId);
      if (!hasMember) {
        unclassified++; // not a member savings top-up (or metadata missing)
        continue;
      }
      paystackTotalKobo += Number(r.amount || 0);
      if (r.metadata?.type === "loan_repayment") {
        const loanMine = loanByRef.get(r.reference);
        if (!loanMine) {
          missingInSystem.push({
            reference: r.reference,
            amount: Number(r.amount || 0) / 100,
            paidAt: r.paid_at || r.paidAt || null,
            email: r.customer?.email || "",
            userId: r.metadata.userId,
            kind: "loan_repayment",
          });
        } else if (
          Math.round((Number(loanMine.amount || 0) + Number(loanMine.overpaidAmount || 0)) * 100) !==
            Number(r.amount || 0) &&
          Math.round(Number(loanMine.overpaidAmount || 0) * 100) !== Number(r.amount || 0)
        ) {
          amountMismatch.push({
            reference: r.reference,
            paystackAmount: Number(r.amount || 0) / 100,
            recordedAmount: loanMine.amount,
          });
        } else {
          matched++;
        }
        continue;
      }

      const mine = byRef.get(r.reference);
      if (!mine || mine.status !== "approved") {
        missingInSystem.push({
          reference: r.reference,
          amount: Number(r.amount || 0) / 100,
          paidAt: r.paid_at || r.paidAt || null,
          email: r.customer?.email || "",
          userId: r.metadata.userId,
        });
      } else if (Math.round(mine.amount * 100) !== Number(r.amount || 0)) {
        amountMismatch.push({
          reference: r.reference,
          paystackAmount: Number(r.amount || 0) / 100,
          recordedAmount: mine.amount,
        });
      } else {
        matched++;
      }
    }

    // Recorded as Paystack payments in the window but absent from Paystack's
    // list. Window edges can cause false alarms, so treat as "check manually".
    const paystackRefs = new Set(refs);
    const recorded = await SavingsTransaction.find({
      method: "paystack",
      status: "approved",
      createdAt: { $gte: win.from, $lte: win.to },
    })
      .select("reference amount createdAt")
      .lean();
    const recordedLoan = await LoanRepayment.find({
      method: "paystack",
      createdAt: { $gte: win.from, $lte: win.to },
    })
      .select("reference amount overpaidAmount createdAt")
      .lean();
    const notInPaystack = [
      ...recorded.map((t) => ({ reference: t.reference, amount: t.amount, recordedAt: t.createdAt })),
      ...recordedLoan.map((t) => ({
        reference: t.reference,
        amount: Number(t.amount || 0) + Number(t.overpaidAmount || 0),
        recordedAt: t.createdAt,
      })),
    ].filter((t) => !paystackRefs.has(t.reference));

    res.json({
      window: { from: win.from, to: win.to },
      truncated,
      paystackTransactions: rows.length,
      paystackMemberTotal: paystackTotalKobo / 100,
      matched,
      unclassified,
      missingInSystem,
      amountMismatch,
      notInPaystack,
    });
  } catch (err) {
    console.error("Paystack reconciliation error:", err);
    res.status(502).json({ message: "Could not reach Paystack to reconcile. Try again shortly." });
  }
});

// POST /api/admin/reconciliation/paystack/credit  { reference }
// Re-verifies a payment directly with Paystack and credits it. Uses the same
// idempotent crediting as the webhook, so running it twice never double-pays.
router.post("/paystack/credit", async (req, res) => {
  const reference = String(req.body?.reference || "").trim();
  if (!reference) return res.status(400).json({ message: "Enter a payment reference." });

  try {
    const r = await fetch(
      `${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: paystackHeaders() }
    );
    const body = await r.json().catch(() => ({}));

    if (!r.ok || !body.status || body.data?.status !== "success") {
      return res.status(400).json({ message: "Paystack does not show this payment as successful." });
    }
    if (body.data.currency && body.data.currency !== "NGN") {
      return res.status(400).json({ message: "Unsupported payment currency." });
    }
    const userId = body.data.metadata?.userId;
    if (!userId) {
      return res.status(400).json({
        message: "This payment has no member attached, so it cannot be credited automatically.",
      });
    }

    // A loan repayment is applied to its loan, never credited as savings.
    if (body.data.metadata?.type === "loan_repayment") {
      const loanResult = await creditPaystackLoanRepayment({
        userId,
        loanId: body.data.metadata?.loanId,
        amount: Number(body.data.amount || 0) / 100,
        reference,
      });

      await audit(req, "reconciliation.credit", "LoanRepayment", reference, {
        userId,
        amount: loanResult.amount,
        overpaidAmount: loanResult.overpaidAmount,
        alreadyProcessed: loanResult.alreadyProcessed,
      });

      return res.json({
        status: loanResult.alreadyProcessed ? "already_processed" : "credited",
        amount: loanResult.amount,
      });
    }

    const result = await creditPaystackSavingsPayment({
      userId,
      amount: Number(body.data.amount || 0) / 100,
      reference,
    });

    await audit(req, "reconciliation.credit", "SavingsTransaction", reference, {
      userId,
      amount: result.amount,
      alreadyProcessed: result.alreadyProcessed,
    });

    res.json({
      status: result.alreadyProcessed ? "already_processed" : "credited",
      amount: result.amount,
    });
  } catch (err) {
    console.error("Reconciliation credit error:", err);
    res.status(500).json({ message: "Could not credit this payment right now." });
  }
});

export default router;
