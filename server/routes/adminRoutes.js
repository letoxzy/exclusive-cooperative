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
import CooperativeSetting from "../models/CooperativeSetting.js";
import {
  DividendDistribution,
  DividendEntry,
} from "../models/Dividend.js";

import { protect } from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/adminMiddleware.js";
import { settleWithdrawal } from "../utils/withdrawalSettlement.js";
import { uploadBufferToCloudinary } from "../utils/cloudinaryUpload.js";
import { createNotificationAndPush } from "../utils/createNotification.js";
import { runAtomic } from "../utils/atomic.js";
import { audit } from "../utils/audit.js";
import { toKobo, fromKobo, splitProportional } from "../utils/money.js";
import JournalEntry from "../models/JournalEntry.js";
import AuditLog from "../models/AuditLog.js";
import {
  postSavingsDeposit,
  postLoanDisbursement,
  postLoanRepayment,
  postDividendPayout,
  trialBalance,
} from "../services/ledger.js";
import { resetAccountSecurityLock } from "../utils/accountSecurity.js";
import { LOCKED_SAVINGS_PERCENTAGE, WITHDRAWABLE_PERCENTAGE } from "../utils/contributionRules.js";
import {
  compareIdentity,
  getVerificationDetails,
  isSandbox,
  maskValue,
  parseVerification,
} from "../services/dojahService.js";

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
  COOPERATIVE CONFIGURATION
  ============================
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

// GET /api/admin/cooperative-settings
router.get("/cooperative-settings", async (req, res) => {
  try {
    const settings = await getCooperativeSettings();
    res.json(settings);
  } catch (err) {
    console.error("Load cooperative settings error:", err);
    res.status(500).json({
      message: "Failed to load cooperative settings.",
    });
  }
});

// PUT /api/admin/cooperative-settings
router.put("/cooperative-settings", async (req, res) => {
  try {
    const {
      loanMultiplier,
      repaymentAccountName,
      repaymentBank,
      repaymentAccountNumber,
    } = req.body;

    const multiplier = Number(loanMultiplier);

    if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 2) {
      return res.status(400).json({
        message: "Loan eligibility multiplier must be greater than 0 and cannot exceed 2×.",
      });
    }

    const accountName = String(repaymentAccountName || "").trim();
    const bank = String(repaymentBank || "").trim();
    const accountNumber = String(repaymentAccountNumber || "").trim();

    if (!accountName || !bank || !accountNumber) {
      return res.status(400).json({
        message: "Repayment account name, bank and account number are required.",
      });
    }

    if (!/^[0-9]{10}$/.test(accountNumber)) {
      return res.status(400).json({
        message: "Repayment account number must be exactly 10 digits.",
      });
    }

    const settings = await CooperativeSetting.findOneAndUpdate(
      {},
      {
        $set: {
          loanMultiplier: Math.round(multiplier * 100) / 100,
          repaymentAccountName: accountName,
          repaymentBank: bank,
          repaymentAccountNumber: accountNumber,
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      },
    );

    res.json(settings);
  } catch (err) {
    console.error("Save cooperative settings error:", err);
    res.status(500).json({
      message: "Failed to save cooperative settings.",
    });
  }
});


/*
  ============================
  USERS
  ============================
*/

// GET /api/admin/users
router.get("/users", async (req, res) => {
  try {
    const users = await User.find()
      .select(
        "fullName email role membershipType savingsBalance contributionFrequency shareholding withdrawalReserved avatarUrl isApprovedMember isLoanEligible mustChangePassword isBlocked blockedAt blockedBy blockReason biometricEnabled autoLockSeconds securityFailedAttempts securityLockLevel securityLockedUntil securityLockedPermanently securityLockedAt securityLockReason createdAt updatedAt"
      )
      .sort("-createdAt")
      .lean();

    // Phone numbers are stored on the Membership document rather than User.
    // Merge the phone into the admin member list so the frontend can search it.
    const userIds = users.map((member) => member._id);

    const memberships = userIds.length
      ? await Membership.find({ user: { $in: userIds } })
          .select("user phone")
          .lean()
      : [];

    const phoneByUserId = new Map(
      memberships.map((membership) => [
        String(membership.user),
        membership.phone || "",
      ])
    );

    const membersWithPhone = users.map((member) => ({
      ...member,
      phone: phoneByUserId.get(String(member._id)) || "",
    }));

    res.json(membersWithPhone);
  } catch (err) {
    console.error("Admin users fetch error:", err);

    res.status(500).json({
      message: "Failed to load members.",
    });
  }
});

/*
  ============================
  BLOCK / UNBLOCK MEMBER ACCOUNT
  ============================
*/

