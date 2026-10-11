// One-off: stamps repayments that were approved BEFORE per-repayment interest
// was recorded, so dividends use stored figures instead of derived ones.
//
//   node scripts/freezeRepaymentInterest.js          -> dry run (counts only)
//   node scripts/freezeRepaymentInterest.js --apply  -> writes the split
//
// approvedAt <- the record's updatedAt (the approval was its last write).
// The split uses the loan's CURRENT terms, so a repayment approved while a
// different overdue-charge total applied may differ by a small amount. Review
// the dry-run count, back up the database, and run on staging first.
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import LoanRepayment from "../models/LoanRepayment.js";
import Loan from "../models/Loan.js";
import { repaymentPortions } from "../utils/dividendMath.js";

const apply = process.argv.includes("--apply");
await connectDB();

let todo = 0;
let done = 0;
let orphaned = 0;

for await (const r of LoanRepayment.find({ status: "approved", interestPortion: null })) {
  todo++;
  const loan = await Loan.findById(r.loan).select("amount totalRepayment overdueChargeTotal user").lean();
  if (!loan || String(loan.user) !== String(r.user)) {
    orphaned++;
    continue;
  }
  if (!apply) continue;
  const p = repaymentPortions(loan, r.amount);
  await LoanRepayment.updateOne(
    { _id: r._id, interestPortion: null },
    {
      $set: {
        approvedAt: r.approvedAt || r.updatedAt,
        principalPortion: p.principal,
        interestPortion: p.interest,
        chargePortion: p.charges,
      },
    },
    { timestamps: false }
  );
  done++;
}

console.log(
  `${todo} approved repayments have no stored interest. ` +
    (apply ? `Stamped ${done}. ` : "Dry run - nothing written. ") +
    `${orphaned} skipped (missing or mismatched loan).`
);
if (!apply) console.log("Re-run with --apply to write.");
await mongoose.disconnect();
