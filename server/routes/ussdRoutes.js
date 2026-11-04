import express from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import User from "../models/User.js";
import Membership from "../models/Membership.js";
import Loan from "../models/Loan.js";
import SavingsTransaction from "../models/SavingsTransaction.js";
import LoanRepayment from "../models/LoanRepayment.js";
import Withdrawal from "../models/Withdrawal.js";
import CooperativeSetting from "../models/CooperativeSetting.js";
import { DividendEntry } from "../models/Dividend.js";
import {
  getSecurityState,
  recordSecurityFailure,
  recordSecuritySuccess,
  notifyPermanentSecurityLock,
} from "../utils/accountSecurity.js";
import { checkActivation, completeActivation, isWeakPin } from "../utils/ussdActivation.js";
import { alertSecurityChange } from "../utils/securityAlerts.js";

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
 *        "123456*4"    -> repayment schedule (END)
 *        "123456*5"    -> mini statement     (END)
 *        "123456*6"    -> loan eligibility
 *
 * Every result stays open with "0. Main menu". Inputs are replayed in order,
 * so "123456*1*0*3" means: savings, back to the menu, last contributions.
 * "0" on the main menu ends the session.
 *
 * Members with no PIN yet (e.g. button-phone members) start with an 8-digit
 * activation code from the office instead of a PIN:
 *   "48291736"                 -> code checked, asks for a new PIN
 *   "48291736*739402"          -> asks to confirm
 *   "48291736*739402*739402"   -> PIN saved
 *
 * The member is identified by phone number (Membership.phone) and proven by
 * the same 6-digit app PIN + the same failed-attempt lockout used by the app.
 */

const router = express.Router();

// ---- helpers --------------------------------------------------------------

// A USSD screen must stay under ~182 characters; cut at a line break, never
// in the middle of a line.
const MAX_SCREEN = 182;
const clip = (body, limit = MAX_SCREEN) => {
  if (body.length <= limit) return body;
  const cut = body.lastIndexOf("\n", limit);
  return body.slice(0, cut > 0 ? cut : limit);
};
const send = (res, body) => res.type("text/plain").send(clip(body));
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