router.patch("/users/:id/block", async (req, res) => {
  try {
    const member = await User.findById(req.params.id);
    if (!member) return res.status(404).json({ message: "Member account not found." });
    if (member.role === "admin") return res.status(403).json({ message: "Administrator accounts cannot be blocked here." });

    const blocked = req.body?.blocked !== false;
    const reason = String(req.body?.reason || "Security review by administrator").trim();

    member.isBlocked = blocked;
    member.blockedAt = blocked ? new Date() : null;
    member.blockedBy = blocked ? req.user._id : null;
    member.blockReason = blocked ? reason : null;
    await member.save();

    const notificationTitle = blocked ? "Account Blocked" : "Account Unblocked";
    const notificationMessage = blocked
      ? `Your account has been blocked by an administrator.${reason ? ` Reason: ${reason}` : ""} Please contact the cooperative for assistance.`
      : "Your account has been unblocked by an administrator. You can sign in again.";

    try {
      await createNotificationAndPush({
        user: member._id,
        type: "security",
        title: notificationTitle,
        message: notificationMessage,
      });
    } catch (notificationError) {
      console.error("Account status notification failed:", notificationError);
    }

    return res.json({
      _id: member._id,
      fullName: member.fullName,
      email: member.email,
      isBlocked: member.isBlocked,
      blockedAt: member.blockedAt,
      blockReason: member.blockReason,
    });
  } catch (err) {
    console.error("Block/unblock member error:", err);
    return res.status(500).json({ message: "Failed to update account status." });
  }
});

// GET /api/admin/security-alerts
router.get("/security-alerts", async (req, res) => {
  try {
    const alerts = await Notification.find({
      user: req.user._id,
      type: "security",
    }).sort("-createdAt").limit(50);
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ message: "Failed to load security alerts." });
  }
});

/*
  ============================
  SECURITY LOCK / UNLOCK
  ============================
*/

// PATCH /api/admin/users/:id/security-unlock
// Clears an automatic permanent security lock and resets the account's
// authentication escalation. This does not change the separate manual
// isBlocked status.
router.patch("/users/:id/security-unlock", async (req, res) => {
  try {
    const member = await User.findById(req.params.id);

    if (!member) {
      return res.status(404).json({ message: "Member account not found." });
    }

    if (member.role === "admin") {
      return res.status(403).json({
        message: "Administrator security accounts cannot be unlocked here.",
      });
    }

    if (!member.securityLockedPermanently) {
      return res.status(400).json({
        message: "This account does not have a permanent security lock.",
      });
    }

    await resetAccountSecurityLock(member);

    try {
      await createNotificationAndPush({
        user: member._id,
        type: "security",
        title: "Account Unlocked",
        message: "An administrator has unlocked your account. You can now sign in again. If you forgot your password, you can use Forgot Password.",
      });
    } catch (notificationError) {
      console.error("Security unlock notification failed:", notificationError);
    }

    return res.json({
      _id: member._id,
      fullName: member.fullName,
      email: member.email,
      isBlocked: member.isBlocked,
      securityLockedPermanently: member.securityLockedPermanently,
      securityLockLevel: member.securityLockLevel,
      securityLockedAt: member.securityLockedAt,
    });
  } catch (err) {
    console.error("Security unlock error:", err);
    return res.status(500).json({
      message: "Failed to unlock account security.",
    });
  }
});

/*
  ============================
  DELETE MEMBER ACCOUNT
  ============================
*/

// PATCH /api/admin/users/:id/shareholding
// Updates a member's total cooperative shareholding value.
router.patch("/users/:id/shareholding", async (req, res) => {
  try {
    const { shareholding } = req.body;
    const value = Number(shareholding);

    if (!Number.isFinite(value) || value < 0) {
      return res.status(400).json({
        message: "Shareholding must be a valid amount of 0 or more.",
      });
    }

    const member = await User.findById(req.params.id).select("-password");

    if (!member) {
      return res.status(404).json({
        message: "Member account not found.",
      });
    }

    if (member.role === "admin") {
      return res.status(403).json({
        message: "Administrator shareholding cannot be edited here.",
      });
    }

    const previousShareholding = Number(member.shareholding || 0);

    member.shareholding = value;
    await member.save();

    // Notify the member whenever an administrator changes the recorded
    // shareholding value. Notification failure should not undo the saved
    // shareholding update.
    try {
      await createNotificationAndPush({
        user: member._id,
        type: "shareholding",
        title: "Shareholding Updated",
        message:
          `Your cooperative shareholding has been updated from ₦${previousShareholding.toLocaleString()} ` +
          `to ₦${value.toLocaleString()}.`,
      });
    } catch (notificationError) {
      console.error(
        "Shareholding updated but member notification failed:",
        notificationError,
      );
    }

    return res.json(member);
  } catch (err) {
    console.error("Update member shareholding error:", err);

    return res.status(500).json({
      message: "Failed to update member shareholding.",
    });
  }
});

