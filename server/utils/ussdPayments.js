import crypto from "crypto";
import Loan from "../models/Loan.js";
import { callInternal } from "./internalApi.js";
import { createTtlCache } from "./ttlCache.js";
import { sendSms, normalizeNgPhone } from "../sms.js";

/**
 * Savings top-ups and loan repayments over USSD (money IN only).
 *
 * How it fits your existing code (none of which is changed):
 *  1. The rules are checked by YOUR payment routes, called internally the same
 *     way the app calls them: POST /api/payments/paystack/initialize (savings:
 *     minimum, daily/weekly/monthly limit) and
 *     POST /api/payments/paystack/loan-repayment/initialize (loan, balance,
 *     minimum). Whatever they answer, the member sees.
 *  2. A button phone can't open Paystack's checkout page, so the payment is then
 *     created with Paystack's Charge API as either
 *       - "transfer": a one-off bank account number to transfer to (Pay with
 *         Transfer; Paystack support must enable it for your account), or
 *       - "ussd": a bank USSD code to dial (Paystack's own USSD channel).
 *     Chosen with USSD_PAYMENT_METHOD (default "transfer").
 *  3. The metadata is the same as the app's, so when Paystack reports the
 *     payment your EXISTING webhook credits savings or the loan, creates the
 *     notification and (when enabled) the receipt SMS. Nothing is credited here.
 *
 * Off unless USSD_PAYMENTS_ENABLED=true.
 * Screens (after PIN and the menu option): amount -> [bank] -> confirm -> details.
 */

export const paymentsEnabled = () =>
  String(process.env.USSD_PAYMENTS_ENABLED || "").toLowerCase() === "true";

const paymentMethod = () =>
  String(process.env.USSD_PAYMENT_METHOD || "transfer").toLowerCase() === "ussd" ? "ussd" : "transfer";

const expiryMinutes = () => {
  const n = parseInt(process.env.USSD_TRANSFER_EXPIRY_MINUTES, 10);
  return Number.isFinite(n) && n >= 5 && n <= 240 ? n : 30;
};

const maxRequestsPerHour = () => {
  const n = parseInt(process.env.USSD_PAYMENT_REQUESTS_PER_HOUR, 10);
  return Number.isFinite(n) && n > 0 ? n : 5;
};

const USSD_BANKS = [
  { label: "GTBank", code: "737" },
  { label: "UBA", code: "919" },
  { label: "Sterling", code: "822" },
  { label: "Zenith", code: "966" },
];

