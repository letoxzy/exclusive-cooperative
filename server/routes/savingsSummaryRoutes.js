import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import Withdrawal from "../models/Withdrawal.js";
import { savingsOwed } from "../utils/fullWithdrawalGrant.js";

/**
 * What the member sees as their savings, in the way most savings apps show it:
 *
 *   currentBalance    = total contributed minus withdrawals already paid out
 *   totalContributed  = everything paid in (the stored savingsBalance; loan
 *                       eligibility, dividends and the ledger all still use this)
 *   withdrawn         = savings withdrawals already paid
 *   pending           = withdrawals requested and still processing (held)
 *
 * This is display only. It does not change any stored balance.
 */
const router = express.Router();

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// GET /api/users/me/savings-summary
router.get("/", protect, async (req, res) => {
  try {
    const totalContributed = Math.max(0, round2(req.user.savingsBalance));
    const pending = Math.max(0, round2(req.user.withdrawalReserved));

    const paid = await Withdrawal.aggregate([
      { $match: { user: req.user._id, status: "success", source: "savings" } },
      { $group: { _id: null, total: { $sum: "$totalDeduction" } } },
    ]);

    res.set("Cache-Control", "no-store");
    res.json({
      totalContributed,
      withdrawn: round2(paid[0]?.total || 0),
      pending,
      // Same calculation the full-exit withdrawal uses, so the two always agree.
      currentBalance: await savingsOwed(req.user),
    });
  } catch (err) {
    console.error("Savings summary error:", err);
    res.status(500).json({ message: "Could not load your savings summary." });
  }
});

export default router;
