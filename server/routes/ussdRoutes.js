import express from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import User from "../models/User.js";
import Membership from "../models/Membership.js";
import Loan from "../models/Loan.js";
import SavingsTransaction from "../models/SavingsTransaction.js";
import {
  getSecurityState,
  recordSecurityFailure,
  recordSecuritySuccess,
  notifyPermanentSecurityLock,
} from "../utils/accountSecurity.js";

/**
 * USSD (Africa's Talking) - read-only member menu.
 *
 * Callback URL to set in the Africa's Talking dashboard:
 *   https://<your-render-app>.onrender.com/api/ussd?token=<USSD_CALLBACK_TOKEN>
 *
 * Africa's Talking POSTs form data (NOT json): sessionId, serviceCode,
 * phoneNumber, text. `text` is every input so far joined by "*".
 *
 * Flow:  ""            -> ask for PIN
 *        "123456"      -> main menu
 *        "123456*1"    -> savings balance   (END)
 *        "123456*2"    -> loan status       (END)
 *        "123456*3"    -> last contributions (END)
 *
 * The member is identified by phone number (Membership.phone) and proven by
 * the same 6-digit app PIN + the same failed-attempt lockout used by the app.
 */

const router = express.Router();

// ---- helpers --------------------------------------------------------------

const send = (res, body) => res.type("text/plain").send(body);
const con = (res, msg) => send(res, `CON ${msg}`);
const end = (res, msg) => send(res, `END ${msg}`);

const digits = (v) => String(v || "").replace(/\D/g, "");
const last10 = (v) => digits(v).slice(-10);

