import Loan from "../models/Loan.js";
import LoanRepayment from "../models/LoanRepayment.js";
import { runAtomic } from "./atomic.js";
import { repaymentPortions } from "./dividendMath.js";
import { postLoanRepayment } from "../services/ledger.js";
import { createNotificationAndPush } from "./createNotification.js";

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/**
 * Applies `amount` (naira) to a loan document: fills the repayment schedule
 * from the oldest unpaid instalment, adds to amountPaid, reduces the
 * outstanding balance and completes the loan when it reaches zero.
 *
 * Mutates `loan`; the caller saves it. Shared by the admin approval of a
 * manual repayment and by online (Paystack) payments, so both behave the same.
 */
export function applyPaymentToLoan(loan, amount, now = new Date()) {
  let remaining = amount;
  for (const installment of loan.repaymentSchedule) {
    if (remaining <= 0) break;
    if (installment.status === "paid") continue;

    const stillOwedOnThis = installment.amountDue - installment.amountPaid;
    const applied = Math.min(stillOwedOnThis, remaining);

    installment.amountPaid += applied;
    remaining -= applied;

    if (installment.amountPaid >= installment.amountDue) {
      installment.status = "paid";
      installment.paidDate = now;
    } else if (installment.amountPaid > 0) {
      installment.status = "partial";
    }
  }

  loan.amountPaid += amount;
  // Round to kobo so float drift can't leave a stray 0.0000001 that stops the
  // loan from ever reaching exactly zero.
  loan.outstandingBalance = Math.max(0, round2(loan.outstandingBalance - amount));

  if (loan.outstandingBalance === 0) {
    loan.status = "completed";
    loan.completedDate = now;
  }
  return loan;
}

/**
 * Records a verified Paystack loan repayment.
 *
 * Called from the app/website verify endpoint and from Paystack's webhook,
 * which can race and retry, so everything is idempotent on `reference`
 * (unique index) and written in ONE database transaction: the repayment
 * record, the loan balance and the ledger entry commit together or not at all.
 *
 * If the loan can no longer take the money (already cleared, cancelled) or the
 * payment is more than is owed, the unusable part is recorded with
 * needsRefund=true so the office can refund it. Nothing is silently lost.
 */
export async function creditPaystackLoanRepayment({ userId, loanId, amount, reference }) {
  const paid = round2(amount);

  const existingResult = async () => {
    const existing = await LoanRepayment.findOne({ reference });
    const loan = existing ? await Loan.findById(existing.loan) : null;
    return {
      alreadyProcessed: true,
      amount: existing?.amount ?? paid,
      overpaidAmount: existing?.overpaidAmount ?? 0,
      outstandingBalance: loan ? loan.outstandingBalance : null,
      loanStatus: loan ? loan.status : null,
      repayment: existing,
    };
  };

  let result;
  try {
    result = await runAtomic(async (session) => {
      const opts = session ? { session } : {};

      if (await LoanRepayment.findOne({ reference }, null, opts)) {
        return { duplicate: true };
      }

      const loan = await Loan.findOne({ _id: loanId, user: userId }, null, opts);
      if (!loan) {
        // Cannot tell which loan this belongs to; keep the money on record.
        const [orphan] = await LoanRepayment.create(
          [{
            loan: loanId,
            user: userId,
            amount: paid,
            status: "rejected",
            method: "paystack",
            reference,
            overpaidAmount: paid,
            needsRefund: true,
            note: "Loan not found for this payment.",
          }],
          opts
        );
        return { orphan, loan: null };
      }

      const open = ["active", "overdue"].includes(loan.status);
      const applied = open ? Math.min(paid, loan.outstandingBalance) : 0;
      const excess = round2(paid - applied);

      if (applied <= 0) {
        const [refundOnly] = await LoanRepayment.create(
          [{
            loan: loan._id,
            user: userId,
            amount: paid,
            status: "rejected",
            method: "paystack",
            reference,
            overpaidAmount: paid,
            needsRefund: true,
            note: "Loan was no longer open when this payment arrived.",
          }],
          opts
        );
        return { refundOnly, loan };
      }

      const portions = repaymentPortions(loan, applied);
      const now = new Date();

      const [repayment] = await LoanRepayment.create(
        [{
          loan: loan._id,
          user: userId,
          amount: applied,
          status: "approved",
          method: "paystack",
          reference,
          approvedAt: now,
          approvedBy: null,
          principalPortion: portions.principal,
          interestPortion: portions.interest,
          chargePortion: portions.charges,
          overpaidAmount: excess,
          needsRefund: excess > 0,
          note: excess > 0 ? "Paid more than was owed; the extra needs refunding." : "",
        }],
        opts
      );

      applyPaymentToLoan(loan, applied, now);
      await loan.save(opts);
      await postLoanRepayment({ loan, repayment, postedBy: null }, { session });

      return { repayment, loan, applied, excess };
    });
  } catch (err) {
    if (err?.code === 11000) return existingResult();
    throw err;
  }

  if (result.duplicate) return existingResult();

  // Notifications are outside the transaction on purpose: a push failure must
  // never roll back a recorded payment.
  const notify = async (title, message, type = "repayment") => {
    try {
      await createNotificationAndPush({
        user: userId,
        type,
        title,
        message,
        data: { reference, loanId: String(loanId) },
      });
    } catch (err) {
      console.error("Loan repayment notification error:", err.message);
    }
  };

  if (result.orphan || result.refundOnly) {
    console.error("[loan-repayment] payment could not be applied, needs refund:", reference, paid);
    await notify(
      "Loan Payment Needs Attention",
      `We received ₦${paid.toLocaleString()} but your loan could not take it. The cooperative office will refund it. Reference: ${reference}`
    );
    return {
      alreadyProcessed: false,
      amount: 0,
      overpaidAmount: paid,
      outstandingBalance: result.loan ? result.loan.outstandingBalance : null,
      loanStatus: result.loan ? result.loan.status : null,
      repayment: result.orphan || result.refundOnly,
    };
  }

  const { repayment, loan, applied, excess } = result;

  await notify(
    "Loan Repayment Successful",
    `Your loan repayment of ₦${applied.toLocaleString()} was successful. You now owe ₦${loan.outstandingBalance.toLocaleString()}.` +
      (excess > 0 ? ` ₦${excess.toLocaleString()} was more than you owed and will be refunded by the office.` : "")
  );

  if (loan.status === "completed") {
    await notify("Loan Completed", "Congratulations! Your loan has been fully repaid and marked as completed.", "loan");
  }

  return {
    alreadyProcessed: false,
    amount: applied,
    overpaidAmount: excess,
    outstandingBalance: loan.outstandingBalance,
    loanStatus: loan.status,
    repayment,
  };
}