const naira = (n) => `NGN ${Number(n || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const con = (text) => ({ type: "con", text });
const end = (text) => ({ type: "end", text });
const clipText = (s, n = 140) => (String(s).length > n ? `${String(s).slice(0, n - 1)}...` : String(s));

const gateCache = createTtlCache(5 * 60 * 1000); // a passed rule check, so USSD replays don't re-ask
const resultCache = createTtlCache(10 * 60 * 1000); // a finished request, so a repeated delivery gives the same details
const recentRequests = new Map(); // userId -> timestamps of payment requests in the last hour

// Counts only payments that were really created, so a Paystack outage can't
// lock a member out by making them retry.
function tooManyRequests(userId) {
  const now = Date.now();
  const recent = (recentRequests.get(String(userId)) || []).filter((t) => now - t < 3600 * 1000);
  recentRequests.set(String(userId), recent);
  return recent.length >= maxRequestsPerHour();
}

function noteRequest(userId) {
  const list = recentRequests.get(String(userId)) || [];
  list.push(Date.now());
  recentRequests.set(String(userId), list);
}

// ---- Paystack Charge API ------------------------------------------------------
async function createCharge({ email, amount, metadata, bank }) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return { error: true };

  const body = { email, amount: Math.round(amount * 100), metadata };
  if (paymentMethod() === "ussd") {
    body.ussd = { type: bank.code };
  } else {
    // Paystack wants ISO 8601 without milliseconds: YYYY-MM-DDThh:mm:ssZ
    body.bank_transfer = {
      account_expires_at: new Date(Date.now() + expiryMinutes() * 60000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch("https://api.paystack.co/charge", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.status) {
      // Typical cause: the channel is not enabled for your Paystack account.
      console.error("[ussd] Paystack charge rejected:", response.status, json?.message || "(no message)");
      return { error: true };
    }
    const d = json.data || {};
    if (paymentMethod() === "ussd") {
      return d.ussd_code ? { kind: "ussd", code: d.ussd_code, reference: d.reference } : { error: true };
    }
    return d.account_number
      ? {
          kind: "transfer",
          accountNumber: String(d.account_number),
          accountName: d.account_name ? String(d.account_name) : "",
          bankName: d.bank?.name ? String(d.bank.name) : "",
          reference: d.reference,
        }
      : { error: true };
  } catch {
    return { error: true };
  } finally {
    clearTimeout(timer);
  }
}

// ---- shared tail of both wizards ----------------------------------------------
/**
 * Everything after the amount is known: bank choice (USSD method only),
 * confirmation, then create the payment and show the details.
 */
async function finishPayment(inputs, startIndex, ctx, { amount, purposeLabel, metadata, gateCall }) {
  let i = startIndex;
  const more = () => i < inputs.length;
  const take = () => inputs[i++];
  const cancelled = () => ({ back: true, used: i });
  const userId = ctx.member._id;

  // The app's own rule check (cached so USSD replays don't repeat it).
  const gateKey = `${userId}:${purposeLabel}:${JSON.stringify(gateCall.body)}`;
  if (!gateCache.get(gateKey)) {
    const gate = await callInternal(userId, "POST", gateCall.path, { body: gateCall.body });
    if (gate.uncertain || gate.status === 0) return end("Unable to start the payment right now. Please try again.");
    if (!gate.ok) return end(clipText(gate.data?.message || "This payment cannot be made right now."));
    gateCache.set(gateKey, true);
  }

  // Bank for the USSD method only.
  let bank = null;
  if (paymentMethod() === "ussd") {
    if (!more()) {
      return con(`Choose your bank:\n${USSD_BANKS.map((b, n) => `${n + 1}. ${b.label}`).join("\n")}\n0. Cancel`);
    }
    const choice = take();
    if (choice === "0") return cancelled();
    bank = /^[1-4]$/.test(choice) ? USSD_BANKS[Number(choice) - 1] : null;
    if (!bank) return end("Invalid choice. Dial again.");
  }

  // Confirm.
  const how = paymentMethod() === "ussd" ? `with ${bank.label} USSD` : "by bank transfer";
  if (!more()) return con(`${purposeLabel}: ${naira(amount)} ${how}?\n1. Confirm\n2. Cancel`);
  const confirm = take();
  if (confirm === "2" || confirm === "0") return cancelled();
  if (confirm !== "1") return end("Invalid choice. Dial again.");
  if (more()) return end("Invalid choice. Dial again.");

  // A repeated delivery of this same request gets the same details back.
  const resultKey = `${ctx.sessionId}|${userId}|${inputs.join("*")}`;
  const already = resultCache.get(resultKey);
  if (already) return end(already.screen);

  if (tooManyRequests(userId)) return end("Too many payment requests. Please try again later.");

  const charge = await createCharge({ email: ctx.member.email, amount, metadata, bank });
  if (charge.error) {
    return end("This payment option is not available right now. Please use the app or visit the office.");
  }
  noteRequest(userId);
  console.log(`[ussd] payment created type=${metadata.type} ref=${charge.reference || "n/a"}`);

  let screen;
  let sms;
  if (charge.kind === "ussd") {
    screen = `Dial ${charge.code} on this phone to pay ${naira(amount)}. Details sent by SMS.`;
    sms = `Exclusive Cooperative: To pay ${naira(amount)} (${purposeLabel}), dial ${charge.code} and follow the prompts.`;
  } else {
    const parts = [charge.accountNumber, charge.bankName, charge.accountName].filter(Boolean);
    screen = `Transfer exactly ${naira(amount)} to:\n${parts.join("\n")}\nValid ${expiryMinutes()} min. Details sent by SMS.`;
    sms = `Exclusive Cooperative: Transfer exactly ${naira(amount)} to ${parts.join(", ")} within ${expiryMinutes()} minutes for your ${purposeLabel.toLowerCase()}. Do not pay after it expires.`;
  }

  const phone = normalizeNgPhone(ctx.phoneNumber);
  if (phone) {
    sendSms(phone, sms).catch((err) => console.error("[ussd] payment SMS failed:", err?.message || err));
  }
  resultCache.set(resultKey, { screen });
  return end(screen);
}

// ---- savings top-up -----------------------------------------------------------
/** @param inputs everything typed AFTER choosing "Top up" in the menu */
export async function runTopUp(inputs, ctx) {
  let i = 0;
  if (i >= inputs.length) return con("Top up savings.\nEnter amount in NGN:");
  const amountInput = inputs[i++];
  if (amountInput === "0") return { back: true, used: i };
  if (!/^\d{1,9}$/.test(amountInput) || Number(amountInput) <= 0) return end("Invalid amount. Dial again.");
  const amount = Number(amountInput);

  return finishPayment(inputs, i, ctx, {
    amount,
    purposeLabel: "Savings top-up",
    metadata: { userId: String(ctx.member._id), type: "savings", platform: "ussd" },
    gateCall: { path: "/payments/paystack/initialize", body: { amount } },
  });
}

// ---- loan repayment -----------------------------------------------------------
export async function runRepayment(inputs, ctx) {
  const userId = ctx.member._id;
  let i = 0;

  // Same statuses as the app's own repayment check.
  const loans = await Loan.find({
    user: userId,
    status: { $in: ["active", "overdue"] },
    outstandingBalance: { $gt: 0 },
  })
    .sort({ createdAt: -1 })
    .limit(5)
    .select("outstandingBalance loanType")
    .lean();
  if (!loans.length) return end("You have no loan balance to repay.");

  let loan = loans[0];
  if (loans.length > 1) {
    if (i >= inputs.length) {
      return con(
        `Which loan?\n${loans.map((l, n) => `${n + 1}. ${l.loanType} ${naira(round2(l.outstandingBalance))}`).join("\n")}\n0. Cancel`
      );
    }
    const pick = inputs[i++];
    if (pick === "0") return { back: true, used: i };
    loan = /^[1-5]$/.test(pick) ? loans[Number(pick) - 1] : null;
    if (!loan) return end("Invalid choice. Dial again.");
  }
  const owing = round2(loan.outstandingBalance);

  if (i >= inputs.length) {
    return con(`Repay loan. You owe ${naira(owing)}.\n1. Pay full balance\n2. Enter an amount\n0. Cancel`);
  }
  const how = inputs[i++];
  if (how === "0") return { back: true, used: i };

  let amount;
  if (how === "1") {
    amount = owing;
  } else if (how === "2") {
    if (i >= inputs.length) return con("Enter amount in NGN:");
    const typed = inputs[i++];
    if (typed === "0") return { back: true, used: i };
    if (!/^\d{1,9}$/.test(typed) || Number(typed) <= 0) return end("Invalid amount. Dial again.");
    amount = Number(typed);
  } else {
    return end("Invalid choice. Dial again.");
  }

  return finishPayment(inputs, i, ctx, {
    amount,
    purposeLabel: "Loan repayment",
    metadata: {
      userId: String(userId),
      loanId: String(loan._id),
      type: "loan_repayment",
      platform: "ussd",
      custom_fields: [{ display_name: "Payment for", variable_name: "payment_for", value: "Loan repayment" }],
    },
    gateCall: { path: "/payments/paystack/loan-repayment/initialize", body: { loanId: String(loan._id), amount } },
  });
}
