import mongoose from "mongoose";

const withdrawalSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true, min: 1 },

    bankCode: { type: String, required: true, trim: true },
    bankName: { type: String, required: true, trim: true },
    accountName: { type: String, required: true, trim: true },
    accountNumberLast4: { type: String, required: true, trim: true },

    recipientCode: { type: String, required: true, trim: true },
    transferCode: { type: String, default: null },
    reference: { type: String, unique: true, required: true, trim: true },

    status: {
      type: String,
      enum: ["processing", "success", "failed", "reversed", "rejected"],
      default: "processing",
    },

    failureReason: { type: String, default: "" },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("Withdrawal", withdrawalSchema);
