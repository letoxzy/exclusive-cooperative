import mongoose from "mongoose";

const membershipSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    fullName: String,
    gender: String,
    phone: String,
    email: String,
    employmentStatus: String,
    employmentOther: String,
    lga: String,
    dob: String,
    maritalStatus: String,
    whatsapp: String,
    occupation: String,
    stateOfOrigin: String,
    address: String,
    passportPhotoUrl: String,

    frequency: String,
    voluntarySavings: String,
    referralSource: String,
    proposedAmount: Number,
    startDate: String,
    membershipCategory: String,

    // "interest-bearing" members pay interest on loans and earn
    // dividends on their savings. "interest-free" members pay no
    // loan interest and earn no dividends. Chosen at application
    // time and synced to User.membershipType once approved.
    membershipType: {
      type: String,
      enum: ["interest-bearing", "interest-free"],
      default: "interest-bearing",
    },

    kinName: String,
    kinPhone: String,
    kinAddress: String,
    kinRelationship: String,
    kinAltPhone: String,
    kinEmail: String,

    beneficiaryName: String,
    beneficiaryPhone: String,
    beneficiaryAddress: String,
    beneficiaryRelationship: String,

    declarationName: String,
    declarationDate: String,
    signatureUrl: String,
    declarationPhone: String,

    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  },
  { timestamps: true }
);

export default mongoose.model("Membership", membershipSchema);