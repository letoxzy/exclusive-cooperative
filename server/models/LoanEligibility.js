import mongoose from "mongoose";

/*
  A member's "Full Loan Application" — the one-time eligibility
  application (BVN + bio-data pulled from their approved Membership
  record) that an admin reviews and approves before the member can
  submit an actual loan request ("Apply for Loan").

  This is intentionally a separate model from Loan: it is not itself
  a loan request (no amount/term/interest), and savings/contributions
  are not touched here at all.
*/

const loanEligibilitySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Raw BVNs are intentionally never returned to clients or admin screens.
    // New verification attempts store only a hash and the final four digits.
    bvnHash: {
      type: String,
      trim: true,
      default: "",
      select: false,
    },

    bvnLast4: {
      type: String,
      trim: true,
      default: "",
    },

    bvnVerifiedAt: {
      type: Date,
      default: null,
    },

    // Identity-verification state. These fields are populated as the
    // cooperative connects this application to an authorized BVN/KYC
    // provider. Keeping the states here lets the member and admin flows
    // be updated without creating a second eligibility record.
    consentStatus: {
      type: String,
      enum: ["not_started", "pending", "granted", "denied"],
      default: "not_started",
    },

    bvnVerificationStatus: {
      type: String,
      enum: ["not_started", "pending", "verified", "failed"],
      default: "not_started",
    },

    identityMatchStatus: {
      type: String,
      enum: ["not_started", "pending", "matched", "mismatch", "failed"],
      default: "not_started",
    },

    faceVerificationStatus: {
      type: String,
      enum: ["not_started", "pending", "verified", "failed", "not_required"],
      default: "not_started",
    },

    // Provider-generated identifiers/timestamps. Do not store provider
    // secrets or consent tokens here. A real retrieval token should be
    // handled only through the authorized provider's consent flow.
    verificationReference: {
      type: String,
      trim: true,
      default: "",
    },

    verificationProvider: {
      type: String,
      trim: true,
      default: "dojah",
    },

    providerVerificationStatus: {
      type: String,
      enum: ["not_started", "ongoing", "pending", "completed", "failed", "abandoned"],
      default: "not_started",
    },

    providerVerificationCompletedAt: {
      type: Date,
      default: null,
    },

    consentGrantedAt: {
      type: Date,
      default: null,
    },

    verifiedAt: {
      type: Date,
      default: null,
    },

    kycStartedAt: {
      type: Date,
      default: null,
    },

    // What Dojah returned, kept as an audit trail so the administrator can
    // still see the comparison if Dojah is unreachable later. Photos are NOT
    // stored here (Dojah media links expire after about an hour and the BVN
    // photo is fetched live), and the full BVN / ID numbers are never stored.
    verificationSnapshot: {
      capturedAt: { type: Date, default: null },
      sandbox: { type: Boolean, default: false },
      duplicateBvn: { type: Boolean, default: false },
      bvn: {
        fullName: { type: String, default: "" },
        dob: { type: String, default: "" },
        gender: { type: String, default: "" },
        phoneLast4: { type: String, default: "" },
      },
      id: {
        fullName: { type: String, default: "" },
        documentType: { type: String, default: "" },
        documentLast4: { type: String, default: "" },
      },
      comparison: {
        nameMatched: { type: Boolean, default: null },
        dobMatched: { type: Boolean, default: null },
        phoneMatched: { type: Boolean, default: null },
        genderMatched: { type: Boolean, default: null },
        idNameMatched: { type: Boolean, default: null },
        autoMatched: { type: Boolean, default: null },
      },
    },

    // Snapshot of the member's bio-data at the time of submission,
    // pulled from their approved Membership record.
    applicantDetails: {
      fullName: { type: String, default: "" },
      phone: { type: String, default: "" },
      email: { type: String, default: "" },
      address: { type: String, default: "" },
      dob: { type: String, default: "" },
      gender: { type: String, default: "" },
      maritalStatus: { type: String, default: "" },
      occupation: { type: String, default: "" },
      employmentStatus: { type: String, default: "" },
      stateOfOrigin: { type: String, default: "" },
      lga: { type: String, default: "" },
      kinName: { type: String, default: "" },
      kinPhone: { type: String, default: "" },
      kinRelationship: { type: String, default: "" },
      kinAddress: { type: String, default: "" },
    },

    // draft    = member has started verification but has not finished it
    // pending  = verification finished, waiting for an administrator decision
    // approved = administrator approved (User.isLoanEligible is set true)
    // rejected = administrator rejected, or the identity checks failed
    status: {
      type: String,
      enum: ["draft", "pending", "approved", "rejected"],
      default: "draft",
    },

    rejectionReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },

    // Set when the verification finishes and the application enters the
    // administrator's review queue.
    submittedDate: {
      type: Date,
      default: null,
    },

    reviewedDate: {
      type: Date,
      default: null,
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // True when an administrator approved even though the automatic identity
    // comparison flagged a difference (or a duplicate BVN). Kept for audit.
    approvedWithMismatch: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// One Dojah verification reference can only ever belong to one application.
// The partial filter ignores the empty-string default.
loanEligibilitySchema.index(
  { verificationReference: 1 },
  {
    unique: true,
    partialFilterExpression: { verificationReference: { $gt: "" } },
  }
);

export default mongoose.model("LoanEligibility", loanEligibilitySchema);
