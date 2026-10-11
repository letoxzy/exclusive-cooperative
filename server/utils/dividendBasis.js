import LoanRepayment from "../models/LoanRepayment.js";
import Loan from "../models/Loan.js";
import { toKobo, fromKobo } from "./money.js";
import { repaymentPortions } from "./dividendMath.js";

export { repaymentPortions };

/*
  Dividend basis: LOAN INTEREST ACTUALLY PAID (collected) in the period.

  - Only repayments an administrator has APPROVED count (verified cash in).
  - A repayment belongs to the period in which it was approved (`approvedAt`).
  - Each approved repayment is split pro-rata into principal / interest /
    overdue charges at the moment it is approved, and that split is stored on
    the repayment so it never changes afterwards. Only the INTEREST portion
    counts toward dividends; principal and overdue charges never do.
  - Repayments approved before this feature existed have no stored split.
    They are derived from the loan's figures using the same formula and are
    reported as `derived`, so an administrator can see how much of a
    distribution rests on derived rather than stored figures.
*/

/**
 * Approved repayments whose approval date falls inside [start, end], with the
 * interest portion of each (in kobo).
 * @returns {Promise<Array<{repaymentId, userId, loanId, date, amount, interestKobo, derived}>>}
 */
export async function collectInterestRows({ start, end }) {
  const inWindow = { $gte: start, $lte: end };
  const repayments = await LoanRepayment.find({
    status: "approved",
    $or: [
      { approvedAt: inWindow },
      // Approved before approvedAt existed: the status change was the last
      // write to the record, so updatedAt is the approval time.
      { approvedAt: null, updatedAt: inWindow },
    ],
  }).lean();

  const loanIds = [...new Set(repayments.map((r) => String(r.loan)))];
  const loans = await Loan.find({ _id: { $in: loanIds } })
    .select("user amount totalRepayment overdueChargeTotal")
    .lean();
  const loanById = new Map(loans.map((l) => [String(l._id), l]));

  const rows = [];
  for (const r of repayments) {
    const loan = loanById.get(String(r.loan));
    if (!loan) continue; // orphaned record: cannot be verified
    // A repayment must belong to the loan's own member.
    if (String(loan.user) !== String(r.user)) continue;

    const stored = r.interestPortion !== null && r.interestPortion !== undefined;
    rows.push({
      repaymentId: r._id,
      userId: String(r.user),
      loanId: String(r.loan),
      date: r.approvedAt || r.updatedAt,
      amount: r.amount,
      interestKobo: stored ? toKobo(r.interestPortion) : repaymentPortions(loan, r.amount).interestKobo,
      derived: !stored,
    });
  }
  return rows;
}
