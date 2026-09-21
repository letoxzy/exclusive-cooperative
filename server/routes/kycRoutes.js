import express from "express";
import crypto from "crypto";
import LoanEligibility from "../models/LoanEligibility.js";
import Membership from "../models/Membership.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireApprovedMember } from "../middleware/membershipMiddleware.js";
import {
  buildSnapshot,
  compareIdentity,
  getVerificationDetails,
  last4,
  parseVerification,
} from "../services/dojahService.js";
import {
  buildApplicantDetails,
  isVerificationComplete,
  safeApplication,
} from "../utils/kycHelpers.js";
import { createNotificationAndPush } from "../utils/createNotification.js";

const router = express.Router();

// Dojah's dashboard says "Successful" / "Failed" while its API documents
// "Completed" / "Failed". Accept either wording so a successful verification is
// never mistaken for an unfinished one.
export function mapProviderStatus(raw) {
  const value = String(raw || "").toLowerCase().trim().replace(/[\s_-]+/g, " ");

  if (["completed", "complete", "successful", "success", "approved", "verified"].includes(value)) {
    return "completed";
  }
  if (["failed", "fail", "declined", "rejected"].includes(value)) return "failed";
  if (value === "abandoned") return "abandoned";
  if (["ongoing", "in progress"].includes(value)) return "ongoing";
  return "pending";
}

function hashBVN(bvn) {
  return crypto
    .createHash("sha256")
    .update(`${process.env.BVN_HASH_PEPPER || "exclusive-cooperative-bvn"}:${bvn}`)
    .digest("hex");
}

// The reference is created HERE, never by the browser, and is stored on the
// member's application. That is what ties a Dojah verification to one member.
function newReference() {
  return `EC-${crypto.randomBytes(9).toString("hex").toUpperCase()}`;
}

function providerError(err, prefix) {
  const status = err.status;
  const message = err.providerData?.message || err.providerData?.error || err.message;
  return {
    code: status && status >= 400 && status < 500 ? 400 : 502,
    body: { message: `${prefix}: ${message}` },
  };
}

