import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true },

    // Password-reset token fields. The raw token is never stored; only a
    // SHA-256 hash is saved, and the token expires after one hour.
    passwordResetToken: {
      type: String,
      default: null,
      select: false,
    },
    passwordResetExpires: {
      type: Date,
      default: null,
      select: false,
    },

    // Legacy members added by an administrator receive a temporary password
    // and must choose their own password on first login.
    mustChangePassword: { type: Boolean, default: false },

    savingsBalance: { type: Number, default: 0 },

    // Total value of the member's cooperative shares.
    // Managed by administrators and displayed on the member dashboard.
    shareholding: { type: Number, default: 0, min: 0 },

    // Amount reserved by withdrawal requests that are still processing.
    // This does not reduce savingsBalance until Paystack confirms success.
    withdrawalReserved: { type: Number, default: 0 },

    role: {
      type: String,
      enum: ["member", "admin"],
      default: "member",
    },

    avatarUrl: { type: String, default: null },
    isApprovedMember: { type: Boolean, default: false },

    // Synced from Membership.membershipType when an admin approves
    // the member's application. Drives whether their loans carry
    // interest and whether they earn dividends.
    membershipType: {
      type: String,
      enum: ["interest-bearing", "interest-free"],
      default: null,
    },

    // Set true once an admin approves the member's Full Loan
    // Application (BVN + bio-data review). Required before the
    // member can submit an actual loan request.
    isLoanEligible: { type: Boolean, default: false },

    // App unlock security. The actual 6-digit app PIN is never stored; only
    // its bcrypt hash is stored in MongoDB so the same account works across devices.
    appPinHash: {
      type: String,
      default: null,
      select: false,
    },
    appPinFailedAttempts: {
      type: Number,
      default: 0,
      select: false,
    },
    appPinLockedUntil: {
      type: Date,
      default: null,
      select: false,
    },
    appPinSecurityAlertedAt: {
      type: Date,
      default: null,
      select: false,
    },
    autoLockSeconds: {
      type: Number,
      default: 300,
      min: 0,
    },
    biometricEnabled: {
      type: Boolean,
      default: false,
    },
    isBlocked: {
      type: Boolean,
      default: false,
      index: true,
    },
    blockedAt: {
      type: Date,
      default: null,
    },
    blockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    blockReason: {
      type: String,
      default: null,
      trim: true,
    },

    // Withdrawal security PIN.
    // The actual PIN is never stored; only the bcrypt hash is stored.
    withdrawalPinHash: {
      type: String,
      default: null,
      select: false,
    },

    // Failed PIN attempts are hidden from normal User queries.
    withdrawalPinFailedAttempts: {
      type: Number,
      default: 0,
      select: false,
    },

    // Temporary lock after too many incorrect withdrawal PIN attempts.
    withdrawalPinLockedUntil: {
      type: Date,
      default: null,
      select: false,
    },
  },
  { timestamps: true }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);

  next();
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

export default mongoose.model("User", userSchema);
