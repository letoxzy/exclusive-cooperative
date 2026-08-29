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
    const user = await User.findOneAndUpdate(
      {
        _id: withdrawal.user,

        // The withdrawal was reserved before the Paystack transfer.
        withdrawalReserved: { $gte: amount },

        // Never allow the database balance to go negative.
        savingsBalance: { $gte: amount },
      },
      [
        {
          $set: {
            savingsBalance: {
              $subtract: ["$savingsBalance", amount],
            },

            withdrawalReserved: {
              $subtract: ["$withdrawalReserved", amount],
            },

            // Only loan funds that are actually part of the withdrawal
            // should reduce loanFundsBalance.
            loanFundsBalance: {
              $max: [
                0,
                {
                  $subtract: [
                    "$loanFundsBalance",
                    {
                      $min: ["$loanFundsBalance", amount],
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
      { new: true }
    );

    if (!user) {
      throw new Error(
        "Could not safely settle the withdrawal against the member balance."
      );
    }

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
