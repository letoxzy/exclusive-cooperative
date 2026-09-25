import Loan from "../models/Loan.js";
import { createNotificationAndPush } from "../utils/createNotification.js";

// Overdue policy agreed for the current loan flow:
// - Normal loan interest is calculated once when the loan is created.
// - After the final repayment deadline passes without full settlement,
//   increase the CURRENT outstanding balance by 2%.
// - Every further 7 days that the balance remains unpaid, increase the
//   CURRENT outstanding balance by another 2%.
// - This is deliberately separate from the original loan interest.
export const OVERDUE_RATE = 0.02;
export const OVERDUE_INTERVAL_DAYS = 7;

const LAGOS_TZ = "Africa/Lagos";
const DAY_MS = 24 * 60 * 60 * 1000;

function localDateKey(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LAGOS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function utcDayFromKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function addCalendarDays(key, days) {
  return new Date(utcDayFromKey(key) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function calendarDayDifference(fromKey, toKey) {
  return Math.round((utcDayFromKey(toKey) - utcDayFromKey(fromKey)) / DAY_MS);
}

function money(value) {
  return Number(value || 0).toLocaleString("en-NG", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function getFinalDueDate(loan) {
  if (!Array.isArray(loan.repaymentSchedule) || loan.repaymentSchedule.length === 0) {
    return null;
  }

  return loan.repaymentSchedule.reduce((latest, installment) => {
    if (!installment?.dueDate) return latest;
    const due = new Date(installment.dueDate);
    if (Number.isNaN(due.getTime())) return latest;
    if (!latest || due > latest) return due;
    return latest;
  }, null);
}

async function sendDueReminder(loan, daysBefore, fieldName) {
  if (loan[fieldName]) return false;

  const dueDate = getFinalDueDate(loan);
  if (!dueDate) return false;

  const todayKey = localDateKey(new Date());
  const dueKey = localDateKey(dueDate);
  const difference = calendarDayDifference(todayKey, dueKey);

  if (difference !== daysBefore || Number(loan.outstandingBalance || 0) <= 0) {
    return false;
  }

  const wording =
    daysBefore === 3
      ? "Your loan repayment is due in 3 days."
      : daysBefore === 1
        ? "Your loan repayment is due tomorrow."
        : "Your loan repayment is due today.";

  await createNotificationAndPush({
    user: loan.user,
    type: "loan",
    title: daysBefore === 0 ? "Loan Repayment Due Today" : "Loan Repayment Reminder",
    message: `${wording} Your current amount to settle is ₦${money(loan.outstandingBalance)}.`,
    data: {
      loanId: String(loan._id),
      kind: "repayment-reminder",
      daysBefore,
    },
  });

  loan[fieldName] = new Date();
  await loan.save();
  return true;
}

async function applyOverdueCharges(loan) {
  const outstanding = Number(loan.outstandingBalance || 0);
  if (outstanding <= 0) return false;

  const finalDueDate = getFinalDueDate(loan);
  if (!finalDueDate) return false;

  const todayKey = localDateKey(new Date());
  const dueKey = localDateKey(finalDueDate);

  // The deadline itself is still the last day to settle normally.
  if (calendarDayDifference(dueKey, todayKey) <= 0) return false;

  let nextChargeKey = loan.nextOverdueChargeAt
    ? localDateKey(loan.nextOverdueChargeAt)
    : addCalendarDays(dueKey, 1);

  let changed = false;
  let cyclesApplied = 0;
  let totalAdded = 0;

  // If the server was temporarily offline, catch up on each missed 7-day cycle
  // rather than silently losing overdue increases.
  while (calendarDayDifference(nextChargeKey, todayKey) >= 0) {
    const currentBalance = Number(loan.outstandingBalance || 0);
    if (currentBalance <= 0) break;

    const added = Math.round(currentBalance * OVERDUE_RATE * 100) / 100;

    loan.outstandingBalance = Math.round((currentBalance + added) * 100) / 100;
    loan.overdueChargeTotal =
      Math.round((Number(loan.overdueChargeTotal || 0) + added) * 100) / 100;

    if (!loan.overdueAt) loan.overdueAt = new Date();
    loan.status = "overdue";

    totalAdded += added;
    cyclesApplied += 1;
    changed = true;

    nextChargeKey = addCalendarDays(nextChargeKey, OVERDUE_INTERVAL_DAYS);
  }

  if (!changed) return false;

  // Keep the next cycle date even if the current run caught up multiple cycles.
  loan.nextOverdueChargeAt = new Date(`${nextChargeKey}T00:00:00+01:00`);
  await loan.save();

  const cycleText = cyclesApplied === 1 ? "2%" : `${cyclesApplied} overdue increases`;
  await createNotificationAndPush({
    user: loan.user,
    type: "loan",
    title: "Loan Repayment Overdue",
    message:
      cyclesApplied === 1
        ? `Your loan repayment is overdue. A 2% overdue increase of ₦${money(totalAdded)} has been added. Your new amount owing is ₦${money(loan.outstandingBalance)}.`
        : `Your loan remained overdue while the server was processing. ${cycleText} were applied, adding ₦${money(totalAdded)}. Your new amount owing is ₦${money(loan.outstandingBalance)}.`,
    data: {
      loanId: String(loan._id),
      kind: "overdue-charge",
      cyclesApplied,
      overdueRate: OVERDUE_RATE,
      overdueAmountAdded: totalAdded,
      outstandingBalance: loan.outstandingBalance,
    },
  });

  return true;
}

export async function processLoanOverdueRules() {
  const loans = await Loan.find({
    status: { $in: ["active", "overdue"] },
    outstandingBalance: { $gt: 0 },
  });

  for (const loan of loans) {
    try {
      await sendDueReminder(loan, 3, "repaymentReminder3SentAt");
      await sendDueReminder(loan, 1, "repaymentReminder1SentAt");
      await sendDueReminder(loan, 0, "repaymentDueTodaySentAt");
      await applyOverdueCharges(loan);
    } catch (error) {
      console.error(`Loan overdue processing failed for ${loan._id}:`, error);
    }
  }
}

export function startLoanOverdueScheduler() {
  const run = async () => {
    try {
      await processLoanOverdueRules();
    } catch (error) {
      console.error("Loan overdue scheduler error:", error);
    }
  };

  // Run once when the server starts, then check hourly. The database fields
  // make every operation idempotent, so repeated checks cannot double-charge.
  void run();
  const timer = setInterval(run, 60 * 60 * 1000);
  timer.unref?.();

  console.log("Loan overdue scheduler started (hourly, Africa/Lagos).");
  return timer;
}
