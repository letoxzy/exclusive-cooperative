import User from "../models/User.js";

/**
 * Finalize a withdrawal after Paystack reports its result.
 *
 * success:
 *   - deducts the money from savingsBalance
 *   - releases the temporary withdrawal reservation
 *   - reduces loanFundsBalance only when the withdrawn amount is
 *     covered by the member's loan-funds portion
 *
 * failed/reversed/rejected:
 *   - releases the temporary withdrawal reservation
 *   - does not reduce savingsBalance
 */
export async function settleWithdrawal(
  withdrawal,
  finalStatus,
  reason = ""
) {
  if (!withdrawal) return;

  const amount = Number(withdrawal.amount || 0);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid withdrawal amount.");
  }

  if (finalStatus === "success") {
    // Work out which portion of this successful withdrawal actually came
    // from the member's loan funds. Anything beyond the available loan
    // funds necessarily comes from personal savings.
    const currentUser = await User.findById(withdrawal.user).select(
      "savingsBalance loanFundsBalance withdrawalReserved savingsWithdrawalLocked"
    );

    if (!currentUser) {
      throw new Error("Member account not found while settling withdrawal.");
    }

    const currentLoanFunds = Math.max(
      0,
      Number(currentUser.loanFundsBalance || 0)
    );
    const loanFundsUsed = Math.min(currentLoanFunds, amount);
    const personalSavingsUsed = Math.max(0, amount - loanFundsUsed);

    const user = await User.findOneAndUpdate(
      {
        _id: withdrawal.user,
        withdrawalReserved: { $gte: amount },
        savingsBalance: { $gte: amount },
        loanFundsBalance: { $gte: loanFundsUsed },
      },
      {
        $inc: {
          savingsBalance: -amount,
          withdrawalReserved: -amount,
          loanFundsBalance: -loanFundsUsed,
        },
        ...(personalSavingsUsed > 0
          ? { $set: { savingsWithdrawalLocked: true } }
          : {}),
      },
      { new: true }
    );

    if (!user) {
      throw new Error(
        "Could not safely settle the withdrawal against the member balance."
      );
    }

    withdrawal.loanFundsUsed = loanFundsUsed;
    withdrawal.personalSavingsUsed = personalSavingsUsed;
    withdrawal.status = "success";
    withdrawal.paidAt = new Date();
    withdrawal.failureReason = "";
  } else if (
    ["failed", "reversed", "rejected"].includes(finalStatus)
  ) {
    const user = await User.findOneAndUpdate(
      {
        _id: withdrawal.user,
        withdrawalReserved: { $gte: amount },
      },
      {
        $inc: {
          withdrawalReserved: -amount,
        },
      },
      { new: true }
    );

    if (!user) {
      throw new Error(
        "Could not safely release the withdrawal reservation."
      );
    }

    withdrawal.status = finalStatus;
    withdrawal.failureReason =
      reason || "Withdrawal could not be completed.";
  } else {
    throw new Error(`Unsupported withdrawal status: ${finalStatus}`);
  }

  await withdrawal.save();
}
