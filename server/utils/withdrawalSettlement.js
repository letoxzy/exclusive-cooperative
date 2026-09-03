import User from "../models/User.js";

const DEFAULT_ADMINISTRATIVE_FEE = 0;

/**
 * Finalize a withdrawal after Paystack reports its result.
 *
 * A withdrawal amount is the amount paid to the member.
 * Ordinary savings withdrawals currently have no administrative fee;
 * totalDeduction therefore equals amount for new ordinary withdrawals.
 *
 * success:
 *   - deducts totalDeduction from savingsBalance
 *   - releases the temporary withdrawal reservation
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
  const administrativeFee = Number(
    withdrawal.administrativeFee ?? DEFAULT_ADMINISTRATIVE_FEE
  );
  // New withdrawals store the full deduction. Existing legacy records may
  // not have the field, so preserve their original reserved amount.
  const totalDeduction = Number(
    withdrawal.totalDeduction ?? amount
  );

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid withdrawal amount.");
  }

  if (!Number.isFinite(administrativeFee) || administrativeFee < 0) {
    throw new Error("Invalid withdrawal administrative fee.");
  }

  if (!Number.isFinite(totalDeduction) || totalDeduction <= 0) {
    throw new Error("Invalid total withdrawal deduction.");
  }

  if (finalStatus === "success") {
    const user = await User.findOneAndUpdate(
      {
        _id: withdrawal.user,
        withdrawalReserved: { $gte: totalDeduction },
        savingsBalance: { $gte: totalDeduction },
      },
      {
        $inc: {
          savingsBalance: -totalDeduction,
          withdrawalReserved: -totalDeduction,
        },
      },
      { new: true }
    );

    if (!user) {
      throw new Error(
        "Could not safely settle the withdrawal against the member balance."
      );
    }

    withdrawal.administrativeFee = administrativeFee;
    withdrawal.totalDeduction = totalDeduction;
    withdrawal.status = "success";
    withdrawal.paidAt = new Date();
    withdrawal.failureReason = "";
  } else if (["failed", "reversed", "rejected"].includes(finalStatus)) {
    const user = await User.findOneAndUpdate(
      {
        _id: withdrawal.user,
        withdrawalReserved: { $gte: totalDeduction },
      },
      {
        $inc: {
          withdrawalReserved: -totalDeduction,
        },
      },
      { new: true }
    );

    if (!user) {
      throw new Error(
        "Could not safely release the withdrawal reservation."
      );
    }

    withdrawal.administrativeFee = administrativeFee;
    withdrawal.totalDeduction = totalDeduction;
    withdrawal.status = finalStatus;
    withdrawal.failureReason =
      reason || "Withdrawal could not be completed.";
  } else {
    throw new Error(`Unsupported withdrawal status: ${finalStatus}`);
  }

  await withdrawal.save();
}
