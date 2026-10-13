import Withdrawal from "../models/Withdrawal.js";
import Loan from "../models/Loan.js";
import SavingsTransaction from "../models/SavingsTransaction.js";
import LoanRepayment from "../models/LoanRepayment.js";
import Membership from "../models/Membership.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import { DividendEntry } from "../models/Dividend.js";

/**
 * Reasons a member's account cannot be deleted yet (empty array = it can).
 *
 * A member who still has money or unfinished business with the cooperative
 * must be settled first. Deleting the account would orphan their loans,
 * withdrawals and records, and make their balance vanish.
 *
 * `self: true` words the reasons to the member ("you still hold ...");
 * otherwise they are written for staff ("they still hold ...").
 */
export async function memberDeletionBlockers(member, { self = false } = {}) {
  const id = member._id;
  const reasons = [];
  const you = self ? "you" : "they";
  const your = self ? "your" : "their";
  const have = self ? "you have" : "they have";

  const paid = await Withdrawal.aggregate([
    { $match: { user: id, status: "success", source: "savings" } },
    { $group: { _id: null, total: { $sum: "$totalDeduction" } } },
  ]);
  // savingsBalance is the gross of all contributions; successful savings
  // withdrawals are tracked separately, so what the member is still owed is:
  const savingsOwed =
    Math.round((Number(member.savingsBalance || 0) - Number(paid[0]?.total || 0)) * 100) / 100;
  if (savingsOwed > 0) {
    reasons.push(`${you} still hold ₦${savingsOwed.toLocaleString()} in savings`);
  }
  if (Number(member.withdrawalReserved || 0) > 0) {
    reasons.push(`a withdrawal is reserved against ${your} savings`);
  }

  const [openLoan, owing, processing, pendingSavings, pendingRepayment, pendingDividend] =
    await Promise.all([
      Loan.exists({ user: id, status: { $in: ["pending", "approved", "active", "overdue", "defaulted"] } }),
      Loan.exists({ user: id, outstandingBalance: { $gt: 0 } }),
      Withdrawal.exists({ user: id, status: "processing" }),
      SavingsTransaction.exists({ user: id, status: "pending" }),
      LoanRepayment.exists({ user: id, status: "pending" }),
      DividendEntry.exists({ user: id, status: "pending" }),
    ]);

  if (openLoan || owing) reasons.push(`${have} an open loan or loan application`);
  if (processing) reasons.push("a withdrawal is still processing");
  if (pendingSavings) reasons.push("a savings payment is awaiting approval");
  if (pendingRepayment) reasons.push("a loan repayment is awaiting approval");
  if (pendingDividend) reasons.push(`an unpaid dividend is owed to ${self ? "you" : "them"}`);

  return reasons;
}

/**
 * Removes the member's login account, membership record and notifications.
 *
 * Financial records (transactions, loans, repayments, withdrawals, ledger and
 * audit entries) are kept: the cooperative must retain accounting records, and
 * once the account is gone they hold no name or contact details, only an
 * internal id. Callers must run memberDeletionBlockers() first.
 */
export async function deleteMemberAccount(memberId) {
  await Membership.deleteMany({ user: memberId });
  await Notification.deleteMany({ user: memberId });
  await User.findByIdAndDelete(memberId);
}
