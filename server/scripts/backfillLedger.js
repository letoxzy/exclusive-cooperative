// One-off: turns today's balances into OPENING journal entries so the ledger
// starts in agreement with the database. Safe to re-run (idempotent references).
//
//   node scripts/backfillLedger.js          -> dry run (prints what it would post)
//   node scripts/backfillLedger.js --apply  -> posts the entries
//
// Run it on a STAGING COPY first, with a database backup taken.
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import Loan from "../models/Loan.js";
import Withdrawal from "../models/Withdrawal.js";
import JournalEntry from "../models/JournalEntry.js";
import { ACCOUNTS, ensureChartOfAccounts, postJournalEntry } from "../services/ledger.js";
import { toKobo } from "../utils/money.js";

const apply = process.argv.includes("--apply");
const openingDate = new Date();

await connectDB();
await ensureChartOfAccounts();

let posted = 0;
let skipped = 0;
let totalSavingsKobo = 0;

// ---- Member savings -------------------------------------------------------
// savingsBalance is the GROSS of all contributions; successful savings
// withdrawals are tracked separately and never reduce it. The ledger's
// Member Savings account IS reduced by withdrawals, so the opening balance is
// gross contributions minus what has already been paid out.
const paid = await Withdrawal.aggregate([
  { $match: { status: "success", source: "savings" } },
  { $group: { _id: "$user", total: { $sum: "$totalDeduction" } } },
]);
const paidByUser = new Map(paid.map((r) => [String(r._id), r.total]));

for await (const u of User.find({ role: { $ne: "admin" }, savingsBalance: { $gt: 0 } }).select("savingsBalance fullName")) {
  const net = toKobo(u.savingsBalance) - toKobo(paidByUser.get(String(u._id)) || 0);
  if (net <= 0) continue;
  totalSavingsKobo += net;
  const reference = `opening:savings:${u._id}`;
  if (!apply) { posted++; continue; }
  const { duplicate } = await postJournalEntry({
    reference,
    description: "Opening balance - member savings",
    sourceType: "opening",
    sourceId: String(u._id),
    lines: [
      { account: ACCOUNTS.BANK, debit: net },
      { account: ACCOUNTS.MEMBER_SAVINGS, credit: net, user: u._id },
    ],
  });
  duplicate ? skipped++ : posted++;
}

// ---- Active loans ---------------------------------------------------------
// Receivable = what the member still owes (outstandingBalance). Loan funds
// not yet withdrawn are owed TO the member; the difference is opening equity.
for await (const loan of Loan.find({ status: { $in: ["active", "overdue", "defaulted"] }, outstandingBalance: { $gt: 0 } })) {
  const receivable = toKobo(loan.outstandingBalance);
  const available = toKobo(Math.max(0, loan.amount - (loan.loanFundsWithdrawn || 0) - (loan.loanFundsReserved || 0)));
  const diff = receivable - available;
  const lines = [
    { account: ACCOUNTS.LOANS_RECEIVABLE, debit: receivable, user: loan.user },
    { account: ACCOUNTS.LOAN_PROCEEDS_PAYABLE, credit: available, user: loan.user },
    diff >= 0
      ? { account: ACCOUNTS.OPENING_BALANCE, credit: diff }
      : { account: ACCOUNTS.OPENING_BALANCE, debit: -diff },
  ];
  if (!apply) { posted++; continue; }
  const { duplicate } = await postJournalEntry({
    reference: `opening:loan:${loan._id}`,
    description: "Opening balance - active loan",
    sourceType: "opening",
    sourceId: String(loan._id),
    lines,
  });
  duplicate ? skipped++ : posted++;
}

console.log(
  `${apply ? "Posted" : "Would post"} ${posted} entries` +
    (apply ? `, skipped ${skipped} already present` : "") +
    `. Member savings opening total: N${(totalSavingsKobo / 100).toLocaleString()}`
);
if (!apply) console.log("Dry run only. Re-run with --apply to post.");
await mongoose.disconnect();
