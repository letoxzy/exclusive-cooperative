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
    phone: { type: String, trim: true, unique: true, sparse: true },
    dateOfBirth: { type: Date },
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
    mustChangePassword: { type: Boolean, default: false },

    savingsBalance: { type: Number, default: 0 },
    contributionFrequency: {
      type: String,
      enum: ["Daily", "Weekly", "Monthly"],
      default: null,
    },
    shareholding: { type: Number, default: 0, min: 0 },
    withdrawalReserved: { type: Number, default: 0 },
    fullWithdrawalGrant: {
      active: { type: Boolean, default: false },
      grantedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      grantedAt: { type: Date, default: null },
      expiresAt: { type: Date, default: null },
      request: { type: mongoose.Schema.Types.ObjectId, ref: "AccountDeletionRequest", default: null },
    },

    role: {
      type: String,
      enum: ["member", "admin"],
      default: "member",
    },

    avatarUrl: { type: String, default: null },
    isApprovedMember: { type: Boolean, default: false },
    membershipType: {
      type: String,
      enum: ["interest-bearing", "interest-free"],
      default: null,
    },
    isLoanEligible: { type: Boolean, default: false },
    appPinHash: {
      type: String,
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
    themePreference: {
      type: String,
      enum: ["light", "dark", "system"],
      default: "system",
    },
    smsNotifications: { type: Boolean, default: true },
    sessionsValidAfter: { type: Date, default: null },

    ussdActivationHash: { type: String, select: false },
    ussdActivationExpires: { type: Date, select: false },
    ussdActivationFailures: { type: Number, default: 0, select: false },
    adminRole: {
      type: String,
      enum: ["full", "membership", "cash", "loan", "disbursement", "finance", "supervisor"],
      default: "full",
    },
    loginOtpHash: { type: String, default: null, select: false },
    loginOtpNonce: { type: String, default: null, select: false },
    loginOtpExpires: { type: Date, default: null, select: false },
    loginOtpAttempts: { type: Number, default: 0, select: false },
    loginOtpSentAt: { type: Date, default: null, select: false },
    loginOtpResends: { type: Number, default: 0, select: false },

    webPushSubscriptions: {
      type: [
        {
          _id: false,
          endpoint: { type: String, required: true },
          p256dh: { type: String, required: true },
          auth: { type: String, required: true },
          userAgent: { type: String, default: "" },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
      select: false,
    },
    knownDevices: {
      type: [{ _id: false, id: String, label: String, firstSeen: Date, lastSeen: Date }],
      default: [],
      select: false,
    },
    pushTokens: [
      {
        token: { type: String, trim: true },
        platform: { type: String, enum: ["ios", "android"], required: true },
        updatedAt: { type: Date, default: Date.now },
      },
    ],
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
    securityFailedAttempts: {
      type: Number,
      default: 0,
      min: 0,
      select: false,
    },
    securityLockLevel: {
      type: Number,
      default: 0,
      min: 0,
      max: 2,
      select: false,
    },
    securityLockedUntil: {
      type: Date,
      default: null,
      select: false,
    },
    securityLockedPermanently: {
      type: Boolean,
      default: false,
      index: true,
    },
    securityLockedAt: {
      type: Date,
      default: null,
    },
    securityLockReason: {
      type: String,
      default: null,
      trim: true,
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
