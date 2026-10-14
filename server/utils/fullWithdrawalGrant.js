import Withdrawal from "../models/Withdrawal.js";

// How long an office-granted "withdraw all my savings" permission stays open.
export const grantDays = () => {
  const n = Number(process.env.FULL_WITHDRAWAL_GRANT_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 14;
};

/** True when the member has an unexpired full-withdrawal permission. */
export function activeFullWithdrawalGrant(member) {
  const g = member?.fullWithdrawalGrant;
  if (!g?.active) return null;
  if (g.expiresAt && new Date(g.expiresAt) <= new Date()) return null;
  return g;
}

/**
 * What the cooperative still owes the member in savings.
 * savingsBalance is the gross of all contributions and is NOT reduced when a
 * withdrawal is paid, so subtract the savings withdrawals already paid out.
 */
export async function savingsOwed(member) {
  const paid = await Withdrawal.aggregate([
    { $match: { user: member._id, status: "success", source: "savings" } },
    { $group: { _id: null, total: { $sum: "$totalDeduction" } } },
  ]);
  const owed = Number(member.savingsBalance || 0) - Number(paid[0]?.total || 0);
  return Math.max(0, Math.round(owed * 100) / 100);
}
