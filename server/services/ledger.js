import LedgerAccount from "../models/LedgerAccount.js";
import JournalEntry from "../models/JournalEntry.js";
import { toKobo, splitProportional } from "../utils/money.js";

/*
  Double-entry ledger service. Every money movement posts ONE balanced journal
  entry through postJournalEntry(). Amounts passed to the helper builders are
  naira (what the rest of the app uses); they are converted to integer kobo.

  Controlled by LEDGER_ENABLED=true so it can be switched off instantly.
  When off, every post* helper is a no-op.
*/

export const ACCOUNTS = {
  BANK: "1000",
  LOANS_RECEIVABLE: "1100",
  MEMBER_SAVINGS: "2000",
  DIVIDEND_PAYABLE: "2100",
  LOAN_PROCEEDS_PAYABLE: "2150",
  OPENING_BALANCE: "3100",
  LOAN_INTEREST_INCOME: "4000",
  OVERDUE_CHARGES_INCOME: "4100",
  WITHDRAWAL_FEE_INCOME: "4200",
  DIVIDENDS_DISTRIBUTED: "5000",
};

export const DEFAULT_ACCOUNTS = [
  { code: "1000", name: "Bank - Operating / Paystack", type: "asset", normalBalance: "debit" },
  { code: "1100", name: "Loans Receivable (Principal)", type: "asset", normalBalance: "debit" },
  { code: "2000", name: "Member Savings", type: "liability", normalBalance: "credit" },
  { code: "2100", name: "Dividend Payable", type: "liability", normalBalance: "credit" },
  { code: "2150", name: "Loan Proceeds Payable to Members", type: "liability", normalBalance: "credit" },
  { code: "3100", name: "Opening Balance Equity", type: "equity", normalBalance: "credit" },
  { code: "4000", name: "Loan Interest Income", type: "income", normalBalance: "credit" },
  { code: "4100", name: "Overdue Charges Income", type: "income", normalBalance: "credit" },
  { code: "4200", name: "Withdrawal Fee Income", type: "income", normalBalance: "credit" },
  { code: "5000", name: "Dividends Distributed", type: "expense", normalBalance: "debit" },
];

export const ledgerEnabled = () => process.env.LEDGER_ENABLED === "true";

export async function ensureChartOfAccounts(tenantId = "default") {
  for (const a of DEFAULT_ACCOUNTS) {
    await LedgerAccount.updateOne(
      { tenantId, code: a.code },
      { $setOnInsert: { ...a, tenantId } },
      { upsert: true }
    );
  }
}

/**
 * Posts one balanced entry. Idempotent on `reference`: posting the same
 * reference twice returns the original entry instead of creating another.
 * Pass `session` to make the post part of a surrounding transaction.
 * @returns {{entry: object, duplicate: boolean}}
 */
export async function postJournalEntry(
  { reference, description, sourceType, sourceId = "", lines, postedBy = null, reversalOf = null, tenantId = "default" },
  { session = null } = {}
) {
  const opts = session ? { session } : {};
  const existing = await JournalEntry.findOne({ tenantId, reference }, null, opts);
  if (existing) return { entry: existing, duplicate: true };

  const clean = lines
    .filter((l) => (l.debit || 0) > 0 || (l.credit || 0) > 0)
    .map((l) => ({ debit: 0, credit: 0, ...l }));

  const [entry] = await JournalEntry.create(
    [{ tenantId, reference, description, sourceType, sourceId: String(sourceId), lines: clean, postedBy, reversalOf }],
    opts
  );
  return { entry, duplicate: false };
}

const noop = { entry: null, duplicate: false, skipped: true };

/** Member contribution (Paystack top-up or admin-approved transfer). */
export async function postSavingsDeposit({ userId, amount, reference, method = "paystack", postedBy }, ctx) {
  if (!ledgerEnabled()) return noop;
  const k = toKobo(amount);
  return postJournalEntry(
    {
      reference: `savings:${reference}`,
      description: `Member savings deposit (${method})`,
      sourceType: "savings",
      sourceId: reference,
      postedBy,
      lines: [
        { account: ACCOUNTS.BANK, debit: k },
        { account: ACCOUNTS.MEMBER_SAVINGS, credit: k, user: userId },
      ],
    },
    ctx
  );
}

/** Loan approved for disbursement: member now owes it, funds are payable to them until withdrawn. */
export async function postLoanDisbursement({ loan, postedBy }, ctx) {
  if (!ledgerEnabled()) return noop;
  const k = toKobo(loan.amount);
  return postJournalEntry(
    {
      reference: `loan-disbursement:${loan._id}`,
      description: "Loan disbursed (funds available to member)",
      sourceType: "loan",
      sourceId: loan._id,
      postedBy,
      lines: [
        { account: ACCOUNTS.LOANS_RECEIVABLE, debit: k, user: loan.user },
        { account: ACCOUNTS.LOAN_PROCEEDS_PAYABLE, credit: k, user: loan.user },
      ],
    },
    ctx
  );
}

