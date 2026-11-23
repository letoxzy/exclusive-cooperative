import express from "express";
import mongoose from "mongoose";
import { randomUUID } from "crypto";
import User from "../models/User.js";
import SavingsTransaction from "../models/SavingsTransaction.js";
import JournalEntry from "../models/JournalEntry.js";
import Withdrawal from "../models/Withdrawal.js";
import { protect } from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/adminMiddleware.js";
import { requirePermission } from "../middleware/adminPermission.js";
import { audit } from "../utils/audit.js";
import { runAtomic } from "../utils/atomic.js";
import { postSavingsDeposit, reverseEntry, ledgerEnabled } from "../services/ledger.js";
import {
  getContributionWindow,
  getMemberContributionFrequency,
  WITHDRAWABLE_PERCENTAGE,
} from "../utils/contributionRules.js";
import { createNotificationAndPush } from "../utils/createNotification.js";
import {
  buildReferenceKey,
  escapeRegex,
  isCurrentMonthKey,
  lagosNoon,
  looksLikeEmail,
  parseAmount,
  parseContributionDate,
  phoneTail,
  splitContribution,
  todayLagosKey,
} from "../utils/manualContribution.js";

/**
 * Contributions members paid by hand (Excel / paper register) before online
 * payments went live. Each one is recorded exactly like a normal approved
 * contribution, on the date it was really paid:
 *   - a savings record (so it shows in the member's history),
 *   - the member's savings balance goes up,
 *   - the ledger entry is posted,
 * all together or not at all. Contributions dated this month count toward
 * this month's 40% withdrawal, like any other contribution.
 */

const router = express.Router();
router.use(protect, adminOnly);

const MAX_IMPORT_ROWS = 300;
const MEMBER_FIELDS =
  "fullName email phone isApprovedMember isBlocked savingsBalance contributionFrequency role";

