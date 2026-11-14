import User from "../models/User.js";
import Notification from "../models/Notification.js";
import Membership from "../models/Membership.js";
import SavingsTransaction from "../models/SavingsTransaction.js";
import { createNotificationAndPush } from "../utils/createNotification.js";
import { getContributionStatus, MINIMUM_CONTRIBUTION } from "../utils/contributionRules.js";
import { reminderConfig, isReminderDue } from "../utils/reminderSchedule.js";
import { gateAllowsContribution } from "../utils/contributionGate.js";


const LABEL = { Daily: "today", Weekly: "this week", Monthly: "this month" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let running = false;

const enabled = () =>
  String(process.env.CONTRIBUTION_REMINDERS_ENABLED || "").toLowerCase() === "true";

export async function processContributionReminders({ dryRun = false, now = new Date() } = {}) {
  const summary = { checked: 0, alreadyPaid: 0, blockedByPaymentRule: 0, alreadyReminded: 0, due: 0, sent: 0, byFrequency: {} };
  if (running) return { ...summary, busy: true };
  running = true;

  try {
    // A dry run ignores the time-of-day window so it can be tried any time.
    const cfg = dryRun ? { ...reminderConfig(), startHour: 0, endHour: 24 } : reminderConfig();

    const members = User.find({
      role: "member",
      isApprovedMember: true,
      isBlocked: { $ne: true },
      "fullWithdrawalGrant.active": { $ne: true }, // members who are leaving
    })
      .select("_id fullName contributionFrequency")
      .cursor();

    for await (const member of members) {
      summary.checked += 1;
      try {
        const status = await getContributionStatus(member, now);

        if (status.contributedThisPeriod) {
          summary.alreadyPaid += 1;
          continue;
        }
        if (!isReminderDue(status.frequency, now, cfg)) continue;

        // Never remind someone the app would then refuse (see contributionGate.js).
        const [membership, lastContribution] = await Promise.all([
          Membership.findOne({ user: member._id, status: "approved" }).select("frequency").lean(),
          SavingsTransaction.findOne({ user: member._id, status: "approved" })
            .sort("-createdAt")
            .select("createdAt")
            .lean(),
        ]);
        if (!gateAllowsContribution(membership?.frequency, lastContribution?.createdAt, now)) {
          summary.blockedByPaymentRule += 1;
          continue;
        }

        const already = await Notification.exists({
          user: member._id,
          "data.kind": "contribution-reminder",
          "data.period": status.periodKey,
        });
        if (already) {
          summary.alreadyReminded += 1;
          continue;
        }

        summary.due += 1;
        summary.byFrequency[status.frequency] = (summary.byFrequency[status.frequency] || 0) + 1;
        if (dryRun) continue;

        await createNotificationAndPush({
          user: member._id,
          // "announcement" shows under Activities (with a bell) in the app,
          // instead of cluttering the Transactions tab.
          type: "announcement",
          title: "Contribution Reminder",
          message:
            `You have not made your ${status.frequency.toLowerCase()} contribution ` +
            `${LABEL[status.frequency]} yet. The minimum is \u20a6${MINIMUM_CONTRIBUTION.toLocaleString()}. ` +
            `Open the app to contribute.`,
          data: {
            kind: "contribution-reminder",
            period: status.periodKey,
            frequency: status.frequency,
          },
        });
        summary.sent += 1;
        await sleep(50); // gentle pace if many members are due at once
      } catch (err) {
        console.error("[reminders] member failed:", err?.message || err);
      }
    }
  } finally {
    running = false;
  }
  return summary;
}

export function startContributionReminderScheduler() {
  if (!enabled()) {
    console.log("Contribution reminders are off (set CONTRIBUTION_REMINDERS_ENABLED=true to turn them on).");
    return null;
  }

  const run = async () => {
    try {
      const summary = await processContributionReminders();
      if (summary.sent) console.log("[reminders] sent", summary.sent, summary.byFrequency);
    } catch (err) {
      console.error("Contribution reminder scheduler error:", err);
    }
  };

  void run();
  const timer = setInterval(run, 60 * 60 * 1000);
  timer.unref?.();
  console.log("Contribution reminder scheduler started (hourly, Africa/Lagos).");
  return timer;
}
