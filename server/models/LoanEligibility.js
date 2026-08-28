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

    bvn: {
      type: String,
      trim: true,
      required: true,
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

    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },

    rejectionReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },

    submittedDate: {
      type: Date,
      default: Date.now,
    },

    reviewedDate: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("LoanEligibility", loanEligibilitySchema);
