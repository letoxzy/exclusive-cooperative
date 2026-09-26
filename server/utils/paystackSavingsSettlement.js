import User from "../models/User.js";
import SavingsTransaction from "../models/SavingsTransaction.js";
import { createNotificationAndPush } from "./createNotification.js";

/**
 * Credits a verified Paystack savings top-up.
 *
 * Called from two places that can race each other in production:
 *   1. The client hitting /paystack/verify/:reference right after checkout.
 *   2. Paystack's server-to-server webhook.
 *
 * Both paths must be safe to run concurrently or more than once for the
 * same reference, so this function is written to be idempotent:
 *   - SavingsTransaction.reference has a unique index. We rely on that as
 *     the source of truth for "has this payment already been credited?"
 *     instead of a read-then-write check, which would leave a race window.
 *   - The user's balance is updated with an atomic $inc, never a
 *     read-modify-write, so two payments settling at the same moment can't
 *     silently overwrite each other.
 *
 * @param {Object} params
 * @param {string} params.userId - The member the payment belongs to.
 * @param {number} params.amount - Amount in Naira (already converted from kobo).
 * @param {string} params.reference - The Paystack transaction reference.
 * @returns {Promise<{alreadyProcessed: boolean, amount: number, savingsBalance: number|null, transaction: object}>}
 */
export async function creditPaystackSavingsPayment({ userId, amount, reference }) {
  let transaction;

  try {
    transaction = await SavingsTransaction.create({
      user: userId,
      amount,
      status: "approved",
      method: "paystack",
      reference,
    });
  } catch (err) {
    // Duplicate key on `reference` means another request already recorded
    // this exact payment (the client verify call and the webhook arrived
    // at almost the same time, or the webhook retried). That's expected,
    // not an error — just report what was already saved.
    if (err?.code === 11000) {
      const existing = await SavingsTransaction.findOne({ reference });
      const user = await User.findById(userId).select("savingsBalance");

      return {
        alreadyProcessed: true,
        amount: existing?.amount ?? amount,
        savingsBalance: user ? user.savingsBalance : null,
        transaction: existing,
      };
    }

    throw err;
  }

  // Atomic increment — never read `user.savingsBalance` and write it back,
  // since two payments crediting the same user around the same time would
  // otherwise be able to clobber each other.
  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { $inc: { savingsBalance: amount } },
    { new: true, select: "savingsBalance email fullName pushTokens" }
  );

  await createNotificationAndPush({
    user: updatedUser || userId,
    type: "savings",
    title: "Savings Payment Successful",
    message: `Your savings payment of ₦${amount.toLocaleString()} was successful.`,
    data: {
      reference,
      amount,
      transactionId: transaction._id.toString(),
    },
  });

  return {
    alreadyProcessed: false,
    amount,
    savingsBalance: updatedUser ? updatedUser.savingsBalance : null,
    transaction,
  };
}