/** Repayment split pro-rata across principal, interest and overdue charges. */
export async function postLoanRepayment({ loan, repayment, postedBy }, ctx) {
  if (!ledgerEnabled()) return noop;
  const total = toKobo(repayment.amount);
  const principal = Number(loan.amount || 0);
  const interest = Math.max(0, Number(loan.totalRepayment || 0) - principal);
  const charges = Math.max(0, Number(loan.overdueChargeTotal || 0));
  const [pK, iK, cK] = splitProportional(total, [principal, interest, charges]);
  return postJournalEntry(
    {
      reference: `loan-repayment:${repayment._id}`,
      description: "Loan repayment received",
      sourceType: "repayment",
      sourceId: repayment._id,
      postedBy,
      lines: [
        { account: ACCOUNTS.BANK, debit: total },
        { account: ACCOUNTS.LOANS_RECEIVABLE, credit: pK, user: loan.user },
        { account: ACCOUNTS.LOAN_INTEREST_INCOME, credit: iK, user: loan.user },
        { account: ACCOUNTS.OVERDUE_CHARGES_INCOME, credit: cK, user: loan.user },
      ],
    },
    ctx
  );
}

/** Cash actually leaves the bank: a successful withdrawal. */
export async function postWithdrawalPaid({ withdrawal }, ctx) {
  if (!ledgerEnabled()) return noop;
  const amount = toKobo(withdrawal.amount);
  const isLoan = (withdrawal.source || "savings") === "loan";
  const fee = isLoan ? 0 : toKobo(withdrawal.administrativeFee || 0);
  return postJournalEntry(
    {
      reference: `withdrawal:${withdrawal._id}`,
      description: isLoan ? "Loan funds withdrawn by member" : "Savings withdrawal paid",
      sourceType: "withdrawal",
      sourceId: withdrawal._id,
      lines: [
        {
          account: isLoan ? ACCOUNTS.LOAN_PROCEEDS_PAYABLE : ACCOUNTS.MEMBER_SAVINGS,
          debit: amount + fee,
          user: withdrawal.user,
        },
        { account: ACCOUNTS.BANK, credit: amount },
        { account: ACCOUNTS.WITHDRAWAL_FEE_INCOME, credit: fee },
      ],
    },
    ctx
  );
}

/** One dividend entry paid out to a member. */
export async function postDividendPayout({ entry, postedBy }, ctx) {
  if (!ledgerEnabled()) return noop;
  const k = toKobo(entry.dividendAmount);
  return postJournalEntry(
    {
      reference: `dividend:${entry._id}`,
      description: "Dividend paid to member",
      sourceType: "dividend",
      sourceId: entry._id,
      postedBy,
      lines: [
        { account: ACCOUNTS.DIVIDENDS_DISTRIBUTED, debit: k, user: entry.user },
        { account: ACCOUNTS.BANK, credit: k },
      ],
    },
    ctx
  );
}

/** Reverses an entry with a mirror-image entry (never edits the original). */
export async function reverseEntry(entryId, { reason = "", postedBy = null } = {}, ctx) {
  const original = await JournalEntry.findById(entryId);
  if (!original) throw new Error("Journal entry not found.");
  return postJournalEntry(
    {
      reference: `reversal:${original._id}`,
      description: `Reversal of ${original.reference}${reason ? `: ${reason}` : ""}`,
      sourceType: "reversal",
      sourceId: original._id,
      postedBy,
      reversalOf: original._id,
      lines: original.lines.map((l) => ({
        account: l.account,
        debit: l.credit,
        credit: l.debit,
        user: l.user,
      })),
    },
    ctx
  );
}

/** Trial balance: per-account debit/credit totals (kobo) plus a balanced check. */
export async function trialBalance({ tenantId = "default", asOf } = {}) {
  const match = { tenantId };
  if (asOf) match.postedAt = { $lte: new Date(asOf) };
  const rows = await JournalEntry.aggregate([
    { $match: match },
    { $unwind: "$lines" },
    { $group: { _id: "$lines.account", debit: { $sum: "$lines.debit" }, credit: { $sum: "$lines.credit" } } },
    { $sort: { _id: 1 } },
  ]);
  const accounts = await LedgerAccount.find({ tenantId }).lean();
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const out = rows.map((r) => {
    const a = byCode.get(r._id) || {};
    const net = a.normalBalance === "credit" ? r.credit - r.debit : r.debit - r.credit;
    return { code: r._id, name: a.name || r._id, type: a.type, debit: r.debit, credit: r.credit, balance: net };
  });
  const totalDebit = out.reduce((s, r) => s + r.debit, 0);
  const totalCredit = out.reduce((s, r) => s + r.credit, 0);
  return { accounts: out, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}
