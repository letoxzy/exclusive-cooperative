import SavingsTransaction from "../models/SavingsTransaction.js";
import Withdrawal from "../models/Withdrawal.js";
import Membership from "../models/Membership.js";

export const MINIMUM_CONTRIBUTION = 10000;
export const LOCKED_SAVINGS_PERCENTAGE = 0.60;
export const WITHDRAWABLE_PERCENTAGE = 0.40;

export const CONTRIBUTION_FREQUENCIES = ["Daily", "Weekly", "Monthly"];

export function normalizeFrequency(value) {
  const raw = String(value || "Monthly").trim().toLowerCase();
  if (raw === "daily") return "Daily";
  if (raw === "weekly") return "Weekly";
  return "Monthly";
}

function lagosParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
  };
}

function lagosDateKey(date = new Date()) {
  const p = lagosParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function startOfLagosDay(date = new Date()) {
  const p = lagosParts(date);
  // Lagos is UTC+1. Building the UTC instant for Lagos midnight keeps the
  // period boundaries stable on Render even when the server runs in UTC.
  return new Date(Date.UTC(p.year, p.month - 1, p.day) - 60 * 60 * 1000);
}

export function getContributionWindow(frequency, date = new Date()) {
  const normalized = normalizeFrequency(frequency);
  const dayStart = startOfLagosDay(date);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  if (normalized === "Daily") {
    return {
      frequency: normalized,
      periodKey: lagosDateKey(date),
      start: dayStart,
      end: dayEnd,
      label: "today",
    };
  }

  const parts = lagosParts(date);
  if (normalized === "Monthly") {
    const nextMonth = parts.month === 12
      ? { year: parts.year + 1, month: 1 }
      : { year: parts.year, month: parts.month + 1 };
    const start = new Date(Date.UTC(parts.year, parts.month - 1, 1) - 60 * 60 * 1000);
    const end = new Date(Date.UTC(nextMonth.year, nextMonth.month - 1, 1) - 60 * 60 * 1000);
    return {
      frequency: normalized,
      periodKey: `${parts.year}-${String(parts.month).padStart(2, "0")}`,
      start,
      end,
      label: "this month",
    };
  }

  // Weekly contribution frequency uses Monday-Sunday calendar weeks in Lagos.
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Lagos",
    weekday: "short",
  }).format(date);
  const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  const daysSinceMonday = (dayIndex + 6) % 7;
  const weekStart = new Date(dayStart.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const weekDate = new Date(weekStart.getTime() + 60 * 60 * 1000);
  const wp = lagosParts(weekDate);

  return {
    frequency: normalized,
    periodKey: `${wp.year}-W${String(getIsoWeek(weekDate)).padStart(2, "0")}`,
    start: weekStart,
    end: weekEnd,
    label: "this week",
  };
}

function getIsoWeek(date) {
  const p = lagosParts(date);
  const utc = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
}

export async function getMemberContributionFrequency(user) {
  if (user?.contributionFrequency) return normalizeFrequency(user.contributionFrequency);
  const membership = await Membership.findOne({ user: user?._id }).select("frequency").lean();
  return normalizeFrequency(membership?.frequency);
}

export async function getContributionStatus(user, date = new Date()) {
  const frequency = await getMemberContributionFrequency(user);
  const window = getContributionWindow(frequency, date);
  const existing = await SavingsTransaction.findOne({
    user: user._id,
    status: "approved",
    createdAt: { $gte: window.start, $lt: window.end },
  }).sort("createdAt");

  return {
    frequency,
    periodKey: window.periodKey,
    contributedThisPeriod: Boolean(existing),
    lastContributionAt: existing?.createdAt || null,
    canContribute: !existing,
    nextContributionAt: existing ? window.end : new Date(),
  };
}

export async function getCurrentMonthlyWithdrawalBalance(userId, date = new Date()) {
  const parts = lagosParts(date);
  const start = new Date(Date.UTC(parts.year, parts.month - 1, 1) - 60 * 60 * 1000);
  const nextMonth = parts.month === 12
    ? { year: parts.year + 1, month: 1 }
    : { year: parts.year, month: parts.month + 1 };
  const end = new Date(Date.UTC(nextMonth.year, nextMonth.month - 1, 1) - 60 * 60 * 1000);

  const [contributionTotals, usedWithdrawal] = await Promise.all([
    SavingsTransaction.aggregate([
      {
        $match: {
          user: userId,
          status: "approved",
          createdAt: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: null,
          totalContribution: { $sum: "$amount" },
          totalWithdrawable: {
            $sum: {
              $ifNull: ["$withdrawalAmount", { $multiply: ["$amount", WITHDRAWABLE_PERCENTAGE] }],
            },
          },
          totalLocked: {
            $sum: {
              $ifNull: ["$lockedAmount", { $multiply: ["$amount", LOCKED_SAVINGS_PERCENTAGE] }],
            },
          },
        },
      },
    ]),
    Withdrawal.findOne({
      user: userId,
      source: "savings",
      createdAt: { $gte: start, $lt: end },
      status: { $in: ["processing", "success"] },
    }).sort("createdAt"),
  ]);

  const totalContribution = Number(contributionTotals[0]?.totalContribution || 0);
  const totalWithdrawable = Number(contributionTotals[0]?.totalWithdrawable || 0);
  const totalLocked = Number(contributionTotals[0]?.totalLocked || 0);

  return {
    start,
    end,
    periodKey: `${parts.year}-${String(parts.month).padStart(2, "0")}`,
    totalContribution,
    totalWithdrawable,
    totalLocked,
    usedWithdrawal: Boolean(usedWithdrawal),
    withdrawal: usedWithdrawal || null,
  };
}
