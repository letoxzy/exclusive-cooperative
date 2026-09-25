import express from "express";
import multer from "multer";
import Loan from "../models/Loan.js";
import LoanRepayment from "../models/LoanRepayment.js";
import LoanEligibility from "../models/LoanEligibility.js";
import Membership from "../models/Membership.js";
import Notification from "../models/Notification.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireApprovedMember } from "../middleware/membershipMiddleware.js";
import { uploadBufferToCloudinary } from "../utils/cloudinaryUpload.js";
import { createNotificationAndPush } from "../utils/createNotification.js";
import CooperativeSetting from "../models/CooperativeSetting.js";

const router = express.Router();

const uploadReceipt = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image receipts are allowed."));
  },
});


/*
  Loan rules
  ----------
  - A member must first submit a Full Loan Application (BVN +
    bio-data pulled from their approved Membership record) and have
    an admin approve it. Only then are they "loan eligible" and can
    submit an actual loan request via "Apply for Loan".
  - Once loan eligible, a member can request up to 2x their current
    savings balance (savings/contributions are a separate concern —
    this route never touches savingsBalance, only reads it).
  - Repayment period is 3, 6, or 12 months.
  - Interest rate scales with term: 3mo = 5%, 6mo = 7%, 12mo = 10%.
*/

const DEFAULT_COOPERATIVE_SETTINGS = {
  loanMultiplier: 2,
  repaymentAccountName: "Exclusive Cooperative Multipurpose Society Limited",
  repaymentBank: "UBA",
  repaymentAccountNumber: "0123456789",
};

async function getCooperativeSettings() {
  let settings = await CooperativeSetting.findOne();
  if (!settings) {
    settings = await CooperativeSetting.create(DEFAULT_COOPERATIVE_SETTINGS);
  }
  return settings;
}

const ALLOWED_LOAN_TYPES = ["emergency", "business", "personal"];

const ALLOWED_TERMS = [3, 6, 12];

const INTEREST_RATE_BY_TERM = {
  3: 5,
  6: 7,
  12: 10,
};

const BVN_REGEX = /^\d{11}$/;

// Total repayment = principal + interest for the whole term
// (flat rate on the original amount, not compounding).
// "interest-free" members are charged 0% regardless of term — they
// also don't earn dividends (handled separately in dividend routes).
function calculateLoanTerms(amount, months, membershipType) {
  const interestRate =
    membershipType === "interest-free" ? 0 : INTEREST_RATE_BY_TERM[months];

  const totalRepayment = Math.round(amount + (amount * interestRate) / 100);

  return { interestRate, totalRepayment };
}


/*
  GET /api/loans/cooperative-config

  Returns the current cooperative configuration used by member-facing
  loan/repayment screens. The repayment account details are intentionally
  the cooperative's published payment destination.
*/
router.get("/cooperative-config", async (req, res) => {
  try {
    const settings = await getCooperativeSettings();

    res.json({
      loanMultiplier: Number(settings.loanMultiplier || 2),
      repaymentAccountName: settings.repaymentAccountName,
      repaymentBank: settings.repaymentBank,
      repaymentAccountNumber: settings.repaymentAccountNumber,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message || "Failed to load cooperative configuration.",
    });
  }
});

