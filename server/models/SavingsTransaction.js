import mongoose from "mongoose";

const savingsTransactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    method: { type: String, enum: ["manual", "paystack"], default: "manual" },
    reference: { type: String, unique: true, sparse: true }, // Paystack transaction reference
    note: String,

    // Each approved regular contribution is split by the cooperative rule:
    // 60% remains locked savings and 40% forms the current month's
    // withdrawal entitlement. These fields preserve the exact split.
    lockedAmount: { type: Number, default: 0, min: 0 },
    withdrawalAmount: { type: Number, default: 0, min: 0 },
    contributionFrequency: {
      type: String,
      enum: ["Daily", "Weekly", "Monthly"],
      default: "Monthly",
    },
    contributionPeriod: { type: String, default: null, index: true },
  },
  { timestamps: true }
);

export default mongoose.model("SavingsTransaction", savingsTransactionSchema);