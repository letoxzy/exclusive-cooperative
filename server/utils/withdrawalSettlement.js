import User from "../models/User.js";
import Loan from "../models/Loan.js";

const DEFAULT_ADMINISTRATIVE_FEE = 0;

/**
 * Finalize a withdrawal after Paystack reports its result.
 *
 * A withdrawal amount is the amount paid to the member.
 * Ordinary savings withdrawals currently have no administrative fee;
 * totalDeduction therefore equals amount for new ordinary withdrawals.
 *
 * success:
 *   - leaves the locked savingsBalance untouched
 *   - releases the temporary monthly withdrawal reservation
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
  const totalDeduction = Number(
    withdrawal.totalDeduction ?? amount
  );
  const source = withdrawal.source || "savings";

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid withdrawal amount.");
  }

  if (!Number.isFinite(administrativeFee) || administrativeFee < 0) {
    throw new Error("Invalid withdrawal administrative fee.");
  }

  if (!Number.isFinite(totalDeduction) || totalDeduction <= 0) {
    throw new Error("Invalid total withdrawal deduction.");
  }

  if (source === "loan" && !withdrawal.loan) {
    throw new Error("Loan withdrawal is missing its loan reference.");
  }

  if (finalStatus === "success") {
    if (source === "loan") {
      const loan = await Loan.findOneAndUpdate(
        {
          _id: withdrawal.loan,
          status: { $in: ["active", "defaulted"] },
          loanFundsReserved: { $gte: amount },
          $expr: {
            $gte: [
              {
                $subtract: [
                  "$amount",
                  { $add: ["$loanFundsWithdrawn", "$loanFundsReserved"] },
                ],
              },
              0,
            ],
          },
        },
        {
          $inc: {
            loanFundsWithdrawn: amount,
            loanFundsReserved: -amount,
          },
        },
        { new: true }
      );

      if (!loan) {
        throw new Error(
          "Could not safely settle the withdrawal against the available loan funds."
        );
      }
    } else {
      // Savings withdrawals come from the current month's 40% withdrawal
      // pool. The 60% savings balance is locked and is never reduced by a
      // savings withdrawal. Only the temporary reservation is released.
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
          "Could not safely settle the monthly savings withdrawal reservation."
        );
      }
    }

    withdrawal.administrativeFee = administrativeFee;
    withdrawal.totalDeduction = totalDeduction;
    withdrawal.status = "success";
    withdrawal.paidAt = new Date();
    withdrawal.failureReason = "";
  } else if (["failed", "reversed", "rejected"].includes(finalStatus)) {
    if (source === "loan") {
      const loan = await Loan.findOneAndUpdate(
        {
          _id: withdrawal.loan,
          loanFundsReserved: { $gte: amount },
        },
        {
          $inc: {
            loanFundsReserved: -amount,
          },
        },
        { new: true }
      );

      if (!loan) {
        throw new Error(
          "Could not safely release the reserved loan funds."
        );
      }
    } else {
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
