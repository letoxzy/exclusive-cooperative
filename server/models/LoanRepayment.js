import mongoose from "mongoose";

const loanRepaymentSchema = new mongoose.Schema(
  {
    loan: { type: mongoose.Schema.Types.ObjectId, ref: "Loan", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    method: { type: String, enum: ["manual", "paystack"], default: "manual" },

    // Paystack transaction reference (online payments only). Unique, so the
    // same payment can never be applied twice, whether it arrives through the
    // app, the website or the webhook.
    reference: { type: String, default: undefined },

    // Money received that could NOT be applied to the loan (paid after the
    // loan was already cleared, or more than was owed). needsRefund flags it
    // for the office to refund; it is never silently kept.
    overpaidAmount: { type: Number, default: 0, min: 0 },
    needsRefund: { type: Boolean, default: false },
    note: { type: String, trim: true, maxlength: 300, default: "" },
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

loanRepaymentSchema.index({ reference: 1 }, { unique: true, sparse: true });
loanRepaymentSchema.index({ needsRefund: 1 });

export default mongoose.model("LoanRepayment", loanRepaymentSchema);