const naira = (value) =>
  `₦${Number(value || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const prettyDate = (key) => {
  const [y, m, d] = String(key).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

/* ----------------------------- member lookup ----------------------------- */

async function findMemberByIdentifier(identifier) {
  const raw = String(identifier ?? "").trim();
  if (!raw) return { error: "Email or phone is missing." };

  let users;
  if (looksLikeEmail(raw)) {
    users = await User.find({ email: raw.toLowerCase(), role: { $ne: "admin" } })
      .select(MEMBER_FIELDS)
      .limit(2);
  } else {
    const tail = phoneTail(raw);
    if (!tail) return { error: `"${raw}" is not an email or a phone number.` };
    // Phone numbers are stored as typed, so allow spaces or dashes between digits.
    const pattern = `${tail.split("").join("[\\s-]*")}$`;
    users = await User.find({ phone: { $regex: pattern }, role: { $ne: "admin" } })
      .select(MEMBER_FIELDS)
      .limit(2);
  }

  if (users.length === 0) return { error: "No member found with that email or phone." };
  if (users.length > 1) return { error: "More than one member matches. Use the email instead." };
  return { member: users[0] };
}

/* ------------------------------ row checking ----------------------------- */

/**
 * Checks one row without writing anything. Both the preview and the real
 * import use this, so what you preview is exactly what gets imported.
 */
async function checkRow(raw, memberCache) {
  const identifier = String(raw?.identifier ?? raw?.email ?? raw?.phone ?? "").trim();

  const amountResult = parseAmount(raw?.amount);
  if (amountResult.error) return { error: amountResult.error, identifier };

  const dateResult = parseContributionDate(raw?.date);
  if (dateResult.error) return { error: dateResult.error, identifier };

  let found = memberCache.get(identifier.toLowerCase());
  if (!found) {
    found = raw?.memberId && mongoose.isValidObjectId(raw.memberId)
      ? await User.findOne({ _id: raw.memberId, role: { $ne: "admin" } }).select(MEMBER_FIELDS).then(
          (member) => (member ? { member } : { error: "Member not found." }),
        )
      : await findMemberByIdentifier(identifier);
    if (identifier) memberCache.set(identifier.toLowerCase(), found);
  }
  if (found.error) return { error: found.error, identifier };

  const { member } = found;
  const reference = String(raw?.reference ?? "").trim();
  const note = String(raw?.note ?? "").trim().slice(0, 200);
  const key = buildReferenceKey({
    memberId: String(member._id),
    dateKey: dateResult.key,
    amount: amountResult.amount,
    reference,
  });

  return {
    member,
    identifier,
    amount: amountResult.amount,
    dateKey: dateResult.key,
    reference,
    note,
    key,
    withdrawableThisMonth: isCurrentMonthKey(dateResult.key),
  };
}

/** Checks every row and marks ones already recorded (in the database or earlier in the same list). */
async function checkRows(rows) {
  const memberCache = new Map();
  const checked = [];
  for (const raw of rows) checked.push(await checkRow(raw, memberCache));

  const keys = checked.filter((c) => c.key).map((c) => c.key);
  const existing = keys.length
    ? new Set(
        (await SavingsTransaction.find({ reference: { $in: keys } }).select("reference").lean()).map(
          (t) => t.reference,
        ),
      )
    : new Set();

  const seen = new Map();
  return checked.map((c, index) => {
    const row = index + 1;
    if (c.error) return { row, status: "error", message: c.error, identifier: c.identifier };

    if (existing.has(c.key)) {
      return { ...c, row, status: "duplicate", message: "Already recorded. This row was skipped." };
    }
    if (seen.has(c.key)) {
      return {
        ...c,
        row,
        status: "duplicate",
        message: `Same as row ${seen.get(c.key)}. Add a reference (for example the receipt number) if it is a separate payment.`,
      };
    }
    seen.set(c.key, row);
    return { ...c, row, status: "ok", message: "" };
  });
}

const publicRow = (r) => ({
  row: r.row,
  status: r.status,
  message: r.message,
  identifier: r.identifier || "",
  memberName: r.member?.fullName || "",
  memberId: r.member ? String(r.member._id) : "",
  approvedMember: r.member ? Boolean(r.member.isApprovedMember) : undefined,
  amount: r.amount ?? null,
  date: r.dateKey || "",
  savingsBalance: r.savingsBalance ?? null,
  withdrawableThisMonth: Boolean(r.withdrawableThisMonth),
});

const summarize = (results) => {
  const ok = results.filter((r) => r.status === "ok" || r.status === "saved");
  return {
    total: results.length,
    ok: ok.length,
    duplicates: results.filter((r) => r.status === "duplicate").length,
    errors: results.filter((r) => r.status === "error" || r.status === "failed").length,
    totalAmount: Math.round(ok.reduce((sum, r) => sum + (r.amount || 0), 0) * 100) / 100,
    members: new Set(ok.map((r) => r.memberId || String(r.member?._id))).size,
    withdrawableThisMonth:
      Math.round(
        ok.filter((r) => r.withdrawableThisMonth).reduce((sum, r) => sum + (r.amount || 0), 0) * 100,
      ) / 100,
  };
};

/* -------------------------------- recording ------------------------------ */

async function recordOne({ member, amount, dateKey, note, key, batchId, admin }) {
  const { lockedAmount, withdrawalAmount } = splitContribution(amount);
  const frequency = await getMemberContributionFrequency(member);
  const when = lagosNoon(dateKey);
  const contributionPeriod = getContributionWindow(frequency, when).periodKey;

  return runAtomic(async (session) => {
    const opts = session ? { session } : {};

    const [txn] = await SavingsTransaction.create(
      [
        {
          user: member._id,
          amount,
          status: "approved",
          method: "manual",
          reference: key,
          note: `Manual contribution recorded by the office${note ? `: ${note}` : ""}`,
          lockedAmount,
          withdrawalAmount,
          contributionFrequency: frequency,
          contributionPeriod,
          source: "manual-entry",
          recordedBy: admin._id,
          batchId,
          createdAt: when,
        },
      ],
      opts,
    );

    // Atomic $inc, never read-modify-write.
    const updated = await User.findByIdAndUpdate(
      member._id,
      { $inc: { savingsBalance: amount } },
      { new: true, ...opts },
    );

    // Same ledger entry as an office-approved contribution. The reference is
    // the duplicate-proof key, which is also what the ledger check looks for.
    await postSavingsDeposit(
      { userId: member._id, amount, reference: key, method: "manual", postedBy: admin._id },
      { session },
    );

    return { txn, savingsBalance: updated?.savingsBalance ?? null };
  });
}

async function notifyMember(memberId, entries, savingsBalance) {
  try {
    const total = Math.round(entries.reduce((sum, e) => sum + e.amount, 0) * 100) / 100;
    const thisMonth =
      Math.round(
        entries.filter((e) => isCurrentMonthKey(e.dateKey)).reduce((sum, e) => sum + e.amount, 0) * 100,
      ) / 100;

    const base =
      entries.length === 1
        ? `The cooperative office recorded your contribution of ${naira(total)} dated ${prettyDate(entries[0].dateKey)}.`
        : `The cooperative office recorded ${entries.length} of your contributions, totalling ${naira(total)}.`;
    const balance = savingsBalance != null ? ` Your savings balance is now ${naira(savingsBalance)}.` : "";
    const withdraw =
      thisMonth > 0
        ? ` You can withdraw up to ${naira(thisMonth * 0.4)} (40%) of this month's contributions.`
        : "";

    await createNotificationAndPush({
      user: memberId,
      type: "savings",
      title: "Contribution Recorded",
      message: `${base}${balance}${withdraw}`,
      data: {
        kind: "manual-contribution",
        sms: false, // in-app and push only; never a text message
        amount: total,
        count: entries.length,
        ...(entries.length === 1 && entries[0].transactionId
          ? { transactionId: String(entries[0].transactionId) }
          : {}),
      },
    });
  } catch (err) {
    console.error("Manual contribution notification error:", err.message);
  }
}

