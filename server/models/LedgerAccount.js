import mongoose from "mongoose";

const ledgerAccountSchema = new mongoose.Schema(
  {
    tenantId: { type: String, default: "default", index: true },
    code: { type: String, required: true },
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ["asset", "liability", "equity", "income", "expense"],
      required: true,
    },
    normalBalance: { type: String, enum: ["debit", "credit"], required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

ledgerAccountSchema.index({ tenantId: 1, code: 1 }, { unique: true });

export default mongoose.model("LedgerAccount", ledgerAccountSchema);
