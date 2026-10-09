import User from "../models/User.js";
import SavingsTransaction from "../models/SavingsTransaction.js";
import { createNotificationAndPush } from "./createNotification.js";
import { runAtomic } from "./atomic.js";
import { postSavingsDeposit } from "../services/ledger.js";
import {
  LOCKED_SAVINGS_PERCENTAGE,
  WITHDRAWABLE_PERCENTAGE,
} from "./contributionRules.js";

/**
 * Credits a verified Paystack savings top-up.
 *
 * Called from two places that can race each other (and retry) in production:
 *   1. The client hitting /paystack/verify/:reference right after checkout.
 *   2. Paystack's server-to-server webhook.
 *
 * The transaction record, the member's balance and the ledger entry are
 * written inside ONE database transaction, so they all commit or none do.
 * (Previously the record was created first and the balance incremented
 * separately; a crash in between left a payment that looked "already
 * processed" on retry but was never credited.)
 *
 * Idempotency still rests on the unique index on SavingsTransaction.reference.
 *
 * @param {Object} params
 * @param {string} params.userId - The member the payment belongs to.
 * @param {number} params.amount - Amount in Naira (already converted from kobo).
 * @param {string} params.reference - The Paystack transaction reference.
 */
export async function creditPaystackSavingsPayment({ userId, amount, reference }) {
  const lockedAmount = Math.round(amount * LOCKED_SAVINGS_PERCENTAGE * 100) / 100;
  const withdrawalAmount = Math.round(amount * WITHDRAWABLE_PERCENTAGE * 100) / 100;

  const alreadyProcessed = async () => {
    const existing = await SavingsTransaction.findOne({ reference });
    const user = await User.findById(userId).select("savingsBalance");
    return {
      alreadyProcessed: true,
      amount: existing?.amount ?? amount,
      savingsBalance: user ? user.savingsBalance : null,
      transaction: existing,
    };
  };

  let result;
  try {
    result = await runAtomic(async (session) => {
      const opts = session ? { session } : {};

      if (await SavingsTransaction.findOne({ reference }, null, opts)) {
        return { duplicate: true };
      }

      const [transaction] = await SavingsTransaction.create(
        [
          {
            user: userId,
            amount,
            status: "approved",
            method: "paystack",
            reference,
            lockedAmount,
            withdrawalAmount,
          },
        ],
        opts
      );

      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { $inc: { savingsBalance: amount } },
        { new: true, select: "savingsBalance email fullName pushTokens", ...opts }
      );

      await postSavingsDeposit(
        { userId, amount, reference, method: "paystack" },
        { session }
      );

      return { transaction, updatedUser };
    });
  } catch (err) {
    // Unique-index collision from a concurrent request that won the race.
    if (err?.code === 11000) return alreadyProcessed();
    throw err;
  }

  if (result.duplicate) return alreadyProcessed();

  const { transaction, updatedUser } = result;

  // Notification is outside the transaction on purpose: a push failure must
  // never roll back a successful credit.
  try {
    await createNotificationAndPush({
      user: updatedUser || userId,
      type: "savings",
      title: "Savings Payment Successful",
      message: `Your savings payment of \u20a6${amount.toLocaleString()} was successful.`,
      data: {
        reference,
        amount,
        transactionId: transaction._id.toString(),
      },
    });
  } catch (err) {
    console.error("Savings notification error:", err.message);
  }

  return {
    alreadyProcessed: false,
    amount,
    savingsBalance: updatedUser ? updatedUser.savingsBalance : null,
    transaction,
  };
}
