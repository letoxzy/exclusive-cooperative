import mongoose from "mongoose";

/*
  Append-only double-entry journal. Amounts are integer kobo.
  - Every entry must balance (sum of debits === sum of credits).
  - `reference` is unique per tenant, so a retried webhook/approval cannot
    post the same event twice.
  - Entries are never edited or deleted; corrections are new entries that
    point at the original through `reversalOf`.
*/

const lineSchema = new mongoose.Schema(
  {
    account: { type: String, required: true }, // LedgerAccount.code
    debit: { type: Number, default: 0, min: 0 },
    credit: { type: Number, default: 0, min: 0 },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    memo: { type: String, default: "" },
  },
  { _id: false }
);

const journalEntrySchema = new mongoose.Schema(
  {
    tenantId: { type: String, default: "default" },
    reference: { type: String, required: true },
    description: { type: String, required: true },
    sourceType: { type: String, required: true }, // e.g. savings, repayment
    sourceId: { type: String, default: "" },
    lines: { type: [lineSchema], validate: (v) => v.length >= 2 },
    totalKobo: { type: Number, required: true },
    postedAt: { type: Date, default: Date.now },
    postedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reversalOf: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry", default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

journalEntrySchema.index({ tenantId: 1, reference: 1 }, { unique: true });
journalEntrySchema.index({ "lines.account": 1, postedAt: -1 });
journalEntrySchema.index({ "lines.user": 1 });

journalEntrySchema.pre("validate", function (next) {
  let debit = 0;
  let credit = 0;
  for (const l of this.lines) {
    if (!Number.isInteger(l.debit) || !Number.isInteger(l.credit)) {
      return next(new Error("Ledger amounts must be integer kobo."));
    }
    if ((l.debit > 0) === (l.credit > 0)) {
      return next(new Error("Each ledger line needs exactly one of debit or credit."));
    }
    debit += l.debit;
    credit += l.credit;
  }
  if (debit !== credit) {
    return next(new Error(`Unbalanced journal entry (debit ${debit} != credit ${credit}).`));
  }
  this.totalKobo = debit;
  next();
});

journalEntrySchema.pre("save", function (next) {
  if (!this.isNew) return next(new Error("Journal entries are immutable."));
  next();
});

const blocked = (next) => next(new Error("Journal entries are immutable."));
[
  "updateOne", "updateMany", "findOneAndUpdate", "findOneAndReplace",
  "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete",
].forEach((op) => journalEntrySchema.pre(op, blocked));

export default mongoose.model("JournalEntry", journalEntrySchema);
