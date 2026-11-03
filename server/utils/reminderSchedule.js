// Pure scheduling rules for contribution reminders (no database access, so
// they are easy to test). All times are Africa/Lagos.

const TZ = "Africa/Lagos";
const WEEKDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

export function lagosNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24, // some engines print midnight as "24"
    weekday: WEEKDAYS[String(map.weekday).toLowerCase().slice(0, 3)],
  };
}

const clampInt = (value, min, max, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

function weekdayFrom(value, fallback) {
  const s = String(value ?? "").trim().toLowerCase();
  if (/^[0-6]$/.test(s)) return Number(s);
  if (s && WEEKDAYS[s.slice(0, 3)] !== undefined) return WEEKDAYS[s.slice(0, 3)];
  return fallback;
}

export function reminderConfig(env = process.env) {
  return {
    // Only send during the day (Lagos time).
    startHour: clampInt(env.CONTRIBUTION_REMINDER_START_HOUR, 0, 23, 9),
    endHour: clampInt(env.CONTRIBUTION_REMINDER_END_HOUR, 1, 24, 20),
    // Weekly savers: remind from this weekday if they have not paid this
    // week (weeks run Monday-Sunday). Default Friday.
    weeklyDay: weekdayFrom(env.CONTRIBUTION_REMINDER_WEEKLY_DAY, 5),
    // Monthly savers: remind from this day of the month. Default the 25th.
    // Capped at 28 so it exists in every month.
    monthlyDay: clampInt(env.CONTRIBUTION_REMINDER_MONTHLY_DAY, 1, 28, 25),
  };
}

const sinceMonday = (weekday) => (weekday + 6) % 7;

/**
 * Is it a reminder day for this frequency right now? Uses ">= the reminder
 * day", not "=="; so if the server was asleep on the exact day, the reminder
 * still goes out later in the same period. The caller de-duplicates per
 * period, so each member gets at most one reminder per period.
 */
export function isReminderDue(frequency, date = new Date(), cfg = reminderConfig()) {
  const now = lagosNow(date);
  if (now.hour < cfg.startHour || now.hour >= cfg.endHour) return false;

  switch (frequency) {
    case "Daily":
      return true;
    case "Weekly":
      return sinceMonday(now.weekday) >= sinceMonday(cfg.weeklyDay);
    case "Monthly":
      return now.day >= cfg.monthlyDay;
    default:
      return false;
  }
}
