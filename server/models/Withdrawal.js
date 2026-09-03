import mongoose from "mongoose";

const withdrawalSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Amount the member receives in their bank account.
    amount: {
      type: Number,
      required: true,
      min: 1,
    },

    // Ordinary savings withdrawals do not apply the membership-withdrawal
    // fee from section 15.8(iii). Kept for future membership-withdrawal records.
    administrativeFee: { type: Number, default: 0, min: 0 },

    // Total amount deducted from the member's savings.
    totalDeduction: { type: Number, required: true, min: 1 },

    bankCode: {
      type: String,
      required: true,
      trim: true,
    },

    bankName: {
      type: String,
      required: true,
      trim: true,
    },

    accountName: {
      type: String,
      required: true,
      trim: true,
    },

    // Only the last four digits are stored.
    // The full account number is never stored in the Withdrawal document.
    accountNumberLast4: {
      type: String,
      required: true,
      trim: true,
    },

    recipientCode: {
      type: String,
      required: true,
      trim: true,
    },

    transferCode: {
      type: String,
      default: null,
    },

    reference: {
      type: String,
      unique: true,
      required: true,
      trim: true,
    },

    status: {
      type: String,
      enum: [
        "processing",
        "success",
        "failed",
        "reversed",
        "rejected",
      ],
      default: "processing",
    },

    failureReason: {
      type: String,
      default: "",
    },

    paidAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Withdrawal", withdrawalSchema);
