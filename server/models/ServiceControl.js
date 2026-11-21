import mongoose from "mongoose";

// One document per switchable service. A service with no document is ON, so
// nothing is ever locked until an administrator turns it off.
const serviceControlSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    enabled: { type: Boolean, default: true },
    // Optional text shown to members while the service is off.
    message: { type: String, default: "", trim: true, maxlength: 200 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedByName: { type: String, default: "", trim: true },
  },
  { timestamps: true },
);

export default mongoose.model("ServiceControl", serviceControlSchema);
