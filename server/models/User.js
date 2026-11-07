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

    // Member-selected regular contribution frequency from the approved
    // membership application. This controls how often a regular top-up
    // may be made; savings withdrawals remain monthly for everyone.
    contributionFrequency: {
      type: String,
      enum: ["Daily", "Weekly", "Monthly"],
      default: null,
    },

    // Total value of the member's cooperative shares.
    // Managed by administrators and displayed on the member dashboard.
    shareholding: { type: Number, default: 0, min: 0 },

    // Amount reserved by withdrawal requests that are still processing.
    // This does not reduce savingsBalance until Paystack confirms success.
    withdrawalReserved: { type: Number, default: 0 },
    // Set by the office (Admin > Deletions) when a member is leaving: lets them
    // withdraw ALL their savings, ignoring the 40% / once-a-month rule, until
    // expiresAt. Cleared on revoke, expiry or account deletion.
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
    autoLockSeconds: {
      type: Number,
      default: 300,
      min: 0,
    },
    biometricEnabled: {
      type: Boolean,
      default: false,
    },

    // Account-level theme preference. The mobile app uses this to keep
    // Light/Dark/System consistent across devices.
    themePreference: {
      type: String,
      enum: ["light", "dark", "system"],
      default: "system",
    },

    // Members can switch SMS copies of their notifications off.
    smsNotifications: { type: Boolean, default: true },

    // "Sign out other devices": login tokens issued before this moment are
    // rejected by the auth middleware.
    sessionsValidAfter: { type: Date, default: null },

    // One-time code issued by the office so a member without a smartphone can
    // set their own PIN over USSD. Only a hash is stored.
    ussdActivationHash: { type: String, select: false },
    ussdActivationExpires: { type: Date, select: false },
    ussdActivationFailures: { type: Number, default: 0, select: false },

    // Email sign-in verification code (see utils/loginOtp.js). Only a keyed
    // hash of the 6-digit code is stored; all fields are hidden by default.
    loginOtpHash: { type: String, default: null, select: false },
    loginOtpNonce: { type: String, default: null, select: false },
    loginOtpExpires: { type: Date, default: null, select: false },
    loginOtpAttempts: { type: Number, default: 0, select: false },
    loginOtpSentAt: { type: Date, default: null, select: false },
    loginOtpResends: { type: Number, default: 0, select: false },

    // Browsers that allowed website notifications (Web Push). Hidden by default.
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

    // Hashed fingerprints of devices that have signed in, used for the
    // "new sign-in" alert. Hidden from normal queries.
    knownDevices: {
      type: [{ _id: false, id: String, label: String, firstSeen: Date, lastSeen: Date }],
      default: [],
      select: false,
    },

    // Expo push tokens are stored on the account so security notifications
    // can reach the member even when the app is not open.
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

    // Temporary/permanent authentication security escalation shared by
    // website password login and mobile app PIN verification. The failed
    // attempt counter is account-level so members cannot bypass the policy
    // by switching between the website and mobile app.
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
