/**
 * Mirrors the "have you already contributed?" rules at the top of
 * POST /api/payments/paystack/initialize (routes/paymentRoutes.js), so that
 * contribution REMINDERS never tell a member to pay when the app would refuse
 * the payment.
 *
 *   daily   -> blocked if the last contribution was on the same calendar day
 *   weekly  -> blocked until 7 days (168 hours) after the last contribution
 *   monthly -> blocked if the last contribution was in the same calendar month
 *
 * Like the payment route, "calendar day/month" here uses the SERVER's clock.
 * If you change those rules in paymentRoutes.js, change them here too.
 * (utils/contributionRules.js defines periods differently, in Lagos time and
 * with Monday-Sunday weeks; the reminders use both, and send only when both
 * agree the member may pay.)
 */

const normalize = (value) => {
  const f = String(value || "monthly").trim().toLowerCase();
  return f === "daily" ? "daily" : f === "weekly" ? "weekly" : "monthly";
};

const sameCalendarDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const sameCalendarMonth = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

/** True when the payment route would let this member contribute right now. */
export function gateAllowsContribution(frequencyValue, lastContributionAt, now = new Date()) {
  if (!lastContributionAt) return true;
  const last = new Date(lastContributionAt);
  if (Number.isNaN(last.getTime())) return true;

  const frequency = normalize(frequencyValue);
  if (frequency === "daily" && sameCalendarDay(now, last)) return false;
  if (frequency === "weekly" && (now.getTime() - last.getTime()) / (24 * 60 * 60 * 1000) < 7) return false;
  if (frequency === "monthly" && sameCalendarMonth(now, last)) return false;
  return true;
}
