import mongoose from "mongoose";

const repaymentSchema = new mongoose.Schema(
  {
    installmentNumber: {
      type: Number,
      required: true,
    },

    dueDate: {
      type: Date,
      required: true,
    },

    amountDue: {
      type: Number,
      required: true,
    },

    amountPaid: {
      type: Number,
      default: 0,
    },

    paidDate: {
      type: Date,
      default: null,
    },

    status: {
      type: String,
      enum: ["pending", "partial", "paid", "overdue"],
      default: "pending",
    },
  },
  { _id: true }
);

const loanSchema = new mongoose.Schema(
  {
    // Member who applied for the loan
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Type of loan
    loanType: {
      type: String,
      enum: ["emergency", "business", "personal"],
      required: true,
    },

    // Amount requested by member
    amount: {
      type: Number,
      required: true,
      min: 1,
    },

    // Member's savings when application was submitted
    savingsAtApplication: {
      type: Number,
      required: true,
      min: 0,
    },

    // Maximum amount member was eligible for
    eligibleAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    // Interest rate applied to this loan
    interestRate: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Repayment period in months
    termMonths: {
      type: Number,
      required: true,
      min: 1,
    },

    // Reason for requesting the loan
    purpose: {
      type: String,
      trim: true,
      maxlength: 1000,
    },

    // Amount member is expected to repay in total
    totalRepayment: {
      type: Number,
      default: 0,
    },

    // Amount already paid against the loan repayment obligation.
    // This is independent of the member's savingsBalance.
    amountPaid: {
      type: Number,
      default: 0,
    },

    // Portion of the approved/disbursed loan principal that the member has
    // actually withdrawn to their bank account. This is separate from
    // amountPaid: withdrawing loan funds is a drawdown, not a repayment.
    loanFundsWithdrawn: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Loan funds reserved by bank-transfer requests that are still processing.
    loanFundsReserved: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Remaining loan debt. This becomes the totalRepayment only when the
    // approved loan is actually disbursed; it remains 0 before disbursement.
    outstandingBalance: {
      type: Number,
      default: 0,
    },

    // Loan lifecycle
    status: {
      type: String,
      enum: [
        "pending",
        "approved",
        "rejected",
        "active",
        "completed",
        "defaulted",
        "cancelled",
      ],
      default: "pending",
    },

    // Admin's reason when rejecting
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },

    // Important dates
    applicationDate: {
      type: Date,
      default: Date.now,
    },

    approvedDate: {
      type: Date,
      default: null,
    },

    rejectedDate: {
      type: Date,
      default: null,
    },

    disbursedDate: {
      type: Date,
      default: null,
    },

    completedDate: {
      type: Date,
      default: null,
    },

    // Generated when the loan is approved/disbursed
    repaymentSchedule: {
      type: [repaymentSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Loan", loanSchema);