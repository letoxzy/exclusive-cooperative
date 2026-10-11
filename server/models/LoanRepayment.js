import mongoose from "mongoose";

const loanRepaymentSchema = new mongoose.Schema(
  {
    loan: { type: mongoose.Schema.Types.ObjectId, ref: "Loan", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    method: { type: String, enum: ["manual"], default: "manual" },
    receiptUrl: { type: String, default: "" },
    receiptPublicId: { type: String, default: "" },

    // Set when an administrator approves the repayment. Dividends use these to
    // count only verified interest collected in a period. The split is fixed at
    // approval time and never recalculated. null = approved before this existed.
    approvedAt: { type: Date, default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    principalPortion: { type: Number, default: null },
    interestPortion: { type: Number, default: null },
    chargePortion: { type: Number, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("LoanRepayment", loanRepaymentSchema);