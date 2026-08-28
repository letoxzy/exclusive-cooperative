import mongoose from "mongoose";

/*
  A dividend distribution "batch" created by an admin for a given
  financial year — the pool amount is admin input; the per-member
  split (DividendEntry) is calculated by the system from each
  interest-bearing member's savings contribution.

  Only members with User.membershipType === "interest-bearing" are
  ever eligible — interest-free members neither pay loan interest
  nor earn dividends.
*/

const dividendDistributionSchema = new mongoose.Schema(
  {
    financialYear: {
      type: Number,
      required: true,
    },

    pool: {
      type: Number,
      required: true,
      min: 0,
    },

    // Fixed for now — interest-bearing members are the only
    // eligible membership type for dividends.
    eligibleMembershipType: {
      type: String,
      default: "interest-bearing",
    },

    // Dividend allocation is based on qualifying loan interest actually
    // paid on completed interest-bearing loans during the selected period.
    calculationBasis: {
      type: String,
      enum: ["loan-interest-paid"],
      default: "loan-interest-paid",
    },

    periodStartDate: {
      type: Date,
      default: null,
    },

    periodEndDate: {
      type: Date,
      default: null,
    },

    distributionDate: {
      type: String,
      default: "",
    },

    // "draft"      = created, not yet calculated
    // "calculated" = entries generated, ready for admin review
    // "completed"  = all entries marked paid
    status: {
      type: String,
      enum: ["draft", "calculated", "completed"],
      default: "draft",
    },

    // Total qualifying interest paid by eligible members in the period.
    totalEligibleInterest: {
      type: Number,
      default: 0,
    },

    calculatedDate: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export const DividendDistribution = mongoose.model(
  "DividendDistribution",
  dividendDistributionSchema
);

/*
  One row per eligible member within a DividendDistribution —
  mirrors the "Member | Contribution | Dividend | Status" table.
*/

const dividendEntrySchema = new mongoose.Schema(
  {
    distribution: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DividendDistribution",
      required: true,
    },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Qualifying loan interest actually paid by this member.
    contribution: {
      type: Number,
      required: true,
    },

    qualifyingInterest: {
      type: Number,
      required: true,
      default: 0,
    },

    dividendAmount: {
      type: Number,
      required: true,
    },

    status: {
      type: String,
      enum: ["pending", "paid"],
      default: "pending",
    },

    paidDate: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export const DividendEntry = mongoose.model(
  "DividendEntry",
  dividendEntrySchema
);