/*
  GET /api/loans/eligibility-application/me

  Returns the member's most recent Full Loan Application (or null if
  they haven't submitted one yet).
*/
router.get(
  "/eligibility-application/me",
  protect,
  requireApprovedMember,
  async (req, res) => {
    try {
      const application = await LoanEligibility.findOne({
        user: req.user._id,
      })
        .select("-verificationSnapshot -reviewedBy -approvedWithMismatch")
        .sort("-createdAt");

      res.json(application);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

/*
  Members no longer submit a Full Loan Application through a separate
  endpoint. The flow is:
    POST /api/kyc/start          -> server issues a Dojah reference
    (member completes the Dojah widget)
    POST /api/kyc/widget-result  -> backend confirms with Dojah and puts the
                                    application in the administrator's queue
    PATCH /api/admin/loan-eligibility-applications/:id -> approve / reject
*/

/*
  GET /api/loans/eligibility-application/verification-status

  Returns only the verification state needed by the member-facing UI.
  Raw BVN data is intentionally excluded from this response.
*/
router.get(
  "/eligibility-application/verification-status",
  protect,
  requireApprovedMember,
  async (req, res) => {
    try {
      const application = await LoanEligibility.findOne({
        user: req.user._id,
      })
        .select(
          "consentStatus bvnVerificationStatus identityMatchStatus faceVerificationStatus verificationReference consentGrantedAt verifiedAt status"
        )
        .sort("-createdAt");

      if (!application) {
        return res.json({
          exists: false,
          consentStatus: "not_started",
          bvnVerificationStatus: "not_started",
          identityMatchStatus: "not_started",
          faceVerificationStatus: "not_started",
          status: null,
        });
      }

      res.json({
        exists: true,
        ...application.toObject(),
      });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

// Shared eligibility checks for the actual loan request ("Apply for
// Loan"). Savings is intentionally kept separate here — this only
// reads req.user.savingsBalance, never touches it.
async function getEligibilityBlockers(userId, requestedAmount, eligibleAmount) {
  if (eligibleAmount <= 0) {
    return "You must have savings with the cooperative before applying for a loan.";
  }

  if (requestedAmount > eligibleAmount) {
    return `You can currently apply for a maximum of ₦${eligibleAmount.toLocaleString()}.`;
  }

  const pendingLoan = await Loan.findOne({ user: userId, status: "pending" });

  if (pendingLoan) {
    return "You already have a pending loan application. Please wait for the admin to review it.";
  }

  const activeLoan = await Loan.findOne({
    user: userId,
    status: { $in: ["approved", "active", "overdue"] },
  });

  if (activeLoan) {
    return "You already have an active loan. Please complete your current loan before applying for another.";
  }

  return null;
}

/*
  GET /api/loans/eligibility

  Returns the member's current loan eligibility. "canApply" is only
  true once the member has an admin-approved Full Loan Application
  AND their savings-based eligible amount is above zero.
*/
router.get("/eligibility", protect, requireApprovedMember, async (req, res) => {
  try {
    const settings = await getCooperativeSettings();
    const loanMultiplier = Number(settings.loanMultiplier || 2);
    const savingsBalance = Number(req.user.savingsBalance || 0);
    const eligibleAmount = savingsBalance * loanMultiplier;

    const activeLoan = await Loan.findOne({
      user: req.user._id,
      status: { $in: ["approved", "active", "overdue"] },
    }).select("_id amount outstandingBalance status");

    const pendingLoan = await Loan.findOne({
      user: req.user._id,
      status: "pending",
    }).select("_id amount status");

    const eligibilityApplication = await LoanEligibility.findOne({
      user: req.user._id,
    })
      .select("-verificationSnapshot -reviewedBy -approvedWithMismatch")
      .sort("-createdAt");

    res.json({
      isApprovedMember: req.user.isApprovedMember,
      isLoanEligible: req.user.isLoanEligible,
      membershipType: req.user.membershipType,
      eligibilityApplication,
      savingsBalance,
      eligibleAmount,
      loanMultiplier,
      hasActiveLoan: Boolean(activeLoan),
      activeLoan,
      hasPendingApplication: Boolean(pendingLoan),
      pendingLoan,
      canApply:
        req.user.isLoanEligible &&
        eligibleAmount > 0 &&
        !activeLoan &&
        !pendingLoan,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

/*
  POST /api/loans

  Member submits an actual loan request. Requires an admin-approved
  Full Loan Application (isLoanEligible) first.

  Body:
  {
    loanType: "business",
    amount: 50000,
    termMonths: 6,
    purpose: "Business expansion"
  }
*/
router.post("/", protect, requireApprovedMember, async (req, res) => {
  try {
    const {
      loanType,
      amount,
      termMonths,
      purpose,
    } = req.body;

    // ---------------------------------------
    // Must be loan eligible (Full Loan Application approved)
    // ---------------------------------------

    if (!req.user.isLoanEligible) {
      return res.status(400).json({
        message:
          "You need an approved Full Loan Application before you can apply for a loan.",
      });
    }

    // ---------------------------------------
    // Validate loan type
    // ---------------------------------------

    if (!ALLOWED_LOAN_TYPES.includes(loanType)) {
      return res.status(400).json({
        message:
          "Invalid loan type. Choose emergency, business, or personal.",
      });
    }

    // ---------------------------------------
    // Validate amount
    // ---------------------------------------

    const requestedAmount = Number(amount);

    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      return res.status(400).json({
        message: "Enter a valid loan amount.",
      });
    }

    // ---------------------------------------
    // Validate repayment term
    // ---------------------------------------

    const months = Number(termMonths);

    if (!ALLOWED_TERMS.includes(months)) {
      return res.status(400).json({
        message: "Invalid repayment period. Choose 3, 6, or 12 months.",
      });
    }

    // ---------------------------------------
    // Get current savings
    // ---------------------------------------

    const savingsBalance = Number(req.user.savingsBalance || 0);

    const eligibleAmount = savingsBalance * LOAN_MULTIPLIER;

    // ---------------------------------------
    // Check savings eligibility + existing loans
    // ---------------------------------------

    const blocker = await getEligibilityBlockers(
      req.user._id,
      requestedAmount,
      eligibleAmount
    );

    if (blocker) {
      return res.status(400).json({ message: blocker });
    }

    // ---------------------------------------
    // Interest + repayment calculation
    // ---------------------------------------

    const { interestRate, totalRepayment } = calculateLoanTerms(
      requestedAmount,
      months,
      req.user.membershipType
    );

    // ---------------------------------------
    // Create application
    // ---------------------------------------

    const loan = await Loan.create({
      user: req.user._id,

      loanType,

      amount: requestedAmount,

      savingsAtApplication: savingsBalance,

      eligibleAmount,

      interestRate,

      termMonths: months,

      purpose: purpose?.trim() || "",

      totalRepayment,

      amountPaid: 0,

      // The member does not owe the loan until it is actually disbursed.
      outstandingBalance: 0,
      loanFundsWithdrawn: 0,
      loanFundsReserved: 0,

      status: "pending",

      applicationDate: new Date(),
    });

    const populatedLoan = await Loan.findById(loan._id).populate(
      "user",
      "fullName email savingsBalance isApprovedMember"
    );

    await createNotificationAndPush({
      user: req.user._id,
      type: "loan",
      title: "Loan Application Submitted",
      message: `Your ${loanType} loan application for ₦${requestedAmount.toLocaleString()} has been submitted and is awaiting review.`,
    });

    res.status(201).json(populatedLoan);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

/*
  GET /api/loans/my-loans

  Returns the logged-in member's loan history.
*/
router.get("/my-loans", protect, async (req, res) => {
  try {
    const loans = await Loan.find({
      user: req.user._id,
    }).sort("-createdAt");

    res.json(loans);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

/*
  GET /api/loans/:id

  Member can view one of their own loans.
*/
router.get("/:id", protect, async (req, res) => {
  try {
    const loan = await Loan.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!loan) {
      return res.status(404).json({
        message: "Loan not found.",
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
  POST /api/loans/:id/repayments

  Member records that they've made a repayment towards their active loan.
  This does NOT change the balance yet — an admin has to confirm it first,
  same pattern as savings deposit requests.
*/
router.post("/:id/repayments", protect, uploadReceipt.single("receipt"), async (req, res) => {
  try {
    const { amount } = req.body;
    const requestedAmount = Number(amount);

    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      return res.status(400).json({ message: "Enter a valid repayment amount." });
    }

    const loan = await Loan.findOne({ _id: req.params.id, user: req.user._id });

    if (!loan) {
      return res.status(404).json({ message: "Loan not found." });
    }

    if (!['active', 'overdue'].includes(loan.status)) {
      return res.status(400).json({
        message: "Repayments can only be recorded against an active loan.",
      });
    }

    if (requestedAmount > loan.outstandingBalance) {
      return res.status(400).json({
        message: `That's more than you currently owe (₦${loan.outstandingBalance.toLocaleString()}).`,
      });
    }

    let receiptUrl = "";
    let receiptPublicId = "";

    if (req.file) {
      const uploadedReceipt = await uploadBufferToCloudinary(req.file.buffer, {
        folder: "exclusive-cooperative/repayment-receipts",
        resource_type: "image",
      });
      receiptUrl = uploadedReceipt.secure_url || uploadedReceipt.url || "";
      receiptPublicId = uploadedReceipt.public_id || "";
    }

    const repayment = await LoanRepayment.create({
      loan: loan._id,
      user: req.user._id,
      amount: requestedAmount,
      receiptUrl,
      receiptPublicId,
    });

    await createNotificationAndPush({
      user: req.user._id,
      type: "repayment",
      title: "Loan Repayment Submitted",
      message: `Your loan repayment of ₦${requestedAmount.toLocaleString()} has been submitted with a transfer receipt and is awaiting confirmation.`,
    });

    res.status(201).json(repayment);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/*
  GET /api/loans/:id/repayments

  Member's own repayment history for one loan.
*/
router.get("/:id/repayments", protect, async (req, res) => {
  try {
    const loan = await Loan.findOne({ _id: req.params.id, user: req.user._id });

    if (!loan) {
      return res.status(404).json({ message: "Loan not found." });
    }

    const repayments = await LoanRepayment.find({ loan: loan._id }).sort("-createdAt");
    res.json(repayments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
