import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    tenantId: { type: String, default: "default" },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actorEmail: { type: String, default: "" },
    action: { type: String, required: true, index: true },
    targetType: { type: String, default: "" },
    targetId: { type: String, default: "" },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1 });

const blocked = (next) => next(new Error("Audit logs are immutable."));
["updateOne", "updateMany", "findOneAndUpdate", "deleteOne", "deleteMany", "findOneAndDelete"].forEach(
  (op) => auditLogSchema.pre(op, blocked)
);

export default mongoose.model("AuditLog", auditLogSchema);
