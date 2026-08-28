import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    savingsBalance: { type: Number, default: 0 },
    // Amount reserved by withdrawal requests that are still processing.
    // This does not reduce savingsBalance until Paystack confirms success.
    withdrawalReserved: { type: Number, default: 0 },
    // Portion of the displayed balance that came from an outstanding loan
    // disbursement. Loan funds are not subject to the 20% savings reserve.
    loanFundsBalance: { type: Number, default: 0 },
    role: { type: String, enum: ["member", "admin"], default: "member" },
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