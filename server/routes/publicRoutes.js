import express from "express";
import rateLimit from "express-rate-limit";
import User from "../models/User.js";
import AccountDeletionRequest from "../models/AccountDeletionRequest.js";

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Anyone on the internet can call this, so keep it tightly limited.
const deletionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests. Please try again later." },
});

// POST /api/public/account-deletion-request   { email, fullName?, reason? }
//
// The public "delete my account" page (the link Google Play asks for). It
// needs no sign-in, so someone who lost access can still ask. To avoid
// revealing which emails are members, the reply is always the same. The office
// confirms the person's identity before anything is deleted.
router.post("/account-deletion-request", deletionLimiter, async (req, res) => {
  const generic = {
    message:
      "Your request has been received. The cooperative office will contact you on this email to confirm your identity and complete the deletion.",
  };

  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const fullName = String(req.body?.fullName || "").trim().slice(0, 120);
    const reason = String(req.body?.reason || "").trim().slice(0, 500);

    if (!EMAIL_RE.test(email) || email.length > 254) {
      return res.status(400).json({ message: "Enter the email address of your account." });
    }

    // One open request per email is enough.
    const already = await AccountDeletionRequest.exists({ email, status: "pending" });
    if (already) return res.json(generic);

    const member = await User.findOne({ email }).select("_id role");
    await AccountDeletionRequest.create({
      user: member && member.role !== "admin" ? member._id : null,
      email,
      fullName,
      reason,
      source: "web",
    });

    return res.json(generic);
  } catch (err) {
    console.error("Public deletion request error:", err);
    return res.status(500).json({ message: "Could not send your request. Please try again." });
  }
});

export default router;
