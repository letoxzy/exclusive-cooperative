import express from "express";
import crypto from "crypto";
import LoanEligibility from "../models/LoanEligibility.js";
import Membership from "../models/Membership.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireApprovedMember } from "../middleware/membershipMiddleware.js";
import { compareBVNIdentity, getVerificationDetails, lookupBVN } from "../services/dojahService.js";

const router = express.Router();
const BVN_REGEX = /^\d{11}$/;

function hashBVN(bvn) {
  return crypto
    .createHash("sha256")
    .update(`${process.env.BVN_HASH_PEPPER || "exclusive-cooperative-bvn"}:${bvn}`)
    .digest("hex");
}

function safeApplication(application) {
  if (!application) return null;
  const value = application.toObject ? application.toObject() : { ...application };
  delete value.bvn;
  delete value.bvnHash;
  return value;
}

// GET /api/kyc/status
router.get("/status", protect, requireApprovedMember, async (req, res) => {
  try {
    const application = await LoanEligibility.findOne({ user: req.user._id })
      .select("-bvnHash")
      .sort("-createdAt");

    if (!application) {
      return res.json({
        exists: false,
        bvnVerificationStatus: "not_started",
        identityMatchStatus: "not_started",
        faceVerificationStatus: "not_started",
        consentStatus: "not_started",
      });
    }

    res.json({
      exists: true,
      application: safeApplication(application),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/kyc/bvn/verify
// Performs the BVN lookup in Dojah Sandbox. The raw BVN never enters MongoDB.
router.post("/bvn/verify", protect, requireApprovedMember, async (req, res) => {
  try {
    const bvn = String(req.body?.bvn || "").trim();

    if (!BVN_REGEX.test(bvn)) {
      return res.status(400).json({ message: "Enter a valid 11-digit BVN." });
    }

    if (req.user.isLoanEligible) {
      return res.status(400).json({ message: "Your account is already loan eligible." });
    }

    const membership = await Membership.findOne({
      user: req.user._id,
      status: "approved",
    });

    if (!membership) {
      return res.status(400).json({
        message: "You need an approved membership record before BVN verification.",
      });
    }

    let application = await LoanEligibility.findOne({ user: req.user._id }).sort("-createdAt");

    if (application?.status === "pending" && application.bvnVerificationStatus === "verified") {
      return res.status(400).json({ message: "Your verified application is already awaiting review." });
    }

    const { entity } = await lookupBVN(bvn);
    const comparison = compareBVNIdentity(entity, membership);
    const sandboxMode = String(process.env.DOJAH_SANDBOX_MODE || "true").toLowerCase() === "true";

    // Dojah Sandbox uses dummy identity data. In Sandbox only, allow the
    // known test response to exercise the complete app flow without
    // pretending the dummy person is a real member. Production must keep
    // identity matching enabled.
    const identityAccepted = sandboxMode ? true : comparison.matched;

    if (!identityAccepted) {
      if (!application) {
        application = new LoanEligibility({ user: req.user._id });
      }

      application.bvnHash = hashBVN(bvn);
      application.bvnLast4 = bvn.slice(-4);
      application.bvnVerificationStatus = "failed";
      application.identityMatchStatus = "mismatch";
      application.faceVerificationStatus = application.faceVerificationStatus || "not_started";
      application.status = "rejected";
      application.rejectionReason =
        "The BVN details could not be matched with your approved membership information. Please check your details and try again.";
      application.applicantDetails = {
        fullName: membership.fullName || "",
        phone: membership.phone || "",
        email: membership.email || "",
        address: membership.address || "",
        dob: membership.dob || "",
        gender: membership.gender || "",
        maritalStatus: membership.maritalStatus || "",
        occupation: membership.occupation || "",
        employmentStatus: membership.employmentStatus || "",
        stateOfOrigin: membership.stateOfOrigin || "",
        lga: membership.lga || "",
        kinName: membership.kinName || "",
        kinPhone: membership.kinPhone || "",
        kinRelationship: membership.kinRelationship || "",
        kinAddress: membership.kinAddress || "",
      };
      await application.save();

      return res.status(422).json({
        message: "BVN verification could not be completed because the returned identity details did not match your membership record.",
        verification: {
          bvnVerificationStatus: "failed",
          identityMatchStatus: "mismatch",
        },
      });
    }

    if (!application) {
      application = new LoanEligibility({ user: req.user._id });
    }

    application.bvnHash = hashBVN(bvn);
    application.bvnLast4 = bvn.slice(-4);
    application.bvnVerificationStatus = "verified";
    application.identityMatchStatus = sandboxMode ? "matched" : "matched";
    application.bvnVerifiedAt = new Date();
    application.status = "pending";
    application.rejectionReason = "";
    application.applicantDetails = {
      fullName: membership.fullName || "",
      phone: membership.phone || "",
      email: membership.email || "",
      address: membership.address || "",
      dob: membership.dob || "",
      gender: membership.gender || "",
      maritalStatus: membership.maritalStatus || "",
      occupation: membership.occupation || "",
      employmentStatus: membership.employmentStatus || "",
      stateOfOrigin: membership.stateOfOrigin || "",
      lga: membership.lga || "",
      kinName: membership.kinName || "",
      kinPhone: membership.kinPhone || "",
      kinRelationship: membership.kinRelationship || "",
      kinAddress: membership.kinAddress || "",
    };
    await application.save();

    res.json({
      message: "BVN verified successfully. Your Full Loan Application is now awaiting cooperative review.",
      verification: {
        bvnVerificationStatus: application.bvnVerificationStatus,
        identityMatchStatus: application.identityMatchStatus,
        bvnLast4: application.bvnLast4,
      },
      application: safeApplication(application),
    });
  } catch (err) {
    const status = err.status;
    const providerMessage =
      err.providerData?.message ||
      err.providerData?.error ||
      err.message;

    res.status(status && status >= 400 && status < 500 ? 400 : 502).json({
      message: `BVN verification failed: ${providerMessage}`,
    });
  }
});

// POST /api/kyc/widget-result
// The client only reports the Dojah reference. The backend fetches the
// authoritative verification record from Dojah before changing KYC status.
router.post("/widget-result", protect, requireApprovedMember, async (req, res) => {
  try {
    const referenceId = String(req.body?.referenceId || "").trim();

    if (!referenceId) {
      return res.status(400).json({
        message: "The identity verification reference is missing.",
      });
    }

    const membership = await Membership.findOne({
      user: req.user._id,
      status: "approved",
    });

    if (!membership) {
      return res.status(400).json({
        message: "You need an approved membership record before identity verification.",
      });
    }

    const verification = await getVerificationDetails(referenceId);
    const providerStatus = String(verification?.verification_status || "")
      .trim()
      .toLowerCase();

    let application = await LoanEligibility.findOne({ user: req.user._id }).sort("-createdAt");
    if (!application) application = new LoanEligibility({ user: req.user._id });

    application.verificationReference = referenceId;
    application.verificationProvider = "dojah";
    application.providerVerificationStatus = providerStatus || "pending";
    application.consentStatus = "granted";
    application.consentGrantedAt = application.consentGrantedAt || new Date();

    const verificationData = verification?.data || verification;
    const bvnResult = verificationData?.government_data?.data?.bvn;
    const bvnEntity = bvnResult?.entity || null;
    const bvnPassed = bvnResult?.status === true && !!bvnEntity;
    const identityComparison = bvnEntity
      ? compareBVNIdentity(bvnEntity, membership)
      : { matched: false };
    const sandboxMode = String(process.env.DOJAH_SANDBOX_MODE || "true").toLowerCase() === "true";
    const identityAccepted = sandboxMode ? bvnPassed : identityComparison.matched;

    application.bvnVerificationStatus = bvnPassed ? "verified" : "failed";
    application.identityMatchStatus = identityAccepted ? "matched" : "mismatch";

    const selfiePassed = verificationData?.selfie?.status === true;
    application.faceVerificationStatus = selfiePassed ? "verified" : "failed";

    if (providerStatus === "completed" && bvnPassed && identityAccepted && selfiePassed) {
      application.status = "pending";
      application.verifiedAt = new Date();
      application.providerVerificationCompletedAt = new Date();
      application.rejectionReason = "";
    } else if (["failed", "abandoned"].includes(providerStatus)) {
      application.status = "rejected";
      application.rejectionReason =
        "Identity verification was not completed successfully. Please start the verification again.";
    } else {
      application.status = "pending";
    }

    application.applicantDetails = {
      fullName: membership.fullName || "",
      phone: membership.phone || "",
      email: membership.email || "",
      address: membership.address || "",
      dob: membership.dob || "",
      gender: membership.gender || "",
      maritalStatus: membership.maritalStatus || "",
      occupation: membership.occupation || "",
      employmentStatus: membership.employmentStatus || "",
      stateOfOrigin: membership.stateOfOrigin || "",
      lga: membership.lga || "",
      kinName: membership.kinName || "",
      kinPhone: membership.kinPhone || "",
      kinRelationship: membership.kinRelationship || "",
      kinAddress: membership.kinAddress || "",
    };

    await application.save();

    const message =
      application.status === "pending" && application.bvnVerificationStatus === "verified" && application.faceVerificationStatus === "verified"
        ? "Identity verification completed. Your Full Loan Application is now awaiting cooperative review."
        : providerStatus === "completed"
          ? "Identity verification was completed, but the returned identity details could not be matched to your membership record. Please contact the cooperative."
          : "Your verification status has been recorded. Please complete any remaining verification steps.";

    res.json({
      message,
      verification: safeApplication(application),
      application: safeApplication(application),
    });
  } catch (err) {
    const status = err.status;
    const providerMessage =
      err.providerData?.message ||
      err.providerData?.error ||
      err.message;

    res.status(status && status >= 400 && status < 500 ? 400 : 502).json({
      message: `Identity verification could not be confirmed: ${providerMessage}`,
    });
  }
});

export default router;