// GET /api/kyc/status
router.get("/status", protect, requireApprovedMember, async (req, res) => {
  try {
    const application = await LoanEligibility.findOne({ user: req.user._id }).sort("-createdAt");

    if (!application) {
      return res.json({
        exists: false,
        bvnVerificationStatus: "not_started",
        identityMatchStatus: "not_started",
        faceVerificationStatus: "not_started",
        consentStatus: "not_started",
      });
    }

    res.json({ exists: true, application: safeApplication(application) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/kyc/start   { consent: true }
// Creates (or restarts) the member's verification attempt and returns the
// server-issued reference id that the Dojah widget must be opened with.
router.post("/start", protect, requireApprovedMember, async (req, res) => {
  try {
    if (req.body?.consent !== true) {
      return res.status(400).json({
        message: "Please give your consent before starting identity verification.",
      });
    }

    if (req.user.isLoanEligible) {
      return res.status(400).json({ message: "Your account is already loan eligible." });
    }

    const membership = await Membership.findOne({ user: req.user._id, status: "approved" });
    if (!membership) {
      return res.status(400).json({
        message: "You need an approved membership record before identity verification.",
      });
    }

    let application = await LoanEligibility.findOne({ user: req.user._id }).sort("-createdAt");

    if (application?.status === "approved") {
      return res.status(400).json({ message: "Your Full Loan Application is already approved." });
    }

    if (application?.status === "pending" && isVerificationComplete(application)) {
      return res.status(400).json({
        message: "Your verification is complete and is already awaiting administrator review.",
      });
    }

    // Reuse an unfinished attempt. After a rejection a brand-new attempt is
    // created so the earlier decision stays on record.
    const reusable = application && ["draft", "pending"].includes(application.status);
    if (!reusable) application = new LoanEligibility({ user: req.user._id });

    application.status = "draft";
    application.verificationReference = newReference();
    application.verificationProvider = "dojah";
    application.providerVerificationStatus = "ongoing";
    application.bvnVerificationStatus = "not_started";
    application.identityMatchStatus = "not_started";
    application.faceVerificationStatus = "not_started";
    application.consentStatus = "granted";
    application.consentGrantedAt = new Date();
    application.kycStartedAt = new Date();
    application.submittedDate = null;
    application.rejectionReason = "";
    application.applicantDetails = buildApplicantDetails(membership);
    await application.save();

    res.json({
      referenceId: application.verificationReference,
      application: safeApplication(application),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/kyc/widget-result   { referenceId }
// The browser only says "I'm done". The backend asks Dojah for the real
// result of the reference it issued, then puts the application in the
// administrator's queue. Nothing here approves a member.
router.post("/widget-result", protect, requireApprovedMember, async (req, res) => {
  try {
    if (req.user.isLoanEligible) {
      return res.status(400).json({ message: "Your account is already loan eligible." });
    }

    const application = await LoanEligibility.findOne({ user: req.user._id }).sort("-createdAt");

    if (!application?.verificationReference) {
      return res.status(400).json({
        message: "Please start identity verification first.",
      });
    }

    if (application.status === "approved") {
      return res.status(400).json({ message: "Your Full Loan Application is already approved." });
    }

    const sentReference = String(req.body?.referenceId || "").trim();
    if (sentReference && sentReference !== application.verificationReference) {
      return res.status(400).json({
        message: "This verification session is no longer valid. Please start again.",
      });
    }

    if (application.status === "rejected") {
      return res.status(400).json({
        message: "This verification attempt was closed. Please start a new verification.",
      });
    }

    // Already submitted: answer again without calling Dojah or notifying twice.
    if (application.status === "pending" && isVerificationComplete(application)) {
      return res.json({
        message:
          "Your Full Loan Application has been submitted and is awaiting administrator review.",
        submitted: true,
        application: safeApplication(application),
        verification: safeApplication(application),
      });
    }

    const membership = await Membership.findOne({ user: req.user._id, status: "approved" });
    if (!membership) {
      return res.status(400).json({
        message: "You need an approved membership record before identity verification.",
      });
    }

    const raw = await getVerificationDetails(application.verificationReference);
    const details = parseVerification(raw);
    const comparison = compareIdentity(details, membership);

    // If Dojah sent no status word at all, fall back on the checks themselves:
    // BVN and selfie both passed means the member finished the flow.
    const providerStatus = details.status
      ? mapProviderStatus(details.status)
      : details.bvn.passed && details.selfie.passed
        ? "completed"
        : "pending";
    const finished = ["completed", "failed", "abandoned"].includes(providerStatus);

    // Diagnostic line for the Render logs: no personal data, no keys.
    console.log(
      `[kyc] widget-result ref=${application.verificationReference} dojahStatus="${details.status}" ` +
        `bvn=${details.bvn.passed} selfie=${details.selfie.passed} id=${details.id.passed}` +
        (details.status ? "" : ` keys=[${details.topLevelKeys.join(",")}]`)
    );

    application.providerVerificationStatus = providerStatus;
    application.bvnVerificationStatus = details.bvn.passed ? "verified" : finished ? "failed" : "pending";
    application.faceVerificationStatus = details.selfie.passed ? "verified" : finished ? "failed" : "pending";
    application.identityMatchStatus = details.bvn.passed
      ? comparison.autoMatched
        ? "matched"
        : "mismatch"
      : finished
        ? "failed"
        : "pending";
    application.applicantDetails = buildApplicantDetails(membership);

    const checksPassed = providerStatus === "completed" && details.bvn.passed && details.selfie.passed;
    let justSubmitted = false;

    if (checksPassed) {
      // Detect the same BVN being used on another member's application.
      let duplicateBvn = false;
      if (details.bvn.number) {
        const hash = hashBVN(details.bvn.number);
        application.bvnHash = hash;
        application.bvnLast4 = last4(details.bvn.number);

        const other = await LoanEligibility.findOne({
          bvnHash: hash,
          user: { $ne: req.user._id },
          status: { $in: ["pending", "approved"] },
        }).select("_id");
        duplicateBvn = Boolean(other);
      }

      const now = new Date();
      application.status = "pending";
      application.submittedDate = now;
      application.verifiedAt = now;
      application.bvnVerifiedAt = now;
      application.providerVerificationCompletedAt = now;
      application.rejectionReason = "";
      application.verificationSnapshot = buildSnapshot(details, comparison, { duplicateBvn });
      justSubmitted = true;
    } else if (finished) {
      application.status = "rejected";
      application.rejectionReason =
        providerStatus === "completed"
          ? "Your BVN or selfie could not be verified. Please start again and make sure your details and photo are clear."
          : "Identity verification was not completed. Please start again.";
    } else {
      // Still ongoing at Dojah: the member has not finished the steps yet.
      application.status = "draft";
    }

    await application.save();

    if (justSubmitted) {
      await createNotificationAndPush({
        user: req.user._id,
        type: "loan-eligibility",
        title: "Full Loan Application Submitted",
        message:
          "Your Full Loan Application has been submitted successfully and is now awaiting administrator review. You will be notified once a decision is made.",
        data: { applicationId: application._id.toString(), status: "pending" },
      });
    }

    const message = justSubmitted
      ? "Your Full Loan Application has been submitted successfully and is now awaiting administrator review."
      : application.status === "rejected"
        ? application.rejectionReason
        : "Your verification is not finished yet. Please complete all the steps, then tap the button again.";

    res.json({
      message,
      submitted: justSubmitted,
      application: safeApplication(application),
      verification: safeApplication(application),
    });
  } catch (err) {
    // Shows up in the Render logs so a failing Dojah call is easy to diagnose.
    // Only the status and message are logged, never keys or headers.
    console.error(
      "[kyc] widget-result failed:",
      err.status || "no-status",
      err.providerData?.message || err.providerData?.error || err.message
    );
    const { code, body } = providerError(err, "Identity verification could not be confirmed");
    res.status(code).json(body);
  }
});

export default router;