const naira = (n) =>
  `NGN ${Number(n || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;

const shortDate = (d) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "2-digit",
  }).format(new Date(d));

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// ---- request guards -------------------------------------------------------

// AT sends application/x-www-form-urlencoded; server.js only parses JSON.
router.use(express.urlencoded({ extended: false }));
router.use((req, res, next) => {
  console.log(
    "[ussd] request, phone ending",
    last10(req.body?.phoneNumber).slice(-4),
    "text length",
    String(req.body?.text ?? "").length
  );
  next();
});

// USSD callbacks are not signed, so the callback URL carries a secret token.
// Fails closed: with no USSD_CALLBACK_TOKEN configured, nothing is served.
router.use((req, res, next) => {
  const expected = process.env.USSD_CALLBACK_TOKEN;
  if (!expected) {
    console.error("[ussd] USSD_CALLBACK_TOKEN is not set; refusing requests.");
    return end(res, "Service unavailable. Please try again later.");
  }
  if (!safeEqual(req.query.token || "", expected)) {
    console.warn("[ussd] token mismatch");
    return res.status(403).type("text/plain").send("Forbidden");
  }
  next();
});

// Limit per phone number (all AT traffic shares a few IPs, so not per IP).
router.use(
  rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 40,
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: (req) => `ussd:${last10(req.body?.phoneNumber) || "unknown"}`,
    handler: (req, res) => end(res, "Too many requests. Please try again in a few minutes."),
  })
);

// ---- lookups --------------------------------------------------------------

async function findUserIdByPhone(phoneNumber) {
  const key = last10(phoneNumber);
  if (key.length < 10) return null;

  // Membership.phone is free text ("0803 123 4567", "+234-803..."), so match
  // the 10 significant digits while ignoring separators, then double-check.
  const pattern = new RegExp(`${key.split("").join("\\D*")}\\D*$`);
  const rows = await Membership.find({
    status: "approved",
    user: { $ne: null },
    phone: { $regex: pattern },
  })
    .select("user phone")
    .limit(5)
    .lean();

  const ids = [
    ...new Set(rows.filter((m) => last10(m.phone) === key).map((m) => String(m.user))),
  ];
  // Two members sharing one number: refuse rather than guess.
  return ids.length === 1 ? ids[0] : null;
}

// Returns { member } on success or { message } (an END text) on failure.
async function verifyPin(userId, pin) {
  const member = await User.findById(userId).select(
    "+appPinHash +securityFailedAttempts +securityLockLevel +securityLockedUntil +securityLockedPermanently"
  );

  if (!member || member.isBlocked || !member.isApprovedMember) {
    return { message: "Your account is unavailable. Please contact the cooperative." };
  }
  if (!member.appPinHash) {
    return { message: "Set your 6-digit PIN in the mobile app first, then dial again." };
  }

  const state = getSecurityState(member);
  if (state.permanent) {
    return { message: "Account locked for security. Please contact the cooperative." };
  }
  if (state.locked) {
    const mins = Math.max(1, Math.ceil((new Date(state.lockedUntil) - Date.now()) / 60000));
    return { message: `Too many wrong attempts. Try again in ${mins} min.` };
  }

  const ok = await bcrypt.compare(pin, member.appPinHash);
  if (!ok) {
    const result = await recordSecurityFailure(member);
    if (result.permanent) {
      await notifyPermanentSecurityLock(member);
      return { message: "Account locked for security. Please contact the cooperative." };
    }
    if (result.locked) {
      return { message: `Too many wrong attempts. Locked for ${result.lockMinutes} min.` };
    }
    return {
      message: `Incorrect PIN. ${result.remainingAttempts} attempt${
        result.remainingAttempts === 1 ? "" : "s"
      } left.`,
    };
  }

  await recordSecuritySuccess(member);
  return { member };
}

// ---- menu actions ---------------------------------------------------------

const savingsText = (m) =>
  `Savings: ${naira(m.savingsBalance)}\nShares: ${naira(m.shareholding)}` +
  (m.withdrawalReserved > 0 ? `\nPending withdrawal: ${naira(m.withdrawalReserved)}` : "");

async function loanText(userId) {
  const loan = await Loan.findOne({
    user: userId,
    status: { $in: ["pending", "approved", "active", "overdue", "defaulted"] },
  }).sort({ createdAt: -1 });

  if (!loan) return "You have no open loan.";

  const label = `${loan.loanType} loan: ${loan.status}`;

  if (loan.status === "pending" || loan.status === "approved") {
    const next = loan.status === "pending" ? "awaiting approval" : "awaiting disbursement";
    return `${label}\nAmount: ${naira(loan.amount)}\n${next}`;
  }

  const next = (loan.repaymentSchedule || [])
    .filter((i) => i.status !== "paid")
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0];

  let text = `${label}\nOwing: ${naira(loan.outstandingBalance)}`;
  if (next) {
    text += `\nNext: ${naira(Math.max(0, next.amountDue - (next.amountPaid || 0)))} due ${shortDate(next.dueDate)}`;
  }
  if (loan.overdueChargeTotal > 0) text += `\nOverdue charges: ${naira(loan.overdueChargeTotal)}`;
  return text;
}

async function contributionsText(userId) {
  const rows = await SavingsTransaction.find({ user: userId, status: "approved" })
    .sort({ createdAt: -1 })
    .limit(3)
    .lean();
  if (!rows.length) return "No contributions yet.";
  return ["Last contributions:", ...rows.map((r) => `${shortDate(r.createdAt)}  ${naira(r.amount)}`)].join("\n");
}

// ---- main handler ---------------------------------------------------------

router.post("/", async (req, res) => {
  try {
    const phoneNumber = req.body?.phoneNumber;
    const text = String(req.body?.text ?? "");
    const parts = text === "" ? [] : text.split("*");

    if (parts.length === 0) {
      return con(res, "Exclusive Cooperative\nEnter your 6-digit PIN:");
    }

    const pin = parts[0];
    if (!/^\d{6}$/.test(pin)) {
      return end(res, "Invalid PIN. Dial again and enter your 6-digit PIN.");
    }

    const userId = await findUserIdByPhone(phoneNumber);
    if (!userId) {
      return end(res, "This number is not linked to a member account. Please contact the cooperative.");
    }

    const check = await verifyPin(userId, pin);
    if (!check.member) return end(res, check.message);
    const { member } = check;

    const choice = parts[1];
    if (choice === undefined) {
      const first = String(member.fullName || "Member").split(" ")[0];
      return con(res, `Hello ${first}\n1. Savings balance\n2. Loan status\n3. Last contributions\n0. Exit`);
    }

    switch (choice) {
      case "1":
        return end(res, savingsText(member));
      case "2":
        return end(res, await loanText(member._id));
      case "3":
        return end(res, await contributionsText(member._id));
      case "0":
        return end(res, "Thank you for using Exclusive Cooperative.");
      default:
        return end(res, "Invalid choice. Dial again.");
    }
  } catch (err) {
    console.error("[ussd] error:", err);
    return end(res, "Something went wrong. Please try again later.");
  }
});

export default router;