/** Saves every "ok" row. Each row commits on its own so one bad row never blocks the rest. */
async function saveRows(results, { admin, notify, batchId }) {
  const perMember = new Map();

  for (const r of results) {
    if (r.status !== "ok") continue;
    try {
      const { txn, savingsBalance } = await recordOne({ ...r, batchId, admin });
      r.status = "saved";
      r.savingsBalance = savingsBalance;
      const list = perMember.get(String(r.member._id)) || { entries: [], balance: null };
      list.entries.push({ amount: r.amount, dateKey: r.dateKey, transactionId: txn._id });
      list.balance = savingsBalance;
      perMember.set(String(r.member._id), list);
    } catch (err) {
      if (err?.code === 11000) {
        r.status = "duplicate";
        r.message = "Already recorded. This row was skipped.";
      } else {
        console.error("Manual contribution save error:", err);
        r.status = "failed";
        r.message = "Could not save this row. Nothing was changed for it.";
      }
    }
  }

  if (notify) {
    for (const [memberId, { entries, balance }] of perMember) {
      await notifyMember(memberId, entries, balance);
    }
  }
}

/* --------------------------------- routes -------------------------------- */

// GET /api/admin/manual-contributions/members?q=
router.get(
  "/members",
  requirePermission("manualsavings.view", "manualsavings.record", "manualsavings.reverse"),
  async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      if (q.length < 2) return res.json({ members: [] });

      const pattern = new RegExp(escapeRegex(q), "i");
      const members = await User.find({
        role: { $ne: "admin" },
        $or: [{ fullName: pattern }, { email: pattern }, { phone: pattern }],
      })
        .select(MEMBER_FIELDS)
        .sort("fullName")
        .limit(12)
        .lean();

      res.json({
        members: members.map((m) => ({
          _id: m._id,
          fullName: m.fullName,
          email: m.email,
          phone: m.phone || "",
          isApprovedMember: Boolean(m.isApprovedMember),
          savingsBalance: Number(m.savingsBalance || 0),
        })),
      });
    } catch (err) {
      console.error("Manual contribution member search error:", err);
      res.status(500).json({ message: "Could not search members." });
    }
  },
);

// GET /api/admin/manual-contributions   (newest recorded first)
router.get(
  "/",
  requirePermission("manualsavings.view", "manualsavings.record", "manualsavings.reverse"),
  async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
      const filter = { source: "manual-entry" };
      if (req.query.before && mongoose.isValidObjectId(req.query.before)) {
        filter._id = { $lt: req.query.before };
      }

      const rows = await SavingsTransaction.find(filter)
        .sort({ _id: -1 })
        .limit(limit)
        .populate("user", "fullName email phone")
        .populate("recordedBy", "fullName email")
        .lean();

      res.json({
        entries: rows.map((t) => {
          const dateKey = todayLagosKey(new Date(t.createdAt));
          return {
            _id: t._id,
            member: t.user
              ? { _id: t.user._id, fullName: t.user.fullName, email: t.user.email, phone: t.user.phone || "" }
              : null,
            amount: t.amount,
            date: dateKey,
            note: t.note || "",
            recordedBy: t.recordedBy?.fullName || t.recordedBy?.email || "",
            // When the office typed it in (the contribution date is "date").
            recordedAt: t._id.getTimestamp(),
            reversed: Boolean(t.reversedAt),
            reversalReason: t.reversalReason || "",
            withdrawableThisMonth: !t.reversedAt && isCurrentMonthKey(dateKey),
          };
        }),
      });
    } catch (err) {
      console.error("List manual contributions error:", err);
      res.status(500).json({ message: "Could not load the recorded contributions." });
    }
  },
);

