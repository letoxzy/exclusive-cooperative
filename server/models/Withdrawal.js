import mongoose from "mongoose";

const withdrawalSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    amount: { type: Number, required: true, min: 1 },
    lockedAmountAtRequest: { type: Number, required: true, min: 0 },

    bankName: { type: String, required: true, trim: true },
    bankCode: { type: String, required: true, trim: true },
    accountName: { type: String, required: true, trim: true },
    accountNumber: { type: String, required: true, trim: true },

    status: {
      type: String,
      enum: ["pending", "processing", "success", "failed", "rejected"],
      default: "pending",
    },

    reference: { type: String, unique: true, sparse: true },
    recipientCode: String,
    transferCode: String,
    gatewayResponse: String,
    failureReason: String,
    reviewedAt: Date,
    processedAt: Date,
  },
  { timestamps: true }
);

withdrawalSchema.index({ user: 1, createdAt: -1 });
withdrawalSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model("Withdrawal", withdrawalSchema);
