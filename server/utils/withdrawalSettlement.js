import User from "../models/User.js";

export async function settleWithdrawal(withdrawal, finalStatus, reason = "") {
  if (!withdrawal) return;

  const amount = Number(withdrawal.amount || 0);

  if (finalStatus === "success") {
    const user = await User.findOneAndUpdate(
      {
        _id: withdrawal.user,
        savingsBalance: { $gte: amount },
        withdrawalReserved: { $gte: amount },
      },
      [
        {
          $set: {
            savingsBalance: { $subtract: ["$savingsBalance", amount] },
            withdrawalReserved: { $subtract: ["$withdrawalReserved", amount] },
            loanFundsBalance: {
              $max: [
                0,
                { $subtract: ["$loanFundsBalance", amount] },
              ],
            },
          },
        },
      ],
      { new: true }
    );

    if (!user) {
      throw new Error("Could not safely settle the withdrawal against the member balance.");
    }

    withdrawal.status = "success";
    withdrawal.paidAt = new Date();
    withdrawal.failureReason = "";
  } else if (["failed", "reversed", "rejected"].includes(finalStatus)) {
    await User.findOneAndUpdate(
      { _id: withdrawal.user },
      { $inc: { withdrawalReserved: -amount } }
    );

    withdrawal.status = finalStatus;
    withdrawal.failureReason = reason || "Withdrawal could not be completed.";
  }

  await withdrawal.save();
}
