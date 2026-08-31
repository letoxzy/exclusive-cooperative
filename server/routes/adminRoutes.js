import express from "express";
import crypto from "crypto";
import multer from "multer";

import User from "../models/User.js";
import Membership from "../models/Membership.js";
import SavingsTransaction from "../models/SavingsTransaction.js";
import Loan from "../models/Loan.js";
import LoanRepayment from "../models/LoanRepayment.js";
import Withdrawal from "../models/Withdrawal.js";
import LoanEligibility from "../models/LoanEligibility.js";
import Notification from "../models/Notification.js";
import {
  DividendDistribution,
  DividendEntry,
} from "../models/Dividend.js";

import { protect } from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/adminMiddleware.js";
import { settleWithdrawal } from "../utils/withdrawalSettlement.js";
import { uploadBufferToCloudinary } from "../utils/cloudinaryUpload.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Only image files are allowed for passport photo and signature."
        )
      );
    }
  },
});

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
  ADD EXISTING MEMBER
  ============================
*/

// POST /api/admin/members/existing
// Creates a login account and imports the member's existing membership data.
router.post(
  "/members/existing",
  upload.fields([
    { name: "passportPhoto", maxCount: 1 },
    { name: "signature", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const {
        fullName,
        gender,
        phone,
        email,
        employmentStatus,
        employmentOther,
        lga,
        dob,
        maritalStatus,
        whatsapp,
        occupation,
        stateOfOrigin,
        address,
        frequency,
        voluntarySavings,
        referralSource,
        proposedAmount,
        startDate,
        membershipCategory,
        membershipType,
        kinName,
        kinPhone,
        kinAddress,
        kinRelationship,
        kinAltPhone,
        kinEmail,
        beneficiaryName,
        beneficiaryPhone,
        beneficiaryAddress,
        beneficiaryRelationship,
        declarationName,
        declarationDate,
        declarationPhone,
      } = req.body;

      const cleanName = String(fullName || "").trim();
      const cleanEmail = String(email || "").trim().toLowerCase();

      if (!cleanName || !cleanEmail) {
        return res.status(400).json({
          message: "Full name and email are required.",
        });
      }

      if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
        return res.status(400).json({
          message: "Please provide a valid email address.",
        });
      }

      const existingUser = await User.findOne({
        email: cleanEmail,
      });

      if (existingUser) {
        return res.status(409).json({
          message: "An account with this email already exists.",
        });
      }

      const existingMembership = await Membership.findOne({
        email: cleanEmail,
      });

      if (existingMembership) {
        return res.status(409).json({
          message: "A membership record with this email already exists.",
        });
      }

      // Generate temporary password
      const temporaryPassword =
        crypto.randomBytes(12).toString("base64url").slice(0, 16) +
        "!A9";

      /*
        ============================
        IMAGE UPLOADS
        ============================
      */

      const passportFile = req.files?.passportPhoto?.[0];
      const signatureFile = req.files?.signature?.[0];

      const [passportResult, signatureResult] = await Promise.all([
        passportFile
          ? uploadBufferToCloudinary(passportFile.buffer, {
              folder: "exclusive-cooperative/membership",
            })
          : Promise.resolve(null),

        signatureFile
          ? uploadBufferToCloudinary(signatureFile.buffer, {
              folder: "exclusive-cooperative/membership",
            })
          : Promise.resolve(null),
      ]);

      const passportPhotoUrl =
        passportResult?.secure_url || null;

      const signatureUrl =
        signatureResult?.secure_url || null;

      /*
        ============================
        CREATE USER ACCOUNT
        ============================
      */

      const user = await User.create({
        fullName: cleanName,
        email: cleanEmail,
        password: temporaryPassword,
        role: "member",
        isApprovedMember: true,
        membershipType:
          membershipType === "interest-free"
            ? "interest-free"
            : "interest-bearing",
        mustChangePassword: true,
      });

      try {
        /*
          ============================
          CREATE MEMBERSHIP
          ============================
        */

        const membership = await Membership.create({
          user: user._id,

          fullName: cleanName,
          gender,
          phone,
          email: cleanEmail,
          employmentStatus,
          employmentOther,
          lga,
          dob,
          maritalStatus,
          whatsapp,
          occupation,
          stateOfOrigin,
          address,

          // IMPORTANT:
          // Save Cloudinary URLs in the membership document
          passportPhotoUrl,
          signatureUrl,

          frequency,
          voluntarySavings,
          referralSource,

          proposedAmount:
            proposedAmount === "" || proposedAmount == null
              ? undefined
              : Number(proposedAmount),

          startDate,
          membershipCategory,

          membershipType:
            membershipType === "interest-free"
              ? "interest-free"
              : "interest-bearing",

          kinName,
          kinPhone,
          kinAddress,
          kinRelationship,
          kinAltPhone,
          kinEmail,

          beneficiaryName,
          beneficiaryPhone,
          beneficiaryAddress,
          beneficiaryRelationship,

          declarationName:
            declarationName || cleanName,

          declarationDate,
          declarationPhone,

          status: "approved",
        });

        /*
          ============================
          NOTIFICATION
          ============================
        */

        await Notification.create({
          user: user._id,
          type: "membership",
          title: "Member Account Created",
          message:
            "Your cooperative account has been created from your existing membership record. Please change your temporary password after your first login.",
        });

        return res.status(201).json({
          message:
            "Existing member account created successfully.",

          temporaryPassword,

          user: {
            _id: user._id,
            fullName: user.fullName,
            email: user.email,
            role: user.role,
            isApprovedMember: user.isApprovedMember,
            membershipType: user.membershipType,
            mustChangePassword: user.mustChangePassword,
            createdAt: user.createdAt,
          },

          membership,
        });
      } catch (membershipError) {
        await User.findByIdAndDelete(user._id);
        throw membershipError;
      }
    } catch (err) {
      console.error("Add existing member error:", err);

      res.status(500).json({
        message:
          err.message ||
          "Failed to create existing member account.",
      });
    }
  }
);

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
      .populate(
        "user",
        "fullName email savingsBalance"
      )
      .sort("-createdAt");

    res.json(requests);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

