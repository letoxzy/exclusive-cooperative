import AuditLog from "../models/AuditLog.js";

/** Best-effort audit trail. Never throws, so it can't break the action it records. */
export async function audit(req, action, targetType = "", targetId = "", details = {}) {
  try {
    await AuditLog.create({
      actor: req?.user?._id || null,
      actorEmail: req?.user?.email || "",
      action,
      targetType,
      targetId: String(targetId || ""),
      details,
      ip: req?.ip || "",
    });
  } catch (err) {
    console.error("Audit log error:", err.message);
  }
}
