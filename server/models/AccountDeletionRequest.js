import mongoose from "mongoose";

// A member (or someone who can no longer sign in) asking the cooperative to
// delete their account. Needed when the account cannot be deleted instantly
// because money or loans are still outstanding, and for the public web form
// that Google Play requires.
const accountDeletionRequestSchema = new mongoose.Schema(
  {
    // Set when the request comes from a signed-in member or the email matched one.
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    email: { type: String, trim: true, lowercase: true, required: true, maxlength: 254 },
    fullName: { type: String, trim: true, maxlength: 120, default: "" },
    reason: { type: String, trim: true, maxlength: 500, default: "" },
    source: { type: String, enum: ["app", "web"], required: true },
    status: {
      type: String,
      enum: ["pending", "completed", "rejected"],
      default: "pending",
    },
    // What was stopping instant deletion when a signed-in member asked.
    blockers: { type: [String], default: [] },
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    handledAt: { type: Date, default: null },
    adminNote: { type: String, trim: true, maxlength: 500, default: "" },
  },
  { timestamps: true }
);

accountDeletionRequestSchema.index({ status: 1, createdAt: -1 });
accountDeletionRequestSchema.index({ email: 1, status: 1 });

export default mongoose.model("AccountDeletionRequest", accountDeletionRequestSchema);
