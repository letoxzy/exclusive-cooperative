import mongoose from "mongoose";

// Stores the outcome of a request that carried an Idempotency-Key header, so a
// retry of the same request (after a timeout or dropped connection) gets the
// ORIGINAL answer instead of running the operation a second time.
const idempotencyKeySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    scope: { type: String, required: true }, // e.g. "withdrawals:create"
    key: { type: String, required: true },
    requestHash: { type: String, required: true },
    state: {
      type: String,
      enum: ["in_progress", "completed"],
      default: "in_progress",
    },
    responseStatus: { type: Number, default: null },
    responseBody: { type: mongoose.Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

idempotencyKeySchema.index({ user: 1, scope: 1, key: 1 }, { unique: true });
// Keys are only needed while a client could still be retrying.
idempotencyKeySchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

export default mongoose.model("IdempotencyKey", idempotencyKeySchema);
