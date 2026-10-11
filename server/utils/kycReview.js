/*
  Rules for rejecting a Full Loan Application and for whether a rejected member
  may start a new verification. Pure functions (no database) so they can be
  tested directly.
*/

export const REJECTION_CATEGORIES = [
  "identity_mismatch",
  "duplicate_bvn",
  "unclear_photo",
  "details_incomplete",
  "suspected_fraud",
  "other",
];

// Categories where, unless the admin explicitly says otherwise, the rejection
// is final (no online reapplication).
const FINAL_BY_DEFAULT = new Set(["suspected_fraud", "duplicate_bvn"]);

export const reapplyCooldownHours = () => {
  const n = Number(process.env.KYC_REAPPLY_COOLDOWN_HOURS);
  return Number.isFinite(n) && n >= 0 ? n : 24;
};

/**
 * Validates an admin's rejection and works out what to store.
 * @returns {{error: string}|{fields: object, memberMessage: string}}
 */
export function buildRejection(
  { rejectionReason, rejectionCategory, internalNote, allowReapply },
  now = new Date(),
  cooldownHours = reapplyCooldownHours()
) {
  const reason = String(rejectionReason || "").trim();
  if (reason.length < 3) {
    return { error: "Please give the member a reason for the rejection." };
  }
  if (reason.length > 500) {
    return { error: "The reason shown to the member must be 500 characters or fewer." };
  }

  const category = String(rejectionCategory || "").trim();
  if (!REJECTION_CATEGORIES.includes(category)) {
    return { error: "Please choose a rejection category." };
  }

  const note = String(internalNote || "").trim();
  if (note.length > 1000) {
    return { error: "The internal note must be 1000 characters or fewer." };
  }

  const reapplyAllowed =
    typeof allowReapply === "boolean" ? allowReapply : !FINAL_BY_DEFAULT.has(category);

  const reapplyAfter =
    reapplyAllowed && cooldownHours > 0
      ? new Date(now.getTime() + cooldownHours * 60 * 60 * 1000)
      : null;

  let next;
  if (!reapplyAllowed) {
    next = "A new online verification is not available for this application. Please contact the cooperative office.";
  } else if (reapplyAfter) {
    next = `You can start a new verification after ${reapplyAfter.toLocaleString("en-NG", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Lagos",
    })}.`;
  } else {
    next = "You can start a new verification now.";
  }

  return {
    fields: {
      rejectionReason: reason,
      rejectionCategory: category,
      internalNote: note,
      reapplyAllowed,
      reapplyAfter,
    },
    memberMessage: `Your Full Loan Application was not approved. Reason: ${reason} ${next}`,
  };
}

/**
 * Is a member blocked from starting a new verification because of an admin's
 * rejection? Attempts that the system closed (no reviewer) never block.
 * @returns {null | {code: string, message: string, reapplyAfter?: Date}}
 */
export function reapplyBlock(application, now = new Date()) {
  if (!application || application.status !== "rejected" || !application.reviewedBy) return null;

  if (application.reapplyAllowed === false) {
    return {
      code: "REAPPLY_BLOCKED",
      message:
        "Your Full Loan Application was not approved and a new verification is not available online. Please contact the cooperative office.",
    };
  }
  if (application.reapplyAfter && new Date(application.reapplyAfter) > now) {
    return {
      code: "REAPPLY_COOLDOWN",
      reapplyAfter: application.reapplyAfter,
      message: `You can start a new verification after ${new Date(application.reapplyAfter).toLocaleString("en-NG", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Africa/Lagos",
      })}.`,
    };
  }
  return null;
}