// USSD callbacks are not signed, so the callback URL carries a secret token.
// Fails closed: with no USSD_CALLBACK_TOKEN configured, nothing is served.
router.use((req, res, next) => {
  const expected = process.env.USSD_CALLBACK_TOKEN;
  if (!expected) {
    console.error("[ussd] USSD_CALLBACK_TOKEN is not set; refusing requests.");
    return end(res, "Service unavailable. Please try again later.");
  }
  if (!safeEqual(req.query.token || "", expected)) {
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
    return { message: "You have no PIN yet. Ask the cooperative office for an activation code, or set a PIN in the mobile app." };
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


async function scheduleText(userId) {
  const loan = await Loan.findOne({
    user: userId,
    status: { $in: ["active", "overdue", "defaulted"] },
  }).sort({ createdAt: -1 });

  if (!loan) return "You have no active loan.";

  const open = (loan.repaymentSchedule || [])
    .filter((i) => i.status !== "paid")
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
    .slice(0, 3);

  if (!open.length) return `No installments left.\nOwing: ${naira(loan.outstandingBalance)}`;

  return [
    "Next installments:",
    ...open.map(
      (i) =>
        `${shortDate(i.dueDate)}  ${naira(Math.max(0, i.amountDue - (i.amountPaid || 0)))}` +
        (i.status === "overdue" ? " (overdue)" : "")
    ),
    `Owing: ${naira(loan.outstandingBalance)}`,
  ].join("\n");
}

async function statementText(userId) {
  const [savings, repayments, withdrawals, dividends] = await Promise.all([
    SavingsTransaction.find({ user: userId, status: "approved" })
      .sort({ createdAt: -1 }).limit(5).select("amount createdAt").lean(),
    LoanRepayment.find({ user: userId, status: "approved" })
      .sort({ createdAt: -1 }).limit(5).select("amount approvedAt createdAt").lean(),
    Withdrawal.find({ user: userId, status: "success" })
      .sort({ createdAt: -1 }).limit(5).select("amount paidAt createdAt").lean(),
    DividendEntry.find({ user: userId, status: "paid" })
      .sort({ createdAt: -1 }).limit(5).select("dividendAmount paidDate createdAt").lean(),
  ]);

  const rows = [
    ...savings.map((r) => ({ d: r.createdAt, sign: "+", amt: r.amount, label: "Savings" })),
    ...repayments.map((r) => ({ d: r.approvedAt || r.createdAt, sign: "-", amt: r.amount, label: "Loan repay" })),
    ...withdrawals.map((r) => ({ d: r.paidAt || r.createdAt, sign: "-", amt: r.amount, label: "Withdrawal" })),
    ...dividends.map((r) => ({ d: r.paidDate || r.createdAt, sign: "+", amt: r.dividendAmount, label: "Dividend" })),
  ]
    .sort((a, b) => new Date(b.d) - new Date(a.d))
    .slice(0, 5);

  if (!rows.length) return "No transactions yet.";

  return [
    "Mini statement:",
    ...rows.map(
      (r) =>
        `${shortDate(r.d)} ${r.sign}${Number(r.amt || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 })} ${r.label}`
    ),
  ].join("\n");
}

async function eligibilityText(member) {
  // Same rule as GET /api/loans/eligibility: savings x loan multiplier.
  const settings = await CooperativeSetting.findOne().select("loanMultiplier").lean();
  const multiplier = Number(settings?.loanMultiplier ?? 2);
  const eligible = Number(member.savingsBalance || 0) * multiplier;

  const openLoan = await Loan.findOne({
    user: member._id,
    status: { $in: ["pending", "approved", "active", "overdue"] },
  }).select("status");

  let line;
  if (!member.isLoanEligible) line = "Your loan application is not yet approved. Apply in the app.";
  else if (openLoan) line = "You already have an open loan.";
  else if (eligible <= 0) line = "Save more to qualify for a loan.";
  else line = "You can apply in the mobile app.";

  return `Loan limit: ${naira(eligible)}\n${line}`;
}

// ---- first-time PIN setup with an office activation code --------------------

async function handleActivation(res, phoneNumber, parts) {
  const failed = "Activation failed. Check your code or visit the cooperative office.";

  const userId = await findUserIdByPhone(phoneNumber);
  if (!userId) return end(res, failed);

  const member = await User.findById(userId).select(
    "+securityFailedAttempts +securityLockLevel +securityLockedUntil +securityLockedPermanently"
  );
  if (!member || member.isBlocked || !member.isApprovedMember) {
    return end(res, "Your account is unavailable. Please contact the cooperative.");
  }
  // An activation code does not bypass an account lock; the office unlocks first.
  const state = getSecurityState(member);
  if (state.permanent || state.locked) {
    return end(res, "Your account is locked. Please contact the cooperative.");
  }

  const check = await checkActivation(member._id, parts[0]);
  if (!check.ok) return end(res, check.message);

  if (parts.length === 1) return con(res, "Code accepted.\nChoose a new 6-digit PIN:");

  const pin = parts[1];
  if (!/^\d{6}$/.test(pin) || isWeakPin(pin)) {
    return end(res, "That PIN is not allowed. Use 6 digits and nothing obvious like 123456. Dial again.");
  }
  if (parts.length === 2) return con(res, "Confirm your new PIN:");

  if (parts.length > 3 || parts[2] !== pin) {
    return end(res, "The PINs did not match. Dial again and re-enter your code.");
  }

  await completeActivation(member._id, pin);
  void alertSecurityChange(member._id, check.hadPin ? "pin-changed" : "pin-created");
  return end(res, "Your PIN is set. Dial again and enter your PIN to use the service.");
}

// ---- main handler ---------------------------------------------------------

router.post("/", async (req, res) => {
  try {
    const phoneNumber = req.body?.phoneNumber;
    const text = String(req.body?.text ?? "");
    const parts = text === "" ? [] : text.split("*");

    if (parts.length === 0) {
      return con(res, "Exclusive Cooperative\nEnter your 6-digit PIN\n(or 8-digit activation code):");
    }

    if (/^\d{8}$/.test(parts[0])) return await handleActivation(res, phoneNumber, parts);

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

    const first = String(member.fullName || "Member").split(" ")[0];
    const menu = () =>
      con(
        res,
        `Hello ${first}\n1. Savings balance\n2. Loan status\n3. Last contributions\n4. Repayment schedule\n5. Mini statement\n6. Loan eligibility\n0. Exit`
      );

    // Replay everything typed after the PIN to find the current screen.
    let view = "menu"; // "menu" or the number of the result being shown
    for (const input of parts.slice(1)) {
      if (view === "menu") {
        if (input === "0") return end(res, "Thank you for using Exclusive Cooperative.");
        if (!["1", "2", "3", "4", "5", "6"].includes(input)) {
          return end(res, "Invalid choice. Dial again.");
        }
        view = input;
      } else if (input === "0") {
        view = "menu"; // "0. Main menu" on a result screen
      } else {
        return end(res, "Invalid choice. Dial again.");
      }
    }

    if (view === "menu") return menu();

    let body;
    switch (view) {
      case "1":
        body = savingsText(member);
        break;
      case "2":
        body = await loanText(member._id);
        break;
      case "3":
        body = await contributionsText(member._id);
        break;
      case "4":
        body = await scheduleText(member._id);
        break;
      case "5":
        body = await statementText(member._id);
        break;
      default:
        body = await eligibilityText(member);
    }
    // Keep the back option even if the result had to be shortened.
    return con(res, `${clip(body, MAX_SCREEN - 13)}\n0. Main menu`);
  } catch (err) {
    console.error("[ussd] error:", err);
    return end(res, "Something went wrong. Please try again later.");
  }
});

export default router;