// POST /api/admin/manual-contributions
// { memberId, amount, date, reference?, note?, notify? }
router.post("/", requirePermission("manualsavings.record"), async (req, res) => {
  try {
    const { memberId, amount, date, reference, note, notify } = req.body || {};
    if (!mongoose.isValidObjectId(memberId)) {
      return res.status(400).json({ message: "Choose a member first." });
    }

    const [result] = await checkRows([{ memberId, amount, date, reference, note }]);
    if (result.status === "error") return res.status(400).json({ message: result.message });
    if (result.status === "duplicate") {
      return res.status(409).json({
        message:
          "This contribution is already recorded (same member, date, amount and reference). Add a reference if it is a separate payment.",
      });
    }

    const batchId = randomUUID();
    await saveRows([result], { admin: req.user, notify: notify !== false, batchId });

    if (result.status === "duplicate") {
      return res.status(409).json({ message: "This contribution is already recorded." });
    }
    if (result.status !== "saved") {
      return res.status(500).json({ message: result.message || "Could not record this contribution." });
    }

    await audit(req, "savings.manual.record", "User", result.member._id, {
      amount: result.amount,
      date: result.dateKey,
      reference: result.reference,
      note: result.note,
    });

    res.status(201).json({
      message: `${naira(result.amount)} recorded for ${result.member.fullName}.`,
      savingsBalance: result.savingsBalance,
      withdrawableThisMonth: result.withdrawableThisMonth,
    });
  } catch (err) {
    console.error("Record manual contribution error:", err);
    res.status(500).json({ message: "Could not record this contribution." });
  }
});

const readRows = (req, res) => {
  const rows = req.body?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ message: "There are no rows to check." });
    return null;
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    res.status(400).json({
      message: `Please send at most ${MAX_IMPORT_ROWS} rows at a time (you sent ${rows.length}).`,
    });
    return null;
  }
  return rows;
};

// POST /api/admin/manual-contributions/import/preview   { rows: [{ identifier, amount, date, reference?, note? }] }
// Checks everything and changes nothing.
router.post("/import/preview", requirePermission("manualsavings.record"), async (req, res) => {
  try {
    const rows = readRows(req, res);
    if (!rows) return;
    const results = await checkRows(rows);
    res.json({ rows: results.map(publicRow), summary: summarize(results) });
  } catch (err) {
    console.error("Manual contribution preview error:", err);
    res.status(500).json({ message: "Could not check these rows." });
  }
});

// POST /api/admin/manual-contributions/import   { rows, notify? }
router.post("/import", requirePermission("manualsavings.record"), async (req, res) => {
  try {
    const rows = readRows(req, res);
    if (!rows) return;

    const results = await checkRows(rows);
    const batchId = randomUUID();
    await saveRows(results, { admin: req.user, notify: req.body?.notify !== false, batchId });

    const summary = summarize(results);
    await audit(req, "savings.manual.import", "SavingsTransaction", batchId, {
      saved: summary.ok,
      skippedDuplicates: summary.duplicates,
      errors: summary.errors,
      totalAmount: summary.totalAmount,
      members: summary.members,
    });

    res.json({ batchId, rows: results.map(publicRow), summary });
  } catch (err) {
    console.error("Manual contribution import error:", err);
    res.status(500).json({ message: "Could not import these rows." });
  }
});

