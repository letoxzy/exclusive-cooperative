import express from "express";
import crypto from "crypto";

import User from "../models/User.js";
import Membership from "../models/Membership.js";
import SavingsTransaction from "../models/SavingsTransaction.js";
import Withdrawal from "../models/Withdrawal.js";
import Loan from "../models/Loan.js";
import LoanRepayment from "../models/LoanRepayment.js";
import LoanEligibility from "../models/LoanEligibility.js";
import {
  DividendDistribution,
  DividendEntry,
} from "../models/Dividend.js";

import { protect } from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/adminMiddleware.js";

const router = express.Router();

// Every route below requires a logged-in admin
router.use(protect, adminOnly);

/*
  ============================
  USERS
  ============================
*/

// GET /api/admin/users
router.get("/users", async (req, res) => {
  try {
    const users = await User.find()
      .select("-password")
      .sort("-createdAt");

    res.json(users);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

/*
  ============================
  SAVINGS REQUESTS
  ============================
*/

// GET /api/admin/savings-requests?status=pending
router.get("/savings-requests", async (req, res) => {
  try {
    const filter = req.query.status
      ? { status: req.query.status }
      : {};

    const requests = await SavingsTransaction.find(filter)
      .populate("user", "fullName email savingsBalance")
      .sort("-createdAt");

    res.json(requests);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

// PATCH /api/admin/savings-requests/:id
// body: { action: "approve" | "reject" }

router.patch("/savings-requests/:id", async (req, res) => {
  try {
    const { action } = req.body;

    const txn = await SavingsTransaction.findById(req.params.id);

    if (!txn) {
      return res.status(404).json({
        message: "Request not found",
      });
    }

    if (txn.status !== "pending") {
      return res.status(400).json({
        message: "This request has already been handled",
      });
    }

    if (action === "approve") {
      const user = await User.findById(txn.user);

      if (!user) {
        return res.status(404).json({
          message: "Member not found",
        });
      }

      user.savingsBalance += txn.amount;

      await user.save();

      txn.status = "approved";
    } else if (action === "reject") {
      txn.status = "rejected";
    } else {
      return res.status(400).json({
        message: "Invalid action",
      });
    }

    await txn.save();

    res.json(txn);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

/*
  ============================
  MEMBERSHIP
  ============================
*/

// GET /api/admin/membership
router.get("/membership", async (req, res) => {
  try {
    const apps = await Membership.find()
      .populate("user", "fullName email")
      .sort("-createdAt");

    res.json(apps);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

// Fields an admin is allowed to edit directly. Deliberately excludes
// _id, user, passportPhotoUrl, signatureUrl — those aren't meant to be
// hand-edited through this form.
const EDITABLE_MEMBERSHIP_FIELDS = [
  "fullName", "gender", "phone", "email", "employmentStatus", "employmentOther",
  "lga", "dob", "maritalStatus", "whatsapp", "occupation", "stateOfOrigin", "address",
  "frequency", "voluntarySavings", "referralSource", "proposedAmount", "startDate",
  "membershipCategory", "membershipType", "kinName", "kinPhone", "kinAddress", "kinRelationship",
  "kinAltPhone", "kinEmail", "beneficiaryName", "beneficiaryPhone",
  "beneficiaryAddress", "beneficiaryRelationship", "declarationName",
  "declarationDate", "declarationPhone",
];

// PATCH /api/admin/membership/:id
// body: { status?: "approved"|"rejected"|"pending", ...any editable field }
// Status changes and full detail edits both go through this one endpoint —
// the admin can do either or both in a single save.
router.patch("/membership/:id", async (req, res) => {
  try {
    const updates = {};

    if (req.body.status !== undefined) {
      if (!["approved", "rejected", "pending"].includes(req.body.status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      updates.status = req.body.status;
    }

    for (const field of EDITABLE_MEMBERSHIP_FIELDS) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    const app = await Membership.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true }
    );

    if (!app) {
      return res.status(404).json({
        message: "Application not found",
      });
    }

    if (app.user && updates.status !== undefined) {
      const userUpdates = {
        isApprovedMember: updates.status === "approved",
      };

      // Sync the member's interest-bearing/interest-free choice onto
      // the User record when their membership is approved, so loan
      // interest and dividend eligibility can be checked without
      // joining back to Membership every time.
      if (updates.status === "approved") {
        userUpdates.membershipType = app.membershipType || "interest-bearing";
      }

      await User.findByIdAndUpdate(app.user, userUpdates);
    } else if (
      app.user &&
      app.status === "approved" &&
      updates.membershipType !== undefined
    ) {
      // Admin edited membershipType on an already-approved
      // application (no status change in this request) — keep User
      // in sync so it takes effect immediately.
      await User.findByIdAndUpdate(app.user, {
        membershipType: updates.membershipType,
      });
    }

    res.json(app);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

/*
  ============================
  LOAN ELIGIBILITY APPLICATIONS
  (Full Loan Application: BVN + bio-data review)
  ============================
*/

/*
  GET /api/admin/loan-eligibility-applications

  Optional:
  /api/admin/loan-eligibility-applications?status=pending
*/
router.get("/loan-eligibility-applications", async (req, res) => {
  try {
    const filter = req.query.status ? { status: req.query.status } : {};

    const applications = await LoanEligibility.find(filter)
      .populate("user", "fullName email savingsBalance isApprovedMember")
      .sort("-createdAt");

    res.json(applications);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/*
  PATCH /api/admin/loan-eligibility-applications/:id

  Approve or reject a pending Full Loan Application.

  Approve:
  { action: "approve" }

  Reject:
  { action: "reject", rejectionReason: "Reason here" }

  Approving sets User.isLoanEligible = true, which is what unlocks
  the "Apply for Loan" flow for that member.
*/
router.patch("/loan-eligibility-applications/:id", async (req, res) => {
  try {
    const { action, rejectionReason } = req.body;

    const application = await LoanEligibility.findById(req.params.id);

    if (!application) {
      return res.status(404).json({
        message: "Loan eligibility application not found",
      });
    }

    if (application.status !== "pending") {
      return res.status(400).json({
        message: "This application has already been reviewed",
      });
    }

    if (action === "reject") {
      application.status = "rejected";
      application.rejectionReason = rejectionReason?.trim() || "";
      application.reviewedDate = new Date();

      await application.save();

      const populated = await LoanEligibility.findById(
        application._id
      ).populate("user", "fullName email savingsBalance isApprovedMember");

      return res.json(populated);
    }

    if (action === "approve") {
      application.status = "approved";
      application.reviewedDate = new Date();

      await application.save();

      await User.findByIdAndUpdate(application.user, {
        isLoanEligible: true,
      });

      const populated = await LoanEligibility.findById(
        application._id
      ).populate("user", "fullName email savingsBalance isApprovedMember");

      return res.json(populated);
    }

    return res.status(400).json({
      message: "Invalid action. Use approve or reject.",
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/*
  ============================
  LOAN REQUESTS
  ============================
*/

/*
  GET /api/admin/loans

  Optional:
  /api/admin/loans?status=pending
*/

router.get("/loans", async (req, res) => {
  try {
    const filter = req.query.status
      ? { status: req.query.status }
      : {};

    const loans = await Loan.find(filter)
      .populate(
        "user",
        "fullName email phone savingsBalance isApprovedMember"
      )
      .sort("-createdAt");

    res.json(loans);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

/*
  GET /api/admin/loans/:id

  Returns the complete loan application.
*/

router.get("/loans/:id", async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id).populate(
      "user",
      "fullName email phone savingsBalance isApprovedMember createdAt"
    );

    if (!loan) {
      return res.status(404).json({
        message: "Loan application not found",
      });
    }

    res.json(loan);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

/*
  PATCH /api/admin/loans/:id

  Approve or reject a pending loan.

  Approve:
  {
    action: "approve"
  }

  Reject:
  {
    action: "reject",
    rejectionReason: "Reason here"
  }
*/

router.patch("/loans/:id", async (req, res) => {
  try {
    const { action, rejectionReason } = req.body;

    const loan = await Loan.findById(req.params.id);

    if (!loan) {
      return res.status(404).json({
        message: "Loan application not found",
      });
    }

    if (loan.status !== "pending") {
      return res.status(400).json({
        message: "This loan application has already been reviewed",
      });
    }

    /*
      ============================
      REJECT LOAN
      ============================
    */

    if (action === "reject") {
      loan.status = "rejected";
      loan.rejectionReason = rejectionReason?.trim() || "";
      loan.rejectedDate = new Date();

      await loan.save();

      const populatedLoan = await Loan.findById(loan._id).populate(
        "user",
        "fullName email phone savingsBalance isApprovedMember"
      );

      return res.json(populatedLoan);
    }

    /*
      ============================
      APPROVE LOAN
      ============================
    */

    if (action === "approve") {
      const member = await User.findById(loan.user);

      if (!member) {
        return res.status(404).json({
          message: "Member associated with this loan was not found",
        });
      }

      if (!member.isApprovedMember) {
        return res.status(400).json({
          message:
            "This member is no longer an approved cooperative member",
        });
      }

      /*
        Re-check current savings before approval.

        This is important because the member's savings
        could have changed after they submitted the application.
      */

      const currentSavings = Number(member.savingsBalance || 0);
      const currentEligibility = currentSavings * 2;

      if (loan.amount > currentEligibility) {
        return res.status(400).json({
          message:
            `This loan can no longer be approved because the ` +
            `requested amount of ₦${loan.amount.toLocaleString()} ` +
            `is above the member's current eligibility of ` +
            `₦${currentEligibility.toLocaleString()}.`,
        });
      }

      /*
        Prevent another active/approved loan.
      */

      const existingLoan = await Loan.findOne({
        user: loan.user,
        _id: { $ne: loan._id },
        status: {
          $in: ["approved", "active"],
        },
      });

      if (existingLoan) {
        return res.status(400).json({
          message:
            "This member already has an approved or active loan.",
        });
      }

      /*
        Interest was already calculated and stored when the member
        submitted the application (loan.interestRate /
        loan.totalRepayment) — reuse those values here rather than
        recalculating, since amount/term don't change between
        application and approval.
      */

      const totalRepayment = loan.totalRepayment;

      /*
        Generate repayment schedule.

        Example:
        ₦60,000 / 6 months = ₦10,000 per month.
      */

      const monthlyPayment =
        Math.round((totalRepayment / loan.termMonths) * 100) / 100;

      const schedule = [];

      const approvalDate = new Date();

      for (let i = 1; i <= loan.termMonths; i++) {
        const dueDate = new Date(approvalDate);

        dueDate.setMonth(dueDate.getMonth() + i);

        let amountDue = monthlyPayment;

        /*
          Make sure the final installment corrects
          any rounding difference.
        */

        if (i === loan.termMonths) {
          const previousTotal = schedule.reduce(
            (sum, installment) => sum + installment.amountDue,
            0
          );

          amountDue =
            Math.round((totalRepayment - previousTotal) * 100) / 100;
        }

        schedule.push({
          installmentNumber: i,
          dueDate,
          amountDue,
          amountPaid: 0,
          paidDate: null,
          status: "pending",
        });
      }

      loan.status = "approved";
      loan.approvedDate = approvalDate;
      loan.amountPaid = 0;
      loan.outstandingBalance = totalRepayment;
      loan.repaymentSchedule = schedule;

      await loan.save();

      const populatedLoan = await Loan.findById(loan._id).populate(
        "user",
        "fullName email phone savingsBalance isApprovedMember"
      );

      return res.json(populatedLoan);
    }

    return res.status(400).json({
      message: "Invalid action. Use approve or reject.",
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

// PATCH /api/admin/loans/:id/disburse
router.patch("/loans/:id/disburse", async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id);

    if (!loan) {
      return res.status(404).json({
        message: "Loan application not found",
      });
    }

    if (loan.status !== "approved") {
      return res.status(400).json({
        message: "Only approved loans can be disbursed.",
      });
    }

    loan.status = "active";
    loan.disbursedDate = new Date();

    // The member now officially owes the loan amount.
    loan.amountPaid = 0;
    loan.outstandingBalance = loan.totalRepayment;

    await loan.save();

    // Credit the disbursed amount straight into the member's balance —
    // they see it land immediately, like a real bank transfer. This is
    // balanced out installment-by-installment as repayments are
    // confirmed below, so it doesn't permanently inflate their real
    // savings once the loan is fully repaid.
    await User.findByIdAndUpdate(loan.user, {
      $inc: { savingsBalance: loan.amount },
    });

    const populatedLoan = await Loan.findById(loan._id).populate(
      "user",
      "fullName email phone savingsBalance isApprovedMember"
    );

    res.json(populatedLoan);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

/*
  GET /api/admin/loan-repayments
  Optional: /api/admin/loan-repayments?status=pending
*/
router.get("/loan-repayments", async (req, res) => {
  try {
    const filter = req.query.status ? { status: req.query.status } : {};

    const repayments = await LoanRepayment.find(filter)
      .populate("user", "fullName email")
      .populate("loan", "loanType amount outstandingBalance status")
      .sort("-createdAt");

    res.json(repayments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/*
  PATCH /api/admin/loan-repayments/:id
  body: { action: "approve" | "reject" }

  Approving applies the payment to the loan's outstanding balance and the
  next unpaid installment(s) in its schedule, and reduces the member's
  balance by the same amount (mirroring the credit they got at disbursement).
*/
router.patch("/loan-repayments/:id", async (req, res) => {
  try {
    const { action } = req.body;
    const repayment = await LoanRepayment.findById(req.params.id);

    if (!repayment) {
      return res.status(404).json({ message: "Repayment request not found" });
    }
    if (repayment.status !== "pending") {
      return res.status(400).json({ message: "This request has already been handled" });
    }

    if (action === "reject") {
      repayment.status = "rejected";
      await repayment.save();
      return res.json(repayment);
    }

    if (action !== "approve") {
      return res.status(400).json({ message: "Invalid action" });
    }

    const loan = await Loan.findById(repayment.loan);
    if (!loan) {
      return res.status(404).json({ message: "Loan not found" });
    }

    let remaining = repayment.amount;

    // Apply the payment across the schedule, oldest unpaid installment first.
    for (const installment of loan.repaymentSchedule) {
      if (remaining <= 0) break;
      if (installment.status === "paid") continue;

      const stillOwedOnThis = installment.amountDue - installment.amountPaid;
      const applied = Math.min(stillOwedOnThis, remaining);

      installment.amountPaid += applied;
      remaining -= applied;

      if (installment.amountPaid >= installment.amountDue) {
        installment.status = "paid";
        installment.paidDate = new Date();
      } else if (installment.amountPaid > 0) {
        installment.status = "partial";
      }
    }

    loan.amountPaid += repayment.amount;
    loan.outstandingBalance = Math.max(0, loan.outstandingBalance - repayment.amount);

    if (loan.outstandingBalance === 0) {
      loan.status = "completed";
      loan.completedDate = new Date();
    }

    await loan.save();

    repayment.status = "approved";
    await repayment.save();

    // Balance out the earlier disbursement credit as the loan gets repaid.
    await User.findByIdAndUpdate(loan.user, {
      $inc: { savingsBalance: -repayment.amount },
    });

    res.json({ repayment, loan });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/*
  ============================
  DIVIDENDS
  ============================
*/

/*
  GET /api/admin/dividends

  Lists all dividend distributions (most recent first).
*/
router.get("/dividends", async (req, res) => {
  try {
    const distributions = await DividendDistribution.find().sort(
      "-createdAt"
    );

    res.json(distributions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/*
  POST /api/admin/dividends

  Create a new dividend distribution for a financial year. This does
  NOT calculate per-member amounts yet — that's a separate step
  (POST /:id/calculate) so the admin can review the pool before the
  system splits it.

  Body:
  {
    financialYear: 2026,
    pool: 7000000,
    distributionDate: "2026-12-31"
  }
*/
router.post("/dividends", async (req, res) => {
  try {
    const { financialYear, pool, distributionDate, periodStartDate, periodEndDate } = req.body;

    const year = Number(financialYear);
    const poolAmount = Number(pool);

    if (!Number.isFinite(year) || year <= 0) {
      return res.status(400).json({ message: "Enter a valid financial year." });
    }

    if (!Number.isFinite(poolAmount) || poolAmount <= 0) {
      return res.status(400).json({ message: "Enter a valid dividend pool amount." });
    }

    const startDate = periodStartDate ? new Date(periodStartDate) : null;
    const endDate = periodEndDate ? new Date(periodEndDate) : null;

    if (startDate && Number.isNaN(startDate.getTime())) {
      return res.status(400).json({ message: "Enter a valid dividend period start date." });
    }
    if (endDate && Number.isNaN(endDate.getTime())) {
      return res.status(400).json({ message: "Enter a valid dividend period end date." });
    }
    if (startDate && endDate && startDate > endDate) {
      return res.status(400).json({ message: "Dividend period start date must be before the end date." });
    }

    const distribution = await DividendDistribution.create({
      financialYear: year,
      pool: poolAmount,
      distributionDate: distributionDate || "",
      periodStartDate: startDate,
      periodEndDate: endDate,
      calculationBasis: "loan-interest-paid",
      status: "draft",
    });

    res.status(201).json(distribution);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/*
  GET /api/admin/dividends/:id

  Returns a distribution along with its per-member entries (if any
  have been calculated yet).
*/
router.get("/dividends/:id", async (req, res) => {
  try {
    const distribution = await DividendDistribution.findById(req.params.id);

    if (!distribution) {
      return res.status(404).json({ message: "Dividend distribution not found" });
    }

    const entries = await DividendEntry.find({ distribution: distribution._id })
      .populate("user", "fullName email membershipType")
      .sort("-dividendAmount");

    res.json({ distribution, entries });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/*
  POST /api/admin/dividends/:id/calculate

  Calculates each eligible member's dividend share, proportional to
  their savings contribution:

    memberDividend = (memberContribution / totalEligibleContributions) * pool

  Only approved, interest-bearing members with a savings balance
  above zero are eligible — interest-free members are excluded
  entirely, matching the membership-type rule.

  Re-running this on a distribution that's already been calculated
  replaces its entries (e.g. if savings balances changed since the
  last run), but only while it's not yet "completed".
*/
router.post("/dividends/:id/calculate", async (req, res) => {
  try {
    const distribution = await DividendDistribution.findById(req.params.id);

    if (!distribution) {
      return res.status(404).json({ message: "Dividend distribution not found" });
    }
    if (distribution.status === "completed") {
      return res.status(400).json({ message: "This distribution has already been completed and can't be recalculated." });
    }
    if (!distribution.periodStartDate || !distribution.periodEndDate) {
      return res.status(400).json({ message: "Set the dividend calculation period before calculating dividends." });
    }

    const periodEnd = new Date(distribution.periodEndDate);
    periodEnd.setHours(23, 59, 59, 999);

    const completedLoans = await Loan.find({
      status: "completed",
      completedDate: { $gte: distribution.periodStartDate, $lte: periodEnd },
    }).select("user amount totalRepayment interestRate completedDate");

    const eligibleMembers = await User.find({
      isApprovedMember: true,
      membershipType: "interest-bearing",
    }).select("_id");
    const eligibleIds = new Set(eligibleMembers.map((member) => String(member._id)));
    const interestByMember = new Map();

    for (const loan of completedLoans) {
      const userId = String(loan.user);
      if (!eligibleIds.has(userId)) continue;
      const interestPaid = Math.max(0, Number(loan.totalRepayment || 0) - Number(loan.amount || 0));
      interestByMember.set(userId, (interestByMember.get(userId) || 0) + interestPaid);
    }

    const qualifyingMembers = Array.from(interestByMember.entries())
      .filter(([, interest]) => interest > 0)
      .map(([user, qualifyingInterest]) => ({ user, qualifyingInterest }));

    const totalEligibleInterest = qualifyingMembers.reduce(
      (sum, member) => sum + member.qualifyingInterest,
      0
    );

    await DividendEntry.deleteMany({ distribution: distribution._id });

    if (totalEligibleInterest > 0) {
      const entries = qualifyingMembers.map(({ user, qualifyingInterest }) => ({
        distribution: distribution._id,
        user,
        contribution: qualifyingInterest,
        qualifyingInterest,
        dividendAmount: Math.round((qualifyingInterest / totalEligibleInterest) * distribution.pool),
        status: "pending",
      }));
      await DividendEntry.insertMany(entries);
    }

    distribution.totalEligibleInterest = totalEligibleInterest;
    distribution.status = "calculated";
    distribution.calculatedDate = new Date();
    await distribution.save();

    const entries = await DividendEntry.find({ distribution: distribution._id })
      .populate("user", "fullName email membershipType")
      .sort("-dividendAmount");

    res.json({ distribution, entries });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/*
  PATCH /api/admin/dividends/:id/entries/:entryId

  Mark a single member's dividend entry as paid.
*/
router.patch("/dividends/:id/entries/:entryId", async (req, res) => {
  try {
    const entry = await DividendEntry.findOne({
      _id: req.params.entryId,
      distribution: req.params.id,
    });

    if (!entry) {
      return res.status(404).json({ message: "Dividend entry not found" });
    }

    entry.status = "paid";
    entry.paidDate = new Date();

    await entry.save();

    const remainingPending = await DividendEntry.countDocuments({
      distribution: req.params.id,
      status: "pending",
    });

    if (remainingPending === 0) {
      await DividendDistribution.findByIdAndUpdate(req.params.id, {
        status: "completed",
      });
    }

    const populated = await DividendEntry.findById(entry._id).populate(
      "user",
      "fullName email membershipType"
    );

    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/*
  PATCH /api/admin/dividends/:id/pay-all

  Mark every pending entry in a distribution as paid in one go, and
  mark the distribution as completed.
*/
router.patch("/dividends/:id/pay-all", async (req, res) => {
  try {
    const distribution = await DividendDistribution.findById(req.params.id);

    if (!distribution) {
      return res.status(404).json({ message: "Dividend distribution not found" });
    }

    await DividendEntry.updateMany(
      { distribution: distribution._id, status: "pending" },
      { status: "paid", paidDate: new Date() }
    );

    distribution.status = "completed";
    await distribution.save();

    const entries = await DividendEntry.find({ distribution: distribution._id })
      .populate("user", "fullName email membershipType")
      .sort("-dividendAmount");

    res.json({ distribution, entries });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


/*
  ============================
  WITHDRAWALS
  ============================
*/

const PAYSTACK_BASE = "https://api.paystack.co";

async function paystack(path, options = {}) {
  const response = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function safeGatewayResponse(data) {
  return JSON.stringify({
    status: data?.status,
    message: data?.message,
    data: data?.data
      ? {
          status: data.data.status,
          reference: data.data.reference,
          transfer_code: data.data.transfer_code,
          failures: data.data.failures,
        }
      : undefined,
  }).slice(0, 5000);
}

// GET /api/admin/withdrawals
router.get("/withdrawals", async (req, res) => {
  try {
    const filter = req.query.status ? { status: req.query.status } : {};

    const withdrawals = await Withdrawal.find(filter)
      .populate("user", "fullName email savingsBalance withdrawalReserved")
      .sort("-createdAt");

    res.json(withdrawals);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/admin/withdrawals/:id/reject
router.patch("/withdrawals/:id/reject", async (req, res) => {
  try {
    const withdrawal = await Withdrawal.findById(req.params.id);

    if (!withdrawal) {
      return res.status(404).json({ message: "Withdrawal not found" });
    }

    if (withdrawal.status !== "pending") {
      return res.status(400).json({ message: "Only pending withdrawals can be rejected" });
    }

    withdrawal.status = "rejected";
    withdrawal.failureReason = String(req.body.reason || "Withdrawal rejected by administrator").trim();
    withdrawal.reviewedAt = new Date();
    await withdrawal.save();

    // Release the reserved amount without changing the member's actual savings.
    await User.findByIdAndUpdate(withdrawal.user, {
      $inc: { withdrawalReserved: -withdrawal.amount },
    });

    res.json(withdrawal);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/admin/withdrawals/:id/approve
// Approves a request and initiates the Paystack bank transfer.
router.patch("/withdrawals/:id/approve", async (req, res) => {
  try {
    const withdrawal = await Withdrawal.findOneAndUpdate(
      { _id: req.params.id, status: "pending" },
      { status: "processing", reviewedAt: new Date() },
      { new: true }
    );

    if (!withdrawal) {
      return res.status(400).json({
        message: "Withdrawal was not found or has already been processed.",
      });
    }

    if (!process.env.PAYSTACK_SECRET_KEY) {
      await Withdrawal.findByIdAndUpdate(withdrawal._id, {
        status: "failed",
        failureReason: "PAYSTACK_SECRET_KEY is not configured on the server.",
      });
      await User.findByIdAndUpdate(withdrawal.user, {
        $inc: { withdrawalReserved: -withdrawal.amount },
      });
      return res.status(500).json({
        message: "Paystack transfer is not configured on the server.",
      });
    }

    // Resolve the Nigerian account before creating the recipient.
    const { response: resolveResponse, data: resolveData } = await paystack(
      `/bank/resolve?account_number=${encodeURIComponent(withdrawal.accountNumber)}&bank_code=${encodeURIComponent(withdrawal.bankCode)}`
    );

    if (!resolveResponse.ok || !resolveData.status) {
      await Withdrawal.findByIdAndUpdate(withdrawal._id, {
        status: "failed",
        failureReason: resolveData.message || "Bank account could not be verified.",
      });
      await User.findByIdAndUpdate(withdrawal.user, {
        $inc: { withdrawalReserved: -withdrawal.amount },
      });

      return res.status(400).json({
        message: resolveData.message || "The bank account could not be verified.",
      });
    }

    const resolvedName = resolveData.data?.account_name || withdrawal.accountName;

    const { response: recipientResponse, data: recipientData } = await paystack(
      "/transferrecipient",
      {
        method: "POST",
        body: JSON.stringify({
          type: "nuban",
          name: resolvedName,
          account_number: withdrawal.accountNumber,
          bank_code: withdrawal.bankCode,
          currency: "NGN",
        }),
      }
    );

    if (!recipientResponse.ok || !recipientData.status) {
      await Withdrawal.findByIdAndUpdate(withdrawal._id, {
        status: "failed",
        failureReason: recipientData.message || "Could not create transfer recipient.",
      });
      await User.findByIdAndUpdate(withdrawal.user, {
        $inc: { withdrawalReserved: -withdrawal.amount },
      });

      return res.status(400).json({
        message: recipientData.message || "Could not create transfer recipient.",
      });
    }

    const recipientCode = recipientData.data?.recipient_code;

    // Paystack transfer references must be unique, lowercase, 16-50 chars.
    const reference = `wd_${crypto.randomUUID()}`.toLowerCase();

    const { response: transferResponse, data: transferData } = await paystack(
      "/transfer",
      {
        method: "POST",
        body: JSON.stringify({
          source: "balance",
          amount: Math.round(withdrawal.amount * 100),
          recipient: recipientCode,
          reference,
          reason: "Exclusive Cooperative savings withdrawal",
          currency: "NGN",
        }),
      }
    );

    if (!transferResponse.ok || !transferData.status) {
      await Withdrawal.findByIdAndUpdate(withdrawal._id, {
        status: "failed",
        failureReason: transferData.message || "Paystack could not initiate the transfer.",
        gatewayResponse: safeGatewayResponse(transferData),
      });
      await User.findByIdAndUpdate(withdrawal.user, {
        $inc: { withdrawalReserved: -withdrawal.amount },
      });

      return res.status(400).json({
        message: transferData.message || "Paystack could not initiate the transfer.",
      });
    }

    const transfer = transferData.data;
    const transferStatus = transfer?.status;

    await Withdrawal.findByIdAndUpdate(withdrawal._id, {
      recipientCode,
      reference,
      transferCode: transfer?.transfer_code,
      accountName: resolvedName,
      gatewayResponse: safeGatewayResponse(transferData),
      status:
        transferStatus === "success"
          ? "success"
          : transferStatus === "failed"
            ? "failed"
            : "processing",
      processedAt: transferStatus === "success" ? new Date() : undefined,
    });

    if (transferStatus === "success") {
      await User.findOneAndUpdate(
        {
          _id: withdrawal.user,
          savingsBalance: { $gte: withdrawal.amount },
          withdrawalReserved: { $gte: withdrawal.amount },
        },
        {
          $inc: {
            savingsBalance: -withdrawal.amount,
            withdrawalReserved: -withdrawal.amount,
          },
        }
      );

      await SavingsTransaction.create({
        user: withdrawal.user,
        amount: withdrawal.amount,
        status: "approved",
        method: "manual",
        reference: `withdrawal_${withdrawal._id}`,
        note: "Savings withdrawal paid via Paystack",
        type: "withdrawal",
        direction: "debit",
      });
    } else if (transferStatus === "failed") {
      await User.findByIdAndUpdate(withdrawal.user, {
        $inc: { withdrawalReserved: -withdrawal.amount },
      });
    }

    const fresh = await Withdrawal.findById(withdrawal._id)
      .populate("user", "fullName email savingsBalance withdrawalReserved");

    res.json({
      message:
        transferStatus === "success"
          ? "Withdrawal approved and paid successfully."
          : "Withdrawal approved and sent to Paystack for processing.",
      withdrawal: fresh,
    });
  } catch (err) {
    console.error("Withdrawal approval error:", err);
    try {
      const withdrawal = await Withdrawal.findOneAndUpdate(
        { _id: req.params.id, status: "processing" },
        { status: "failed", failureReason: err.message },
        { new: true }
      );
      if (withdrawal) {
        await User.findByIdAndUpdate(withdrawal.user, {
          $inc: { withdrawalReserved: -withdrawal.amount },
        });
      }
    } catch (_) {}

    res.status(500).json({ message: "Withdrawal processing failed" });
  }
});

// PATCH /api/admin/withdrawals/:id/sync
// Re-checks a processing Paystack transfer. Paystack also supports webhooks;
// this endpoint gives the admin a manual reconciliation option.
router.patch("/withdrawals/:id/sync", async (req, res) => {
  try {
    const withdrawal = await Withdrawal.findById(req.params.id);

    if (!withdrawal) {
      return res.status(404).json({ message: "Withdrawal not found" });
    }

    if (!withdrawal.reference) {
      return res.status(400).json({ message: "This withdrawal has no Paystack reference" });
    }

    const { response, data } = await paystack(
      `/transfer/verify/${encodeURIComponent(withdrawal.reference)}`
    );

    if (!response.ok || !data.status) {
      return res.status(400).json({ message: data.message || "Could not verify transfer" });
    }

    const status = data.data?.status;

    if (status === "success" && withdrawal.status !== "success") {
      const updated = await Withdrawal.findOneAndUpdate(
        { _id: withdrawal._id, status: { $in: ["processing", "pending"] } },
        {
          status: "success",
          transferCode: data.data?.transfer_code || withdrawal.transferCode,
          gatewayResponse: safeGatewayResponse(data),
          processedAt: new Date(),
        },
        { new: true }
      );

      if (updated) {
        await User.findOneAndUpdate(
          {
            _id: withdrawal.user,
            savingsBalance: { $gte: withdrawal.amount },
            withdrawalReserved: { $gte: withdrawal.amount },
          },
          {
            $inc: {
              savingsBalance: -withdrawal.amount,
              withdrawalReserved: -withdrawal.amount,
            },
          }
        );

        await SavingsTransaction.create({
          user: withdrawal.user,
          amount: withdrawal.amount,
          status: "approved",
          method: "manual",
          reference: `withdrawal_${withdrawal._id}`,
          note: "Savings withdrawal paid via Paystack",
          type: "withdrawal",
          direction: "debit",
        });
      }
    } else if (["failed", "reversed"].includes(status) && withdrawal.status !== "failed") {
      await Withdrawal.findByIdAndUpdate(withdrawal._id, {
        status: "failed",
        failureReason: data.data?.failures || `Paystack transfer ${status}`,
        gatewayResponse: safeGatewayResponse(data),
      });

      await User.findByIdAndUpdate(withdrawal.user, {
        $inc: { withdrawalReserved: -withdrawal.amount },
      });
    } else {
      await Withdrawal.findByIdAndUpdate(withdrawal._id, {
        gatewayResponse: safeGatewayResponse(data),
      });
    }

    const fresh = await Withdrawal.findById(withdrawal._id)
      .populate("user", "fullName email savingsBalance withdrawalReserved");

    res.json(fresh);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;