import crypto from "crypto";
import { callInternal } from "./internalApi.js";
import { ALLOWED_LOAN_TYPES, ALLOWED_TERMS, calculateLoanTerms } from "../routes/loanRoutes.js";

/**
 * Loan limit + loan application over USSD (menu option 6).
 *
 * Like the other USSD features this does NOT re-implement any loan rule:
 *   - what the member may borrow comes from GET /api/loans/eligibility (the
 *     same endpoint the website and the app use),
 *   - the request is submitted with POST /api/loans (same checks: approved Full
 *     Loan Application, savings x multiplier limit, one open loan at a time,
 *     idempotency),
 *   - interest and total repayment are calculated by the same
 *     calculateLoanTerms() the route uses, so the screen can never disagree
 *     with the saved loan.
 * The member's 6-digit PIN is verified on every USSD request already; the
 * mobile app's extra PIN box is not needed here.
 *
 * What USSD cannot do: the Full Loan Application (BVN / face check) - the
 * member still does that once in the app or on the website. Money is not paid
 * out by this request; an admin still reviews it. Withdrawing loan money is in
 * the Withdraw option ("Loan funds").
 *
 * Off (option 6 stays the old read-only loan limit) unless USSD_LOANS_ENABLED=true.
 *
 * Screens: limit -> 1. Apply -> type -> amount -> period -> purpose -> confirm.
 * "0" cancels back to the main menu.
 */

export const loansEnabled = () =>
  String(process.env.USSD_LOANS_ENABLED || "").toLowerCase() === "true";

const naira = (n) => `NGN ${Number(n || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
const con = (text) => ({ type: "con", text });
const end = (text) => ({ type: "end", text });

// Labels for the loan types the backend accepts (anything it does not accept
// is simply not offered).
const TYPES = [
  { value: "emergency", label: "Emergency" },
  { value: "business", label: "Business" },
  { value: "personal", label: "Personal" },
].filter((t) => ALLOWED_LOAN_TYPES.includes(t.value));

// A phone keypad is poor for typing words, so the purpose is picked from a list
// (the app asks for free text; the cooperative sees this text on the request).
const PURPOSES = ["Business", "School fees", "Medical", "Rent", "Family needs", "Other"];

/**
 * @param inputs everything the member typed AFTER choosing option 6
 * @param ctx    { member, phoneNumber, sessionId }
 * @returns {{type:"con"|"end", text:string} | {back:true, used:number}}
 */
export async function runLoanLimit(inputs, ctx) {
  const userId = ctx.member._id;
  let i = 0;
  const more = () => i < inputs.length;
  const take = () => inputs[i++];
  const cancelled = () => ({ back: true, used: i }); // i is already past the "0"
  const invalid = () => end("Invalid choice. Dial again.");

  const eligibilityRes = await callInternal(userId, "GET", "/loans/eligibility");
  if (!eligibilityRes.ok || !eligibilityRes.data) {
    return end(eligibilityRes.data?.message || "Loan details are unavailable right now. Please try later.");
  }
  const e = eligibilityRes.data;
  const eligibleAmount = Number(e.eligibleAmount || 0);
  const limitLine = `Loan limit: ${naira(eligibleAmount)}`;

  // Cannot apply: show why, then back to the menu.
  if (!e.canApply) {
    let reason;
    if (!e.isLoanEligible) reason = "Your Full Loan Application is not yet approved. Apply in the app or on the website.";
    else if (e.hasPendingApplication) reason = "Your loan application is awaiting review.";
    else if (e.hasActiveLoan) reason = "You already have an open loan.";
    else reason = "Save more to qualify for a loan.";

    if (!more()) return con(`${limitLine}\n${reason}\n0. Main menu`);
    return take() === "0" ? cancelled() : invalid();
  }

  // Limit screen with the apply option.
  if (!more()) return con(`${limitLine}\n1. Apply for a loan\n0. Main menu`);
  const start = take();
  if (start === "0") return cancelled();
  if (start !== "1") return invalid();

  // 1. type
  if (!more()) {
    return con(`Loan type:\n${TYPES.map((t, n) => `${n + 1}. ${t.label}`).join("\n")}\n0. Cancel`);
  }
  const typeInput = take();
  if (typeInput === "0") return cancelled();
  const type = /^\d$/.test(typeInput) ? TYPES[Number(typeInput) - 1] : null;
  if (!type) return invalid();

  // 2. amount
  if (!more()) return con(`Enter loan amount in NGN (max ${naira(eligibleAmount)}):`);
  const amountInput = take();
  if (amountInput === "0") return cancelled();
  if (!/^\d{1,9}$/.test(amountInput) || Number(amountInput) <= 0) return end("Invalid amount. Dial again.");
  const amount = Number(amountInput);
  if (amount > eligibleAmount) return end(`You can apply for a maximum of ${naira(eligibleAmount)}.`);

  // 3. repayment period (rates come from the backend's own calculation)
  const interestFree = e.membershipType === "interest-free";
  const terms = ALLOWED_TERMS.map((months) => ({
    months,
    rate: calculateLoanTerms(amount, months, e.membershipType).interestRate,
  }));
  if (!more()) {
    const lines = terms.map((t, n) => `${n + 1}. ${t.months} months${interestFree ? "" : ` (${t.rate}% interest)`}`);
    return con(`Repay over:\n${lines.join("\n")}\n0. Cancel`);
  }
  const termInput = take();
  if (termInput === "0") return cancelled();
  const term = /^\d$/.test(termInput) ? terms[Number(termInput) - 1] : null;
  if (!term) return invalid();

  // 4. purpose
  if (!more()) {
    return con(`Loan purpose:\n${PURPOSES.map((p, n) => `${n + 1}. ${p}`).join("\n")}\n0. Cancel`);
  }
  const purposeInput = take();
  if (purposeInput === "0") return cancelled();
  const purpose = /^\d$/.test(purposeInput) ? PURPOSES[Number(purposeInput) - 1] : null;
  if (!purpose) return invalid();

  // 5. confirm
  const { totalRepayment } = calculateLoanTerms(amount, term.months, e.membershipType);
  if (!more()) {
    return con(
      `${type.label} loan ${naira(amount)} over ${term.months} months${interestFree ? "" : ` at ${term.rate}%`}.\nTotal repayment: ${naira(totalRepayment)}\n1. Confirm\n2. Cancel`
    );
  }
  const confirm = take();
  if (confirm === "2" || confirm === "0") return cancelled();
  if (confirm !== "1") return invalid();
  if (more()) return invalid();

  // Same intent in the same session always gets the same key, so a repeated
  // delivery of this request can never create two applications.
  const idempotencyKey = `ussd-loan-${crypto
    .createHash("sha256")
    .update(`${ctx.sessionId}|${userId}|${inputs.join("*")}`)
    .digest("hex")
    .slice(0, 40)}`;

  const result = await callInternal(userId, "POST", "/loans", {
    idempotencyKey,
    body: { loanType: type.value, amount, termMonths: term.months, purpose },
  });

  if (result.uncertain) {
    return end("We could not confirm your application. Check Loan status before trying again.");
  }
  if (!result.ok) {
    return end(result.data?.message || "We could not submit your loan application.");
  }

  // The route already created the in-app notification (and its push/SMS copy).
  return end(`Loan application of ${naira(amount)} submitted. You will be notified once it has been reviewed.`);
}