// POST /api/admin/manual-contributions/:id/reverse   { reason }
// Undoes a recorded contribution (for example a wrong amount). Blocked if the
// member has already withdrawn (or has a pending withdrawal) more than 40% of
// that month's contributions would allow without this entry.
router.post("/:id/reverse", requirePermission("manualsavings.reverse"), async (req, res) => {
  try {
    const reason = String(req.body?.reason || "").trim();
    if (reason.length < 5) {
      return res.status(400).json({ message: "Please give a reason (at least 5 characters)." });
    }
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: "Entry not found." });
    }

    const txn = await SavingsTransaction.findById(req.params.id);
    if (!txn || txn.source !== "manual-entry") {
      return res.status(404).json({ message: "Entry not found." });
    }
    if (txn.status !== "approved") {
      return res.status(409).json({ message: "This entry has already been reversed." });
    }

    const amount = Number(txn.amount || 0);
    const originalRef = txn.reference;

    let outcome;
    try {
      outcome = await runAtomic(async (session) => {
        const opts = session ? { session } : {};

        // 0. Withdrawals never reduce the savings balance; they use up the
        //    member's 40% allowance for that month. So the real question is
        //    whether the member has already withdrawn more than 40% of what
        //    that month's contributions would be WITHOUT this entry. If so,
        //    reversing would leave them over-withdrawn.
        const dateKey = todayLagosKey(new Date(txn.createdAt));
        const [year, month] = dateKey.split("-").map(Number);
        const monthStart = new Date(year, month - 1, 1); // same month bounds the withdrawal page uses
        const monthEnd = new Date(year, month, 1);

        const monthContributions = await SavingsTransaction.find(
          { user: txn.user, status: "approved", createdAt: { $gte: monthStart, $lt: monthEnd } },
          null,
          opts,
        ).select("amount");
        const monthTotal = monthContributions.reduce((sum, t) => sum + Number(t.amount || 0), 0);

        const withdrawals = await Withdrawal.find(
          {
            user: txn.user,
            source: "savings",
            withdrawalCycle: dateKey.slice(0, 7),
            status: { $in: ["processing", "success"] },
          },
          null,
          opts,
        ).select("amount");
        const alreadyWithdrawn = withdrawals.reduce((sum, w) => sum + Number(w.amount || 0), 0);

        const allowanceAfter = Math.max(0, monthTotal - amount) * WITHDRAWABLE_PERCENTAGE;
        if (alreadyWithdrawn > 0 && alreadyWithdrawn > allowanceAfter + 0.005) {
          throw Object.assign(new Error("OVERDRAWN"), { code: "OVERDRAWN", alreadyWithdrawn });
        }

        // 1. Take the amount off the savings balance (never below zero).
        const debited = await User.findOneAndUpdate(
          { _id: txn.user, savingsBalance: { $gte: amount } },
          { $inc: { savingsBalance: -amount } },
          { new: true, ...opts },
        );
        if (!debited) throw Object.assign(new Error("INSUFFICIENT"), { code: "INSUFFICIENT" });

        // 2. Mark it reversed, guarded so two clicks cannot reverse it twice.
        //    The key is released so a corrected entry can be recorded.
        const flipped = await SavingsTransaction.findOneAndUpdate(
          { _id: txn._id, status: "approved", source: "manual-entry" },
          {
            $set: {
              status: "rejected",
              reversedAt: new Date(),
              reversedBy: req.user._id,
              reversalReason: reason,
              reference: `${originalRef}:reversed:${txn._id}`,
            },
          },
          { new: true, ...opts },
        );
        if (!flipped) {
          if (!session) await User.findByIdAndUpdate(txn.user, { $inc: { savingsBalance: amount } });
          throw Object.assign(new Error("ALREADY"), { code: "ALREADY" });
        }

        // 3. Ledger: post the opposite entry.
        if (ledgerEnabled()) {
          const entry = await JournalEntry.findOne({ reference: `savings:${originalRef}` }, null, opts);
          if (entry) await reverseEntry(entry._id, { reason, postedBy: req.user._id }, { session });
        }

        return { savingsBalance: debited.savingsBalance };
      });
    } catch (err) {
      if (err?.code === "OVERDRAWN") {
        return res.status(409).json({
          message: `Cannot reverse this: the member has already withdrawn or requested ${naira(err.alreadyWithdrawn)} against that month's contributions. Removing this entry would leave them over-withdrawn. Please ask the finance officer to handle it.`,
        });
      }
      if (err?.code === "INSUFFICIENT") {
        return res.status(409).json({
          message: "Cannot reverse this: it would take the member's savings balance below zero.",
        });
      }
      if (err?.code === "ALREADY") {
        return res.status(409).json({ message: "This entry has already been reversed." });
      }
      throw err;
    }

    await audit(req, "savings.manual.reverse", "SavingsTransaction", txn._id, { amount, reason });

    try {
      await createNotificationAndPush({
        user: txn.user,
        type: "savings",
        title: "Contribution Entry Corrected",
        message: `The cooperative office reversed a recorded contribution of ${naira(amount)} dated ${prettyDate(todayLagosKey(new Date(txn.createdAt)))}. Your savings balance is now ${naira(outcome.savingsBalance)}.`,
        data: { kind: "manual-contribution-reversed", sms: false, amount },
      });
    } catch (err) {
      console.error("Reversal notification error:", err.message);
    }

    res.json({ message: "The entry was reversed.", savingsBalance: outcome.savingsBalance });
  } catch (err) {
    console.error("Reverse manual contribution error:", err);
    res.status(500).json({ message: "Could not reverse this entry." });
  }
});

export default router;
