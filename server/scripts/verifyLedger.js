// Read-only health check. Exits non-zero if anything disagrees, so it can run
// from a scheduler/CI:  node scripts/verifyLedger.js
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import Withdrawal from "../models/Withdrawal.js";
import SavingsTransaction from "../models/SavingsTransaction.js";
import JournalEntry from "../models/JournalEntry.js";
import { ACCOUNTS, trialBalance } from "../services/ledger.js";
import { toKobo } from "../utils/money.js";

await connectDB();
const problems = [];

// 1. The books balance.
const tb = await trialBalance();
if (!tb.balanced) problems.push(`Trial balance is out: debit ${tb.totalDebit} != credit ${tb.totalCredit} (kobo).`);

// 2. Per-member: ledger savings == savingsBalance - successful savings withdrawals.
const ledgerByUser = new Map(
  (
    await JournalEntry.aggregate([
      { $unwind: "$lines" },
      { $match: { "lines.account": ACCOUNTS.MEMBER_SAVINGS } },
      { $group: { _id: "$lines.user", net: { $sum: { $subtract: ["$lines.credit", "$lines.debit"] } } } },
    ])
  ).map((r) => [String(r._id), r.net])
);
const paid = new Map(
  (
    await Withdrawal.aggregate([
      { $match: { status: "success", source: "savings" } },
      { $group: { _id: "$user", total: { $sum: "$totalDeduction" } } },
    ])
  ).map((r) => [String(r._id), r.total])
);
let mismatches = 0;
for await (const u of User.find({ role: { $ne: "admin" } }).select("savingsBalance fullName")) {
  const expected = Math.max(0, toKobo(u.savingsBalance) - toKobo(paid.get(String(u._id)) || 0));
  const actual = ledgerByUser.get(String(u._id)) || 0;
  if (expected !== actual) {
    mismatches++;
    if (mismatches <= 20)
      problems.push(`${u.fullName}: database says N${expected / 100}, ledger says N${actual / 100}`);
  }
}
if (mismatches > 20) problems.push(`...and ${mismatches - 20} more member mismatches.`);

// 3. Approved savings / successful withdrawals that never reached the ledger.
const approved = await SavingsTransaction.find({ status: "approved" }).select("_id reference");
const refs = new Set((await JournalEntry.find({ sourceType: "savings" }).select("sourceId")).map((e) => e.sourceId));
const missingSavings = approved.filter((t) => !refs.has(String(t.reference || t._id))).length;
if (missingSavings) problems.push(`${missingSavings} approved savings transactions have no ledger entry (expected for pre-backfill history).`);

const wRefs = new Set((await JournalEntry.find({ sourceType: "withdrawal" }).select("sourceId")).map((e) => e.sourceId));
const missingW = (await Withdrawal.find({ status: "success" }).select("_id")).filter((w) => !wRefs.has(String(w._id))).length;
if (missingW) problems.push(`${missingW} successful withdrawals have no ledger entry (expected for pre-backfill history).`);

if (problems.length) {
  console.log("LEDGER CHECK: attention needed\n - " + problems.join("\n - "));
  await mongoose.disconnect();
  process.exit(1);
}
console.log("LEDGER CHECK: all clear.");
await mongoose.disconnect();