// PATCH /api/admin/savings-requests/:id
router.patch(
  "/savings-requests/:id",
  async (req, res) => {
    try {
      const { action } = req.body;

      const txn = await SavingsTransaction.findById(
        req.params.id
      );

      if (!txn) {
        return res.status(404).json({
          message: "Request not found",
        });
      }

      if (txn.status !== "pending") {
        return res.status(400).json({
          message:
            "This request has already been handled",
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
        user.savingsWithdrawalLocked = false;

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

      const savingsNotification =
        action === "approve"
          ? {
              title: "Savings Payment Approved",
              message: `Your savings payment of ₦${Number(
                txn.amount || 0
              ).toLocaleString()} has been approved and added to your savings balance.`,
            }
          : {
              title: "Savings Payment Rejected",
              message: `Your savings payment of ₦${Number(
                txn.amount || 0
              ).toLocaleString()} was rejected.`,
            };

      await Notification.create({
        user: txn.user,
        type: "savings",
        ...savingsNotification,
      });

      res.json(txn);
    } catch (err) {
      res.status(500).json({
        message: err.message,
      });
    }
  }
);

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

// Fields an admin is allowed to edit directly.
const EDITABLE_MEMBERSHIP_FIELDS = [
  "fullName",
  "gender",
  "phone",
  "email",
  "employmentStatus",
  "employmentOther",
  "lga",
  "dob",
  "maritalStatus",
  "whatsapp",
  "occupation",
  "stateOfOrigin",
  "address",
  "frequency",
  "voluntarySavings",
  "referralSource",
  "proposedAmount",
  "startDate",
  "membershipCategory",
  "membershipType",
  "kinName",
  "kinPhone",
  "kinAddress",
  "kinRelationship",
  "kinAltPhone",
  "kinEmail",
  "beneficiaryName",
  "beneficiaryPhone",
  "beneficiaryAddress",
  "beneficiaryRelationship",
  "declarationName",
  "declarationDate",
  "declarationPhone",
];

// PATCH /api/admin/membership/:id
router.patch(
  "/membership/:id",
  async (req, res) => {
    try {
      const updates = {};

      if (req.body.status !== undefined) {
        if (
          ![
            "approved",
            "rejected",
            "pending",
          ].includes(req.body.status)
        ) {
          return res.status(400).json({
            message: "Invalid status",
          });
        }

        updates.status = req.body.status;
      }

      for (const field of EDITABLE_MEMBERSHIP_FIELDS) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }

      const app =
        await Membership.findByIdAndUpdate(
          req.params.id,
          updates,
          { new: true }
        );

      if (!app) {
        return res.status(404).json({
          message: "Application not found",
        });
      }

      if (
        app.user &&
        updates.status !== undefined
      ) {
        const userUpdates = {
          isApprovedMember:
            updates.status === "approved",
        };

        if (updates.status === "approved") {
          userUpdates.membershipType =
            app.membershipType ||
            "interest-bearing";
        }

        await User.findByIdAndUpdate(
          app.user,
          userUpdates
        );

        if (updates.status === "approved") {
          await Notification.create({
            user: app.user,
            type: "membership",
            title: "Membership Approved",
            message:
              "Your membership application has been approved. Welcome to Exclusive Cooperative.",
          });
        }

        if (updates.status === "rejected") {
          await Notification.create({
            user: app.user,
            type: "membership",
            title:
              "Membership Application Update",
            message:
              "Your membership application was not approved.",
          });
        }
      } else if (
        app.user &&
        app.status === "approved" &&
        updates.membershipType !== undefined
      ) {
        await User.findByIdAndUpdate(
          app.user,
          {
            membershipType:
              updates.membershipType,
          }
        );
      }

      res.json(app);
    } catch (err) {
      res.status(500).json({
        message: err.message,
      });
    }
  }
);

/*
  ============================
  LOAN ELIGIBILITY APPLICATIONS
  ============================
*/

router.get(
  "/loan-eligibility-applications",
  async (req, res) => {
    try {
      const filter = req.query.status
        ? { status: req.query.status }
        : {};

      const applications =
        await LoanEligibility.find(filter)
          .populate(
            "user",
            "fullName email savingsBalance isApprovedMember"
          )
          .sort("-createdAt");

      res.json(applications);
    } catch (err) {
      res.status(500).json({
        message: err.message,
      });
    }
  }
);

router.patch(
  "/loan-eligibility-applications/:id",
  async (req, res) => {
    try {
      const {
        action,
        rejectionReason,
      } = req.body;

      const application =
        await LoanEligibility.findById(
          req.params.id
        );

      if (!application) {
        return res.status(404).json({
          message:
            "Loan eligibility application not found",
        });
      }

      if (application.status !== "pending") {
        return res.status(400).json({
          message:
            "This application has already been reviewed",
        });
      }

      if (action === "reject") {
        application.status = "rejected";
        application.rejectionReason =
          rejectionReason?.trim() || "";
        application.reviewedDate = new Date();

        await application.save();

        await Notification.create({
          user: application.user,
          type: "loan-eligibility",
          title:
            "Full Loan Application Update",
          message:
            application.rejectionReason
              ? `Your Full Loan Application was not approved. Reason: ${application.rejectionReason}`
              : "Your Full Loan Application was not approved.",
        });

        const populated =
          await LoanEligibility.findById(
            application._id
          ).populate(
            "user",
            "fullName email savingsBalance isApprovedMember"
          );

        return res.json(populated);
      }

      if (action === "approve") {
        application.status = "approved";
        application.reviewedDate = new Date();

        await application.save();

        await User.findByIdAndUpdate(
          application.user,
          {
            isLoanEligible: true,
          }
        );

        await Notification.create({
          user: application.user,
          type: "loan-eligibility",
          title: "Loan Eligibility Approved",
          message:
            "Your Full Loan Application has been approved. You are now eligible to apply for a loan.",
        });

        const populated =
          await LoanEligibility.findById(
            application._id
          ).populate(
            "user",
            "fullName email savingsBalance isApprovedMember"
          );

        return res.json(populated);
      }

      return res.status(400).json({
        message:
          "Invalid action. Use approve or reject.",
      });
    } catch (err) {
      res.status(500).json({
        message: err.message,
      });
    }
  }
);

/*
  ============================
  LOAN REQUESTS
  ============================
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

router.get(
  "/loans/:id",
  async (req, res) => {
    try {
      const loan =
        await Loan.findById(
          req.params.id
        ).populate(
          "user",
          "fullName email phone savingsBalance isApprovedMember createdAt"
        );

      if (!loan) {
        return res.status(404).json({
          message:
            "Loan application not found",
        });
      }

      res.json(loan);
    } catch (err) {
      res.status(500).json({
        message: err.message,
      });
    }
  }
);

router.patch(
  "/loans/:id",
  async (req, res) => {
    try {
      const {
        action,
        rejectionReason,
      } = req.body;

      const loan =
        await Loan.findById(
          req.params.id
        );

      if (!loan) {
        return res.status(404).json({
          message:
            "Loan application not found",
        });
      }

      if (loan.status !== "pending") {
        return res.status(400).json({
          message:
            "This loan application has already been reviewed",
        });
      }

      if (action === "reject") {
        loan.status = "rejected";
        loan.rejectionReason =
          rejectionReason?.trim() || "";
        loan.rejectedDate = new Date();

        await loan.save();

        await Notification.create({
          user: loan.user,
          type: "loan",
          title: "Loan Application Rejected",
          message:
            loan.rejectionReason
              ? `Your loan application was rejected. Reason: ${loan.rejectionReason}`
              : "Your loan application was rejected.",
        });

        const populatedLoan =
          await Loan.findById(
            loan._id
          ).populate(
            "user",
            "fullName email phone savingsBalance isApprovedMember"
          );

        return res.json(populatedLoan);
      }

      if (action === "approve") {
        const member =
          await User.findById(
            loan.user
          );

        if (!member) {
          return res.status(404).json({
            message:
              "Member associated with this loan was not found",
          });
        }

        if (!member.isApprovedMember) {
          return res.status(400).json({
            message:
              "This member is no longer an approved cooperative member",
          });
        }

        const currentSavings =
          Number(
            member.savingsBalance || 0
          );

        const currentEligibility =
          currentSavings * 2;

        if (
          loan.amount >
          currentEligibility
        ) {
          return res.status(400).json({
            message:
              `This loan can no longer be approved because the ` +
              `requested amount of ₦${loan.amount.toLocaleString()} ` +
              `is above the member's current eligibility of ` +
              `₦${currentEligibility.toLocaleString()}.`,
          });
        }

        const existingLoan =
          await Loan.findOne({
            user: loan.user,
            _id: {
              $ne: loan._id,
            },
            status: {
              $in: [
                "approved",
                "active",
              ],
            },
          });

        if (existingLoan) {
          return res.status(400).json({
            message:
              "This member already has an approved or active loan.",
          });
        }

        const totalRepayment =
          loan.totalRepayment;

        const monthlyPayment =
          Math.round(
            (totalRepayment /
              loan.termMonths) *
              100
          ) / 100;

        const schedule = [];

        const approvalDate =
          new Date();

        for (
          let i = 1;
          i <= loan.termMonths;
          i++
        ) {
          const dueDate =
            new Date(
              approvalDate
            );

          dueDate.setMonth(
            dueDate.getMonth() + i
          );

          let amountDue =
            monthlyPayment;

          if (
            i ===
            loan.termMonths
          ) {
            const previousTotal =
              schedule.reduce(
                (
                  sum,
                  installment
                ) =>
                  sum +
                  installment.amountDue,
                0
              );

            amountDue =
              Math.round(
                (totalRepayment -
                  previousTotal) *
                  100
              ) / 100;
          }

          schedule.push({
            installmentNumber:
              i,
            dueDate,
            amountDue,
            amountPaid: 0,
            paidDate: null,
            status: "pending",
          });
        }

        loan.status = "approved";
        loan.approvedDate =
          approvalDate;
        loan.amountPaid = 0;
        loan.outstandingBalance =
          totalRepayment;
        loan.repaymentSchedule =
          schedule;

        await loan.save();

        await Notification.create({
          user: loan.user,
          type: "loan",
          title:
            "Loan Application Approved",
          message:
            `Your loan application for ₦${Number(
              loan.amount || 0
            ).toLocaleString()} has been approved.`,
        });

        const populatedLoan =
          await Loan.findById(
            loan._id
          ).populate(
            "user",
            "fullName email phone savingsBalance isApprovedMember"
          );

        return res.json(
          populatedLoan
        );
      }

      return res.status(400).json({
        message:
          "Invalid action. Use approve or reject.",
      });
    } catch (err) {
      res.status(500).json({
        message: err.message,
      });
    }
  }
);

router.patch(
  "/loans/:id/disburse",
  async (req, res) => {
    try {
      const loan =
        await Loan.findById(
          req.params.id
        );

      if (!loan) {
        return res.status(404).json({
          message:
            "Loan application not found",
        });
      }

      if (loan.status !== "approved") {
        return res.status(400).json({
          message:
            "Only approved loans can be disbursed.",
        });
      }

      loan.status = "active";
      loan.disbursedDate =
        new Date();

      loan.amountPaid = 0;
      loan.outstandingBalance =
        loan.totalRepayment;

      await loan.save();

      await User.findByIdAndUpdate(
        loan.user,
        {
          $inc: {
            savingsBalance:
              loan.amount,
            loanFundsBalance:
              loan.amount,
          },
        }
      );

      await Notification.create({
        user: loan.user,
        type: "loan",
        title: "Loan Disbursed",
        message:
          `Your loan of ₦${Number(
            loan.amount || 0
          ).toLocaleString()} has been disbursed to your cooperative account.`,
      });

      const populatedLoan =
        await Loan.findById(
          loan._id
        ).populate(
          "user",
          "fullName email phone savingsBalance isApprovedMember"
        );

      res.json(
        populatedLoan
      );
    } catch (err) {
      res.status(500).json({
        message: err.message,
      });
    }
  }
);

/*
  ============================
  LOAN REPAYMENTS
  ============================
*/

router.get(
  "/loan-repayments",
  async (req, res) => {
    try {
      const filter = req.query.status
        ? {
            status:
              req.query.status,
          }
        : {};

      const repayments =
        await LoanRepayment.find(
          filter
        )
          .populate(
            "user",
            "fullName email"
          )
          .populate(
            "loan",
            "loanType amount outstandingBalance status"
          )
          .sort("-createdAt");

      res.json(repayments);
    } catch (err) {
      res.status(500).json({
        message: err.message,
      });
    }
  }
);

router.patch(
  "/loan-repayments/:id",
  async (req, res) => {
    try {
      const { action } =
        req.body;

      const repayment =
        await LoanRepayment.findById(
          req.params.id
        );

      if (!repayment) {
        return res.status(404).json({
          message:
            "Repayment request not found",
        });
      }

      if (
        repayment.status !==
        "pending"
      ) {
        return res.status(400).json({
          message:
            "This request has already been handled",
        });
      }

      if (action === "reject") {
        repayment.status =
          "rejected";

        await repayment.save();

        await Notification.create({
          user: repayment.user,
          type: "repayment",
          title:
            "Loan Repayment Rejected",
          message:
            `Your loan repayment of ₦${Number(
              repayment.amount || 0
            ).toLocaleString()} was rejected.`,
        });

        return res.json(
          repayment
        );
      }

      if (action !== "approve") {
        return res.status(400).json({
          message:
            "Invalid action",
        });
      }

      const loan =
        await Loan.findById(
          repayment.loan
        );

      if (!loan) {
        return res.status(404).json({
          message: "Loan not found",
        });
      }

      let remaining =
        repayment.amount;

      for (
        const installment of
          loan.repaymentSchedule
      ) {
        if (remaining <= 0)
          break;

        if (
          installment.status ===
          "paid"
        ) {
          continue;
        }

        const stillOwedOnThis =
          installment.amountDue -
          installment.amountPaid;

        const applied =
          Math.min(
            stillOwedOnThis,
            remaining
          );

        installment.amountPaid +=
          applied;

        remaining -= applied;

        if (
          installment.amountPaid >=
          installment.amountDue
        ) {
          installment.status =
            "paid";

          installment.paidDate =
            new Date();
        } else if (
          installment.amountPaid > 0
        ) {
          installment.status =
            "partial";
        }
      }

      loan.amountPaid +=
        repayment.amount;

      loan.outstandingBalance =
        Math.max(
          0,
          loan.outstandingBalance -
            repayment.amount
        );

      if (
        loan.outstandingBalance ===
        0
      ) {
        loan.status =
          "completed";

        loan.completedDate =
          new Date();
      }

      await loan.save();

      repayment.status =
        "approved";

      await repayment.save();

      await Notification.create({
        user: repayment.user,
        type: "repayment",
        title:
          "Loan Repayment Confirmed",
        message:
          `Your loan repayment of ₦${Number(
            repayment.amount || 0
          ).toLocaleString()} has been confirmed.`,
      });

      if (
        loan.status ===
        "completed"
      ) {
        await Notification.create({
          user: loan.user,
          type: "loan",
          title:
            "Loan Completed",
          message:
            "Your loan has been fully repaid and marked as completed.",
        });
      }

      const totalRepayment =
        Number(
          loan.totalRepayment ||
            loan.amount ||
            0
        );

      const principalRatio =
        loan.amount > 0
          ? Number(loan.amount) /
            totalRepayment
          : 1;

      const principalPortion =
        Math.min(
          Number(
            loan.amount || 0
          ),
          Math.round(
            Number(
              repayment.amount || 0
            ) *
              principalRatio *
              100
          ) / 100
        );

      await User.findByIdAndUpdate(
        loan.user,
        {
          $inc: {
            savingsBalance:
              -repayment.amount,
            loanFundsBalance:
              -principalPortion,
          },
        }
      );

      res.json({
        repayment,
        loan,
      });
    } catch (err) {
      res.status(500).json({
        message: err.message,
      });
    }
  }
);

/*
  ============================
  WITHDRAWALS
  ============================
*/

router.get(
  "/withdrawals",
  async (req, res) => {
    try {
      const filter = req.query.status
        ? {
            status:
              req.query.status,
          }
        : {};

      const withdrawals =
        await Withdrawal.find(
          filter
        )
          .populate(
            "user",
            "fullName email savingsBalance withdrawalReserved"
          )
          .sort("-createdAt");

      res.json(withdrawals);
    } catch (err) {
      res.status(500).json({
        message: err.message,
      });
    }
  }
);

router.post(
  "/withdrawals/:id/sync",
  async (req, res) => {
    try {
      const withdrawal =
        await Withdrawal.findById(
          req.params.id
        );

      if (!withdrawal) {
        return res.status(404).json({
          message:
            "Withdrawal not found",
        });
      }

      if (
        [
          "success",
          "failed",
          "reversed",
          "rejected",
        ].includes(
          withdrawal.status
        )
      ) {
        return res.json(
          withdrawal
        );
      }

      const response =
        await fetch(
          `https://api.paystack.co/transfer/verify/${encodeURIComponent(
            withdrawal.reference
          )}`,
          {
            headers: {
              Authorization:
                `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            },
          }
        );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.status
      ) {
        return res.status(502).json({
          message:
            data.message ||
            "Could not verify the Paystack transfer.",
        });
      }

      const transfer =
        data.data;

      withdrawal.transferCode =
        transfer.transfer_code ||
        withdrawal.transferCode;

      if (
        transfer.status ===
        "success"
      ) {
        await settleWithdrawal(
          withdrawal,
          "success"
        );

        await Notification.create({
          user: withdrawal.user,
          type: "withdrawal",
          title:
            "Withdrawal Successful",
          message:
            `Your withdrawal of ₦${Number(
              withdrawal.amount || 0
            ).toLocaleString()} has been successfully processed.`,
        });
      } else if (
        transfer.status ===
        "failed"
      ) {
        await settleWithdrawal(
          withdrawal,
          "failed",
          transfer.failures ||
            "Paystack marked the transfer as failed."
        );

        await Notification.create({
          user: withdrawal.user,
          type: "withdrawal",
          title:
            "Withdrawal Failed",
          message:
            `Your withdrawal of ₦${Number(
              withdrawal.amount || 0
            ).toLocaleString()} could not be completed.`,
        });
      } else if (
        transfer.status ===
        "reversed"
      ) {
        await settleWithdrawal(
          withdrawal,
          "reversed",
          "Paystack reversed the transfer."
        );

        await Notification.create({
          user: withdrawal.user,
          type: "withdrawal",
          title:
            "Withdrawal Reversed",
          message:
            `Your withdrawal of ₦${Number(
              withdrawal.amount || 0
            ).toLocaleString()} has been reversed.`,
        });
      } else {
        await withdrawal.save();
      }

      res.json(
        withdrawal
      );
    } catch (err) {
      res.status(500).json({
        message: err.message,
      });
    }
  }
);

/*
  ============================
  DIVIDENDS
  ============================
*/

router.get(
  "/dividends",
  async (req, res) => {
    try {
      const distributions =
        await DividendDistribution.find()
          .sort("-createdAt");

      res.json(
        distributions
      );
    } catch (err) {
      res.status(500).json({
        message: err.message,
      });
    }
  }
);

router.post(
  "/dividends",
  async (req, res) => {
    try {
      const {
        financialYear,
        pool,
        distributionDate,
        periodStartDate,
        periodEndDate,
      } = req.body;

      const year =
        Number(financialYear);

      const poolAmount =
        Number(pool);

      if (
        !Number.isFinite(year) ||
        year <= 0
      ) {
        return res.status(400).json({
          message:
            "Enter a valid financial year.",
        });
      }

      if (
        !Number.isFinite(
          poolAmount
        ) ||
        poolAmount <= 0
      ) {
        return res.status(400).json({
          message:
            "Enter a valid dividend pool amount.",
        });
      }

      const startDate =
        periodStartDate
          ? new Date(
              periodStartDate
            )
          : null;

      const endDate =
        periodEndDate
          ? new Date(
              periodEndDate
            )
          : null;

      if (
        startDate &&
        Number.isNaN(
          startDate.getTime()
        )
      ) {
        return res.status(400).json({
          message:
            "Enter a valid dividend period start date.",
        });
      }

      if (
        endDate &&
        Number.isNaN(
          endDate.getTime()
        )
      ) {
        return res.status(400).json({
          message:
            "Enter a valid dividend period end date.",
        });
      }

      if (
        startDate &&
        endDate &&
        startDate > endDate
      ) {
        return res.status(400).json({
          message:
            "Dividend period start date must be before the end date.",
        });
      }

      const distribution =
        await DividendDistribution.create(
          {
            financialYear: year,
            pool: poolAmount,
            distributionDate:
              distributionDate || "",
            periodStartDate:
              startDate,
            periodEndDate:
              endDate,
            calculationBasis:
              "loan-interest-paid",
            status: "draft",
          }
        );

      res.status(201).json(
        distribution
      );
    } catch (err) {
      res.status(500).json({
        message: err.message,
      });
    }
  }
);

router.get(
  "/dividends/:id",
  async (req, res) => {
    try {
      const distribution =
        await DividendDistribution.findById(
          req.params.id
        );

      if (!distribution) {
        return res.status(404).json({
          message:
            "Dividend distribution not found",
        });
      }

      const entries =
        await DividendEntry.find({
          distribution:
            distribution._id,
        })
          .populate(
            "user",
            "fullName email membershipType"
          )
          .sort("-dividendAmount");

      res.json({
        distribution,
        entries,
      });
    } catch (err) {
      res.status(500).json({
        message: err.message,
      });
    }
  }
);

router.post(
  "/dividends/:id/calculate",
  async (req, res) => {
    try {
      const distribution =
        await DividendDistribution.findById(
          req.params.id
        );

      if (!distribution) {
        return res.status(404).json({
          message:
            "Dividend distribution not found",
        });
      }

      if (
        distribution.status ===
        "completed"
      ) {
        return res.status(400).json({
          message:
            "This distribution has already been completed and can't be recalculated.",
        });
      }

      if (
        !distribution.periodStartDate ||
        !distribution.periodEndDate
      ) {
        return res.status(400).json({
          message:
            "Set the dividend calculation period before calculating dividends.",
        });
      }

      const periodEnd =
        new Date(
          distribution.periodEndDate
        );

      periodEnd.setHours(
        23,
        59,
        59,
        999
      );

      const completedLoans =
        await Loan.find({
          status: "completed",
          completedDate: {
            $gte:
              distribution.periodStartDate,
            $lte: periodEnd,
          },
        }).select(
          "user amount totalRepayment interestRate completedDate"
        );

      const eligibleMembers =
        await User.find({
          isApprovedMember: true,
          membershipType:
            "interest-bearing",
        }).select("_id");

      const eligibleIds =
        new Set(
          eligibleMembers.map(
            (member) =>
              String(
                member._id
              )
          )
        );

      const interestByMember =
        new Map();

      for (
        const loan of completedLoans
      ) {
        const userId =
          String(loan.user);

        if (
          !eligibleIds.has(
            userId
          )
        ) {
          continue;
        }

        const interestPaid =
          Math.max(
            0,
            Number(
              loan.totalRepayment ||
                0
            ) -
              Number(
                loan.amount || 0
              )
          );

        interestByMember.set(
          userId,
          (
            interestByMember.get(
              userId
            ) || 0
          ) + interestPaid
        );
      }

      const qualifyingMembers =
        Array.from(
          interestByMember.entries()
        )
          .filter(
            ([, interest]) =>
              interest > 0
          )
          .map(
            ([
              user,
              qualifyingInterest,
            ]) => ({
              user,
              qualifyingInterest,
            })
          );

      const totalEligibleInterest =
        qualifyingMembers.reduce(
          (
            sum,
            member
          ) =>
            sum +
            member.qualifyingInterest,
          0
        );

      await DividendEntry.deleteMany(
        {
          distribution:
            distribution._id,
        }
      );

      if (
        totalEligibleInterest > 0
      ) {
        const entries =
          qualifyingMembers.map(
            ({
              user,
              qualifyingInterest,
            }) => ({
              distribution:
                distribution._id,

              user,

              contribution:
                qualifyingInterest,

              qualifyingInterest,

              dividendAmount:
                Math.round(
                  (
                    qualifyingInterest /
                    totalEligibleInterest
                  ) *
                    distribution.pool
                ),

              status: "pending",
            })
          );

        await DividendEntry.insertMany(
          entries
        );
      }

      distribution.totalEligibleInterest =
        totalEligibleInterest;

      distribution.status =
        "calculated";

      distribution.calculatedDate =
        new Date();

      await distribution.save();

      res.json(
        distribution
      );
    } catch (err) {
      res.status(500).json({
        message: err.message,
      });
    }
  }
);

router.patch(
  "/dividends/:id/entries/:entryId",
  async (req, res) => {
    try {
      const entry =
        await DividendEntry.findOne({
          _id:
            req.params.entryId,
          distribution:
            req.params.id,
        });

      if (!entry) {
        return res.status(404).json({
          message:
            "Dividend entry not found",
        });
      }

      entry.status = "paid";
      entry.paidDate =
        new Date();

      await entry.save();

      await Notification.create({
        user: entry.user,
        type: "dividend",
        title: "Dividend Paid",
        message:
          `Your dividend of ₦${Number(
            entry.dividendAmount || 0
          ).toLocaleString()} has been paid.`,
      });

      const remainingPending =
        await DividendEntry.countDocuments(
          {
            distribution:
              req.params.id,
            status: "pending",
          }
        );

      if (
        remainingPending === 0
      ) {
        await DividendDistribution.findByIdAndUpdate(
          req.params.id,
          {
            status: "completed",
          }
        );
      }

      const populated =
        await DividendEntry.findById(
          entry._id
        ).populate(
          "user",
          "fullName email membershipType"
        );

      res.json(
        populated
      );
    } catch (err) {
      res.status(500).json({
        message: err.message,
      });
    }
  }
);

router.patch(
  "/dividends/:id/pay-all",
  async (req, res) => {
    try {
      const distribution =
        await DividendDistribution.findById(
          req.params.id
        );

      if (!distribution) {
        return res.status(404).json({
          message:
            "Dividend distribution not found",
        });
      }

      const pendingEntries =
        await DividendEntry.find({
          distribution:
            distribution._id,
          status: "pending",
        });

      const paidDate =
        new Date();

      await DividendEntry.updateMany(
        {
          distribution:
            distribution._id,
          status: "pending",
        },
        {
          status: "paid",
          paidDate,
        }
      );

      await Promise.all(
        pendingEntries.map(
          (entry) =>
            Notification.create({
              user: entry.user,
              type: "dividend",
              title: "Dividend Paid",
              message:
                `Your dividend of ₦${Number(
                  entry.dividendAmount ||
                    0
                ).toLocaleString()} has been paid.`,
            })
        )
      );

      distribution.status =
        "completed";

      await distribution.save();

      const entries =
        await DividendEntry.find({
          distribution:
            distribution._id,
        })
          .populate(
            "user",
            "fullName email membershipType"
          )
          .sort("-dividendAmount");

      res.json({
        distribution,
        entries,
      });
    } catch (err) {
      res.status(500).json({
        message: err.message,
      });
    }
  }
);

export default router;