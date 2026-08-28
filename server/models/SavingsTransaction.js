import mongoose from "mongoose";

const savingsTransactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    method: { type: String, enum: ["manual", "paystack"], default: "manual" },
    reference: { type: String, unique: true, sparse: true }, // Paystack transaction reference
    note: String,
  },
  { timestamps: true }
);

export default mongoose.model("SavingsTransaction", savingsTransactionSchema);