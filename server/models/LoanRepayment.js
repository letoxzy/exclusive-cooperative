import mongoose from "mongoose";

const loanRepaymentSchema = new mongoose.Schema(
  {
    loan: { type: mongoose.Schema.Types.ObjectId, ref: "Loan", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    method: { type: String, enum: ["manual"], default: "manual" },
  },
  { timestamps: true }
);

export default mongoose.model("LoanRepayment", loanRepaymentSchema);