// DELETE /api/admin/users/:id
// Removes a member login account and its linked membership record.
// Admin accounts are protected. Financial transaction history is preserved.
router.delete("/users/:id", async (req, res) => {
  try {
    const member = await User.findById(req.params.id);

    if (!member) {
      return res.status(404).json({
        message: "Member account not found.",
      });
    }

    if (member.role === "admin") {
      return res.status(403).json({
        message: "Administrator accounts cannot be deleted here.",
      });
    }

    await Membership.deleteMany({
      user: member._id,
    });

    await Notification.deleteMany({
      user: member._id,
    });

    await User.findByIdAndDelete(member._id);

    return res.json({
      message: "Member account and membership record deleted successfully.",
      deletedUserId: member._id,
    });
  } catch (err) {
    console.error("Delete member account error:", err);

    return res.status(500).json({
      message: "Failed to delete member account.",
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

        await createNotificationAndPush({
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
        message: "Failed to create existing member account.",
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
    console.error("List savings requests error:", err);
    res.status(500).json({
      message: "Could not load savings requests.",
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
        const user = await User.findById(txn.user).select("_id");

        if (!user) {
          return res.status(404).json({
            message: "Member not found",
          });
        }

        const amount = Number(txn.amount || 0);
        const lockedAmount = Math.round(
          Number(
            txn.lockedAmount || amount * LOCKED_SAVINGS_PERCENTAGE
          ) * 100
        ) / 100;
        const withdrawalAmount = Math.round(
          Number(
            txn.withdrawalAmount || amount * WITHDRAWABLE_PERCENTAGE
          ) * 100
        ) / 100;

        // Atomically flip pending -> approved first, guarded on the current
        // status, so a double-click or two admins acting on the same
        // request at once can't both pass the earlier check and credit
        // the member twice.
        // Status flip, balance credit and ledger entry commit together or
        // not at all (a crash between them used to approve a request
        // without ever crediting the member).
        const approvedTxn = await runAtomic(async (session) => {
          const opts = session ? { session } : {};
          const flipped = await SavingsTransaction.findOneAndUpdate(
            { _id: txn._id, status: "pending" },
            { $set: { status: "approved", lockedAmount, withdrawalAmount } },
            { new: true, ...opts }
          );
          if (!flipped) return null;

          // Savings Balance is the member's full accumulated contributions
          // (see withdrawalSettlement.js). Atomic $inc, never read-modify-write.
          await User.findByIdAndUpdate(
            txn.user,
            { $inc: { savingsBalance: amount } },
            opts
          );

          await postSavingsDeposit(
            {
              userId: txn.user,
              amount,
              reference: String(txn._id),
              method: txn.method || "manual",
              postedBy: req.user._id,
            },
            { session }
          );
          return flipped;
        });

        if (!approvedTxn) {
          return res.status(409).json({
            message: "This request has already been handled.",
          });
        }

        txn.status = approvedTxn.status;
        txn.lockedAmount = approvedTxn.lockedAmount;
        txn.withdrawalAmount = approvedTxn.withdrawalAmount;
        await audit(req, "savings.approve", "SavingsTransaction", txn._id, { amount });
      } else if (action === "reject") {
        const rejectedTxn = await SavingsTransaction.findOneAndUpdate(
          { _id: txn._id, status: "pending" },
          { $set: { status: "rejected" } },
          { new: true }
        );

        if (!rejectedTxn) {
          return res.status(409).json({
            message: "This request has already been handled.",
          });
        }

        txn.status = rejectedTxn.status;
      } else {
        return res.status(400).json({
          message: "Invalid action",
        });
      }

      const savingsNotification =
        action === "approve"
          ? {
              title: "Savings Payment Approved",
              message: `Your contribution of ₦${Number(
                txn.amount || 0
              ).toLocaleString()} has been approved and added to your savings balance. ₦${Number(
                txn.withdrawalAmount || 0
              ).toLocaleString()} of it (40%) is available to withdraw this month.`,
            }
          : {
              title: "Savings Payment Rejected",
              message: `Your savings payment of ₦${Number(
                txn.amount || 0
              ).toLocaleString()} was rejected.`,
            };

      await createNotificationAndPush({
        user: txn.user,
        type: "savings",
        ...savingsNotification,
      });

      res.json(txn);
    } catch (err) {
      console.error("Savings request approval error:", err);
      res.status(500).json({
        message: "Could not process this savings request.",
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
    console.error("List membership applications error:", err);
    res.status(500).json({
      message: "Could not load membership applications.",
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
          userUpdates.contributionFrequency =
            app.frequency ||
            "Monthly";
        }

        await User.findByIdAndUpdate(
          app.user,
          userUpdates
        );

        if (updates.status === "approved") {
          await createNotificationAndPush({
            user: app.user,
            type: "membership",
            title: "Membership Approved",
            message:
              "Your membership application has been approved. Welcome to Exclusive Cooperative.",
          });
        }

        if (updates.status === "rejected") {
          await createNotificationAndPush({
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
      console.error("Process membership application error:", err);
      res.status(500).json({
        message: "Could not process this membership application.",
      });
    }
  }
);

/*
  ============================
  LOAN ELIGIBILITY APPLICATIONS
  (Full Loan Application: identity verification review)
  ============================
*/

// GET /api/admin/loan-eligibility-applications?status=pending
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
          .populate("reviewedBy", "fullName")
          .sort("-createdAt");

      res.json(applications);
    } catch (err) {
      console.error("List loan eligibility applications error:", err);
      res.status(500).json({
        message: "Could not load loan eligibility applications.",
      });
    }
  }
);

// GET /api/admin/loan-eligibility-applications/:id/verification
// Everything the administrator needs to compare: the member's cooperative
// record next to what Dojah returned (BVN record, ID document, live selfie).
// Photos are fetched live from Dojah and are never stored in MongoDB.
router.get(
  "/loan-eligibility-applications/:id/verification",
  async (req, res) => {
    try {
      const application = await LoanEligibility.findById(req.params.id)
        .populate("user", "fullName email savingsBalance")
        .populate("reviewedBy", "fullName");

      if (!application) {
        return res.status(404).json({
          message: "Loan eligibility application not found",
        });
      }

      const membership = application.user?._id
        ? await Membership.findOne({
            user: application.user._id,
            status: "approved",
          })
        : null;

      const details =
        typeof application.applicantDetails?.toObject === "function"
          ? application.applicantDetails.toObject()
          : { ...(application.applicantDetails || {}) };

      const member = {
        ...details,
        passportPhotoUrl: membership?.passportPhotoUrl || "",
        membershipType: membership?.membershipType || "",
        savingsBalance: application.user?.savingsBalance || 0,
      };

      let live = null;
      let liveError = "";

      if (application.verificationReference) {
        try {
          const raw = await getVerificationDetails(
            application.verificationReference
          );
          live = parseVerification(raw);
        } catch (err) {
          liveError =
            err.providerData?.message ||
            err.providerData?.error ||
            err.message ||
            "Dojah could not be reached.";
        }
      }

      const snapshot = application.verificationSnapshot
        ? application.verificationSnapshot.toObject()
        : null;

      // Prefer a fresh comparison from live Dojah data; fall back to the
      // comparison saved at submission time.
      const comparison = live
        ? compareIdentity(live, member)
        : snapshot?.comparison || null;

      res.json({
        application: {
          _id: application._id,
          status: application.status,
          providerVerificationStatus: application.providerVerificationStatus,
          bvnVerificationStatus: application.bvnVerificationStatus,
          identityMatchStatus: application.identityMatchStatus,
          faceVerificationStatus: application.faceVerificationStatus,
          verificationReference: application.verificationReference,
          bvnLast4: application.bvnLast4,
          submittedDate: application.submittedDate,
          reviewedDate: application.reviewedDate,
          reviewedBy: application.reviewedBy?.fullName || "",
          rejectionReason: application.rejectionReason,
          approvedWithMismatch: application.approvedWithMismatch,
          user: {
            fullName: application.user?.fullName || "",
            email: application.user?.email || "",
          },
        },
        member,
        snapshot,
        comparison,
        sandbox: isSandbox(),
        liveError,
        live: live
          ? {
              status: live.status,
              bvn: {
                passed: live.bvn.passed,
                fullName: live.bvn.fullName,
                dob: live.bvn.dob,
                gender: live.bvn.gender,
                phone: live.bvn.phone,
                photo: live.bvn.photo,
              },
              id: {
                passed: live.id.passed,
                fullName: live.id.fullName,
                documentType: live.id.documentType,
                documentNumber: maskValue(live.id.documentNumber),
                url: live.id.url,
                backUrl: live.id.backUrl,
              },
              selfie: live.selfie,
              location: live.location,
              reportUrl: live.reportUrl,
              dashboardUrl: live.dashboardUrl,
            }
          : null,
      });
    } catch (err) {
      console.error("Load KYC verification error:", err);
      res.status(500).json({
        message: "Could not load KYC verification details.",
      });
    }
  }
);

// PATCH /api/admin/loan-eligibility-applications/:id
// { action: "approve" | "reject", rejectionReason?, confirmMismatch? }
router.patch(
  "/loan-eligibility-applications/:id",
  async (req, res) => {
    try {
      const {
        action,
        rejectionReason,
        confirmMismatch,
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

      if (application.status === "draft") {
        return res.status(400).json({
          message:
            "The member has not finished identity verification yet.",
        });
      }

      if (application.status !== "pending") {
        return res.status(400).json({
          message:
            "This application has already been reviewed",
        });
      }

      if (action === "reject") {
        const reason = String(rejectionReason || "").trim();

        if (reason.length < 3) {
          return res.status(400).json({
            message:
              "Please give the member a reason for the rejection.",
          });
        }

        application.status = "rejected";
        application.rejectionReason = reason;
        application.reviewedDate = new Date();
        application.reviewedBy = req.user._id;

        await application.save();

        await createNotificationAndPush({
          user: application.user,
          type: "loan-eligibility",
          title:
            "Full Loan Application Update",
          message: `Your Full Loan Application was not approved. Reason: ${application.rejectionReason}`,
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
        // Hard requirements: these come from Dojah and cannot be overridden.
        if (application.providerVerificationStatus !== "completed") {
          return res.status(400).json({
            message: "This application cannot be approved until the member's identity verification has been completed.",
          });
        }

        if (application.bvnVerificationStatus !== "verified") {
          return res.status(400).json({
            message: "This application cannot be approved until the member's BVN has been successfully verified.",
          });
        }

        if (application.faceVerificationStatus !== "verified") {
          return res.status(400).json({
            message: "This application cannot be approved until the member's liveness verification has been successfully completed.",
          });
        }

        // Soft requirement: if the automatic comparison flagged a difference
        // (or the same BVN appears on another account) the administrator must
        // explicitly confirm they reviewed it.
        const mismatch = application.identityMatchStatus !== "matched";
        const duplicateBvn = Boolean(
          application.verificationSnapshot?.duplicateBvn
        );

        if ((mismatch || duplicateBvn) && confirmMismatch !== true) {
          return res.status(409).json({
            code: "CONFIRMATION_REQUIRED",
            message:
              "The member's details do not fully match the verified identity. Review the comparison and confirm to approve anyway.",
          });
        }

        application.status = "approved";
        application.reviewedDate = new Date();
        application.reviewedBy = req.user._id;
        application.approvedWithMismatch = mismatch || duplicateBvn;

        await application.save();

        await User.findByIdAndUpdate(
          application.user,
          {
            isLoanEligible: true,
          }
        );

        await createNotificationAndPush({
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
      console.error("Process loan eligibility application error:", err);
      res.status(500).json({
        message: "Could not process this loan eligibility application.",
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
    console.error("List loans error:", err);
    res.status(500).json({
      message: "Could not load loans.",
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
      console.error("Load loan error:", err);
      res.status(500).json({
        message: "Could not load this loan.",
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

        await createNotificationAndPush({
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
        // Debt starts only when the approved loan is actually disbursed.
        loan.outstandingBalance = 0;
        loan.repaymentSchedule =
          schedule;

        await loan.save();

        await createNotificationAndPush({
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
      console.error("Process loan error:", err);
      res.status(500).json({
        message: "Could not process this loan.",
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

      const member = await User.findById(loan.user);

      if (!member) {
        return res.status(404).json({
          message: "Member associated with this loan was not found.",
        });
      }

      if (!member.isApprovedMember) {
        return res.status(400).json({
          message: "This member is no longer an approved cooperative member.",
        });
      }

      // Re-check eligibility at the moment of disbursement. This protects
      // the cooperative if the member's savings changed after approval.
      const currentSavings = Number(member.savingsBalance || 0);
      const currentEligibility = currentSavings * 2;

      if (loan.amount > currentEligibility) {
        return res.status(400).json({
          message:
            `This loan can no longer be disbursed because the requested amount of ₦${Number(
              loan.amount || 0
            ).toLocaleString()} exceeds the member's current eligibility of ₦${currentEligibility.toLocaleString()}.`,
        });
      }

      // Claim approved -> active atomically so two admins (or a double
      // click) can't both disburse, and post the ledger entry in the same
      // transaction.
      const claimed = await runAtomic(async (session) => {
        const opts = session ? { session } : {};
        const doc = await Loan.findOneAndUpdate(
          { _id: loan._id, status: "approved" },
          {
            $set: {
              status: "active",
              disbursedDate: new Date(),
              amountPaid: 0,
              outstandingBalance: loan.totalRepayment,
              // Loan proceeds are NOT savings: savingsBalance is untouched.
              // These counters track how much the member has taken out.
              loanFundsWithdrawn: 0,
              loanFundsReserved: 0,
            },
          },
          { new: true, ...opts }
        );
        if (!doc) return null;
        await postLoanDisbursement({ loan: doc, postedBy: req.user._id }, { session });
        return doc;
      });

      if (!claimed) {
        return res.status(409).json({
          message: "This loan has already been disbursed.",
        });
      }

      loan.status = claimed.status;
      loan.disbursedDate = claimed.disbursedDate;
      loan.amountPaid = 0;
      loan.outstandingBalance = claimed.outstandingBalance;
      loan.loanFundsWithdrawn = 0;
      loan.loanFundsReserved = 0;
      await audit(req, "loan.disburse", "Loan", loan._id, { amount: loan.amount });

      // Loan proceeds are NOT savings. Keep the member's savings balance
      // untouched; Loan.amount/outstandingBalance track the debt, while
      // loanFundsWithdrawn/loanFundsReserved track how much of the loan
      // has actually been taken out by the member.

      await createNotificationAndPush({
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
      console.error("Disburse loan error:", err);
      res.status(500).json({
        message: "Could not disburse this loan.",
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
      console.error("List loan repayments error:", err);
      res.status(500).json({
        message: "Could not load loan repayments.",
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

        await createNotificationAndPush({
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

      if (!(await Loan.exists({ _id: repayment.loan }))) {
        return res.status(404).json({
          message: "Loan not found",
        });
      }

      // Claim pending -> approved, apply it to the loan and post the ledger
      // entry in ONE transaction. Only the request that wins the claim
      // applies the money, so a double-click or two admins can't apply the
      // same repayment twice.
      const outcome = await runAtomic(async (session) => {
        const opts = session ? { session } : {};
        const flipped = await LoanRepayment.findOneAndUpdate(
          { _id: repayment._id, status: "pending" },
          { $set: { status: "approved" } },
          { new: true, ...opts }
        );
        if (!flipped) return { conflict: true };

        const loan = await Loan.findById(repayment.loan, null, opts);

        let remaining = repayment.amount;
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
        // Round to kobo so float drift can't leave a stray 0.0000001 that
        // stops the loan from ever reaching exactly zero.
        loan.outstandingBalance = Math.max(
          0,
          Math.round((loan.outstandingBalance - repayment.amount) * 100) / 100
        );

        if (loan.outstandingBalance === 0) {
          loan.status = "completed";
          loan.completedDate = new Date();
        }

        await loan.save(opts);
        await postLoanRepayment(
          { loan, repayment: flipped, postedBy: req.user._id },
          { session }
        );
        return { loan };
      });

      if (outcome.conflict) {
        return res.status(409).json({
          message: "This request has already been handled",
        });
      }

      const loan = outcome.loan;
      repayment.status = "approved";
      await audit(req, "loan-repayment.approve", "LoanRepayment", repayment._id, {
        amount: repayment.amount,
        loan: String(loan._id),
      });

      await createNotificationAndPush({
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
        await createNotificationAndPush({
          user: loan.user,
          type: "loan",
          title:
            "Loan Completed",
          message:
            "Your loan has been fully repaid and marked as completed.",
        });
      }

      // Repayment is a loan ledger transaction. It must NOT reduce the
      // member's savings balance unless a future, explicitly supported
      // savings-to-loan transfer is performed.

      res.json({
        repayment,
        loan,
      });
    } catch (err) {
      console.error("Process loan repayment error:", err);
      res.status(500).json({
        message: "Could not process this loan repayment.",
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
      console.error("List withdrawals error:", err);
      res.status(500).json({
        message: "Could not load withdrawals.",
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

        await createNotificationAndPush({
          user: withdrawal.user,
          type: "withdrawal",
          title:
            "Withdrawal Successful",
          message:
            `Your withdrawal of ₦${Number(
              withdrawal.amount || 0
            ).toLocaleString()} has been successfully processed.`,
          data: {
            withdrawalId: withdrawal._id.toString(),
            reference: withdrawal.reference,
            source: withdrawal.source,
            status: withdrawal.status,
          },
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

        await createNotificationAndPush({
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

        await createNotificationAndPush({
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
      console.error("Sync withdrawal error:", err);
      res.status(500).json({
        message: "Could not sync this withdrawal with Paystack.",
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
          .sort("-createdAt")
          .lean();

      // Paid totals per distribution (the Reports tab reads paidAmount).
      const paidRows = await DividendEntry.aggregate([
        { $match: { status: "paid" } },
        {
          $group: {
            _id: "$distribution",
            paidAmount: { $sum: "$dividendAmount" },
            paidCount: { $sum: 1 },
          },
        },
      ]);
      const paidById = new Map(paidRows.map((r) => [String(r._id), r]));

      res.json(
        distributions.map((d) => ({
          ...d,
          paidAmount: paidById.get(String(d._id))?.paidAmount || 0,
          paidCount: paidById.get(String(d._id))?.paidCount || 0,
        }))
      );
    } catch (err) {
      console.error("List dividends error:", err);
      res.status(500).json({
        message: "Could not load dividend distributions.",
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
      console.error("Create dividend distribution error:", err);
      res.status(500).json({
        message: "Could not create this dividend distribution.",
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
      console.error("Load dividend distribution error:", err);
      res.status(500).json({
        message: "Could not load this dividend distribution.",
      });
    }
  }
);

/*
  Pays ONE dividend entry: claims pending -> paid and posts the ledger entry in
  a single transaction. Only the caller that wins the claim pays, so repeated
  clicks, concurrent pay-all runs, or a retry can never pay a member twice.
  Returns the paid entry, or null if it was not pending.
*/
async function payDividendEntry(entryId, distributionId, postedBy) {
  return runAtomic(async (session) => {
    const opts = session ? { session } : {};
    const entry = await DividendEntry.findOneAndUpdate(
      { _id: entryId, distribution: distributionId, status: "pending" },
      { $set: { status: "paid", paidDate: new Date() } },
      { new: true, ...opts }
    );
    if (!entry) return null;
    await postDividendPayout({ entry, postedBy }, { session });
    return entry;
  });
}

async function completeDistributionIfDone(distributionId) {
  const stillPending = await DividendEntry.countDocuments({
    distribution: distributionId,
    status: "pending",
  });
  if (stillPending === 0) {
    await DividendDistribution.findOneAndUpdate(
      { _id: distributionId, status: "calculated" },
      { status: "completed" }
    );
  }
}

router.post("/dividends/:id/calculate", async (req, res) => {
  try {
    const distribution = await DividendDistribution.findById(req.params.id);

    if (!distribution) {
      return res.status(404).json({ message: "Dividend distribution not found" });
    }

    if (distribution.status === "completed") {
      return res.status(400).json({
        message:
          "This distribution has already been completed and can't be recalculated.",
      });
    }

    if (!distribution.periodStartDate || !distribution.periodEndDate) {
      return res.status(400).json({
        message:
          "Set the dividend calculation period before calculating dividends.",
      });
    }

    // Recalculating used to delete every entry, including ones already paid,
    // and then create fresh "pending" ones - paying those members again.
    const alreadyPaid = await DividendEntry.countDocuments({
      distribution: distribution._id,
      status: "paid",
    });
    if (alreadyPaid > 0) {
      return res.status(400).json({
        message:
          "Some dividends in this distribution have already been paid, so it can no longer be recalculated.",
      });
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
    const eligibleIds = new Set(eligibleMembers.map((m) => String(m._id)));

    // Interest = totalRepayment - principal. Overdue charges are tracked
    // separately (overdueChargeTotal), so penalties are not counted here.
    const interestByMember = new Map();
    for (const loan of completedLoans) {
      const userId = String(loan.user);
      if (!eligibleIds.has(userId)) continue;
      const interestPaid = Math.max(
        0,
        Number(loan.totalRepayment || 0) - Number(loan.amount || 0)
      );
      interestByMember.set(userId, (interestByMember.get(userId) || 0) + interestPaid);
    }

    const qualifyingMembers = Array.from(interestByMember.entries())
      .filter(([, interest]) => interest > 0)
      .map(([user, qualifyingInterest]) => ({ user, qualifyingInterest }));

    const totalEligibleInterest = qualifyingMembers.reduce(
      (sum, m) => sum + m.qualifyingInterest,
      0
    );

    // Largest-remainder split in kobo: the entries add up to exactly the
    // pool (independent rounding used to drift by a few naira).
    const shares = splitProportional(
      toKobo(distribution.pool),
      qualifyingMembers.map((m) => m.qualifyingInterest)
    );

    await runAtomic(async (session) => {
      const opts = session ? { session } : {};
      await DividendEntry.deleteMany(
        { distribution: distribution._id, status: "pending" },
        opts
      );

      if (totalEligibleInterest > 0) {
        await DividendEntry.insertMany(
          qualifyingMembers.map(({ user, qualifyingInterest }, i) => ({
            distribution: distribution._id,
            user,
            contribution: qualifyingInterest,
            qualifyingInterest,
            dividendAmount: fromKobo(shares[i]),
            status: "pending",
          })),
          opts
        );
      }

      distribution.totalEligibleInterest = totalEligibleInterest;
      distribution.status = "calculated";
      distribution.calculatedDate = new Date();
      await distribution.save(opts);
    });

    await audit(req, "dividend.calculate", "DividendDistribution", distribution._id, {
      pool: distribution.pool,
      members: qualifyingMembers.length,
    });

    res.json(distribution);
  } catch (err) {
    console.error("Calculate dividend distribution error:", err);
    res.status(500).json({
      message: "Could not calculate this dividend distribution.",
    });
  }
});

router.patch("/dividends/:id/entries/:entryId", async (req, res) => {
  try {
    const distribution = await DividendDistribution.findById(req.params.id);

    if (!distribution) {
      return res.status(404).json({ message: "Dividend distribution not found" });
    }

    if (distribution.status !== "calculated") {
      return res.status(400).json({
        message:
          "Dividends can only be paid after the distribution is calculated, and not once it is completed.",
      });
    }

    const paid = await payDividendEntry(
      req.params.entryId,
      distribution._id,
      req.user._id
    );

    if (!paid) {
      const exists = await DividendEntry.exists({
        _id: req.params.entryId,
        distribution: distribution._id,
      });
      return res.status(exists ? 409 : 404).json({
        message: exists
          ? "This dividend has already been paid."
          : "Dividend entry not found",
      });
    }

    try {
      await createNotificationAndPush({
        user: paid.user,
        type: "dividend",
        title: "Dividend Paid",
        message: `Your dividend of ₦${Number(paid.dividendAmount || 0).toLocaleString()} has been paid.`,
      });
    } catch (err) {
      console.error("Dividend notification error:", err.message);
    }

    await completeDistributionIfDone(distribution._id);
    await audit(req, "dividend.pay-entry", "DividendEntry", paid._id, {
      amount: paid.dividendAmount,
    });

    const populated = await DividendEntry.findById(paid._id).populate(
      "user",
      "fullName email membershipType"
    );
    res.json(populated);
  } catch (err) {
    console.error("Update dividend entry error:", err);
    res.status(500).json({ message: "Could not update this dividend entry." });
  }
});

router.patch("/dividends/:id/pay-all", async (req, res) => {
  try {
    const distribution = await DividendDistribution.findById(req.params.id);

    if (!distribution) {
      return res.status(404).json({ message: "Dividend distribution not found" });
    }

    if (distribution.status !== "calculated") {
      return res.status(400).json({
        message:
          "Dividends can only be paid after the distribution is calculated, and not once it is completed.",
      });
    }

    const pendingEntries = await DividendEntry.find({
      distribution: distribution._id,
      status: "pending",
    }).select("_id");

    if (pendingEntries.length === 0) {
      return res.status(400).json({ message: "There are no pending dividends to pay." });
    }

    // Each entry is claimed and ledgered atomically on its own. If something
    // fails midway, the ones already paid stay paid and the rest can simply
    // be retried - nobody is paid twice.
    const paidEntries = [];
    for (const { _id } of pendingEntries) {
      const paid = await payDividendEntry(_id, distribution._id, req.user._id);
      if (paid) paidEntries.push(paid);
    }

    await Promise.all(
      paidEntries.map((entry) =>
        createNotificationAndPush({
          user: entry.user,
          type: "dividend",
          title: "Dividend Paid",
          message: `Your dividend of ₦${Number(entry.dividendAmount || 0).toLocaleString()} has been paid.`,
        }).catch((err) => console.error("Dividend notification error:", err.message))
      )
    );

    await completeDistributionIfDone(distribution._id);
    await audit(req, "dividend.pay-all", "DividendDistribution", distribution._id, {
      paid: paidEntries.length,
      total: paidEntries.reduce((s, e) => s + Number(e.dividendAmount || 0), 0),
    });

    const fresh = await DividendDistribution.findById(distribution._id);
    const entries = await DividendEntry.find({ distribution: distribution._id })
      .populate("user", "fullName email membershipType")
      .sort("-dividendAmount");

    res.json({ distribution: fresh, entries });
  } catch (err) {
    console.error("Pay dividend distribution error:", err);
    res.status(500).json({ message: "Could not process dividend payouts." });
  }
});

/*
  ============================
  LEDGER, AUDIT & REPORTS (server-side, paginated)
  ============================
*/

const pageParams = (req) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
  return { page, limit, skip: (page - 1) * limit };
};

// GET /api/admin/ledger/trial-balance?asOf=YYYY-MM-DD   (amounts in naira)
router.get("/ledger/trial-balance", async (req, res) => {
  try {
    const tb = await trialBalance({ asOf: req.query.asOf });
    res.json({
      accounts: tb.accounts.map((a) => ({
        code: a.code,
        name: a.name,
        type: a.type,
        debit: fromKobo(a.debit),
        credit: fromKobo(a.credit),
        balance: fromKobo(a.balance),
      })),
      totalDebit: fromKobo(tb.totalDebit),
      totalCredit: fromKobo(tb.totalCredit),
      balanced: tb.balanced,
    });
  } catch (err) {
    console.error("Trial balance error:", err);
    res.status(500).json({ message: "Could not load the trial balance." });
  }
});

// GET /api/admin/ledger/entries?page=&limit=&account=&user=&sourceType=&from=&to=
router.get("/ledger/entries", async (req, res) => {
  try {
    const { page, limit, skip } = pageParams(req);
    const q = {};
    if (req.query.account) q["lines.account"] = String(req.query.account);
    if (req.query.user) q["lines.user"] = req.query.user;
    if (req.query.sourceType) q.sourceType = String(req.query.sourceType);
    if (req.query.from || req.query.to) {
      q.postedAt = {};
      if (req.query.from) q.postedAt.$gte = new Date(req.query.from);
      if (req.query.to) q.postedAt.$lte = new Date(req.query.to);
    }

    const [total, rows] = await Promise.all([
      JournalEntry.countDocuments(q),
      JournalEntry.find(q).sort("-postedAt").skip(skip).limit(limit).lean(),
    ]);

    res.json({
      page,
      limit,
      total,
      entries: rows.map((e) => ({
        ...e,
        total: fromKobo(e.totalKobo),
        lines: e.lines.map((l) => ({
          ...l,
          debit: fromKobo(l.debit),
          credit: fromKobo(l.credit),
        })),
      })),
    });
  } catch (err) {
    console.error("Ledger entries error:", err);
    res.status(500).json({ message: "Could not load ledger entries." });
  }
});

// GET /api/admin/audit-logs?page=&limit=&action=&actor=
router.get("/audit-logs", async (req, res) => {
  try {
    const { page, limit, skip } = pageParams(req);
    const q = {};
    if (req.query.action) q.action = String(req.query.action);
    if (req.query.actor) q.actor = req.query.actor;

    const [total, logs] = await Promise.all([
      AuditLog.countDocuments(q),
      AuditLog.find(q).sort("-createdAt").skip(skip).limit(limit).lean(),
    ]);
    res.json({ page, limit, total, logs });
  } catch (err) {
    console.error("Audit log error:", err);
    res.status(500).json({ message: "Could not load the audit log." });
  }
});

// GET /api/admin/reports/summary - totals computed in the database, not the browser
router.get("/reports/summary", async (req, res) => {
  try {
    const sum = (rows) => Number(rows[0]?.total || 0);

    const [members, savings, disbursed, outstanding, repaid, withdrawn, dividends] =
      await Promise.all([
        User.countDocuments({ role: { $ne: "admin" } }),
        User.aggregate([
          { $match: { role: { $ne: "admin" } } },
          { $group: { _id: null, total: { $sum: "$savingsBalance" } } },
        ]),
        Loan.aggregate([
          { $match: { disbursedDate: { $ne: null } } },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]),
        Loan.aggregate([
          { $match: { disbursedDate: { $ne: null }, outstandingBalance: { $gt: 0 } } },
          { $group: { _id: null, total: { $sum: "$outstandingBalance" } } },
        ]),
        LoanRepayment.aggregate([
          { $match: { status: "approved" } },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]),
        Withdrawal.aggregate([
          { $match: { status: "success" } },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]),
        DividendEntry.aggregate([
          { $match: { status: "paid" } },
          { $group: { _id: null, total: { $sum: "$dividendAmount" } } },
        ]),
      ]);

    res.json({
      members,
      totalSavings: sum(savings),
      loansDisbursed: sum(disbursed),
      loansOutstanding: sum(outstanding),
      repaymentsReceived: sum(repaid),
      withdrawalsPaid: sum(withdrawn),
      dividendsPaid: sum(dividends),
    });
  } catch (err) {
    console.error("Reports summary error:", err);
    res.status(500).json({ message: "Could not load the report summary." });
  }
});

export default router;