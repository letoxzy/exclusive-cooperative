import mongoose from "mongoose";

const cooperativeSettingSchema = new mongoose.Schema(
  {
    cooperativeName: { type: String, default: "Exclusive Cooperative", trim: true },
    officialEmail: { type: String, default: "", trim: true, lowercase: true },
    phone: { type: String, default: "", trim: true },
    address: { type: String, default: "", trim: true },
    loanMultiplier: { type: Number, default: 2, min: 0 },
  },
  { timestamps: true },
);

export default mongoose.model("CooperativeSetting", cooperativeSettingSchema);
