/**
 * Pure helpers for recording contributions that members paid by hand
 * (Excel / paper register) before online payments went live.
 * No database access here, so they are easy to test.
 */

const MIN_YEAR = 2015;
const MAX_AMOUNT = 1_000_000_000;

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n) => String(n).padStart(2, "0");

/** Today's date in Lagos as YYYY-MM-DD. */
export function todayLagosKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

const isRealDate = (y, m, d) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

/**
 * Accepts 2026-11-05, 05/11/2026, 5-11-2026, 5.11.2026, "5 Nov 2026" and an
 * Excel serial number. Day comes before month for 05/11/2026 (Nigerian format).
 * Returns { key: "YYYY-MM-DD" } or { error }.
 */
export function parseContributionDate(input, now = new Date()) {
  let y;
  let m;
  let d;
  const text = String(input ?? "").trim();

  if (!text) return { error: "Date is missing." };

  let match;
  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(text))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(text))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(text))) {
    d = Number(match[1]);
    m = MONTHS[match[2].slice(0, 3).toLowerCase()];
    y = Number(match[3]);
  } else if (/^\d{5}(\.\d+)?$/.test(text)) {
    // Excel serial date (days since 1899-12-30).
    const serial = Math.floor(Number(text));
    if (serial < 30000 || serial > 80000) return { error: `"${text}" is not a valid date.` };
    const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  } else {
    return { error: `"${text}" is not a date. Use DD/MM/YYYY.` };
  }

  if (!m || !isRealDate(y, m, d)) return { error: `"${text}" is not a real date.` };
  if (y < MIN_YEAR) return { error: `Dates before ${MIN_YEAR} are not accepted.` };

  const key = `${y}-${pad(m)}-${pad(d)}`;
  if (key > todayLagosKey(now)) return { error: "The date cannot be in the future." };

  return { key };
}

/** 12:00 noon in Lagos on that day, so the entry sits safely inside its month in any timezone. */
export const lagosNoon = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 11, 0, 0));
};

export const isCurrentMonthKey = (key, now = new Date()) =>
  String(key).slice(0, 7) === todayLagosKey(now).slice(0, 7);

/** "₦50,000.00", "NGN 50,000", "50000" -> 50000. Returns { amount } or { error }. */
export function parseAmount(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return { error: "Amount is missing." };

  const cleaned = raw.replace(/₦|NGN|N(?=\d)/gi, "").replace(/[,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return { error: `"${raw}" is not a valid amount.` };

  const value = Math.round(Number(cleaned) * 100) / 100;
  if (!Number.isFinite(value) || value <= 0) return { error: "Amount must be above zero." };
  if (value > MAX_AMOUNT) return { error: "That amount is too large. Check it and try again." };

  return { amount: value };
}

/** The 40% withdrawable / 60% locked split, rounded exactly like Paystack and office approvals. */
export function splitContribution(amount, withdrawablePct = 0.4) {
  const withdrawalAmount = Math.round(amount * withdrawablePct * 100) / 100;
  const lockedAmount = Math.round((amount - withdrawalAmount) * 100) / 100;
  return { lockedAmount, withdrawalAmount };
}

/** A short, safe form of the receipt / register reference for the duplicate key. */
export const normalizeReference = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 60);

/**
 * The same member + date + amount + reference always gives the same key, so a
 * row uploaded twice is recognised and skipped. Two genuine payments on one
 * day are told apart by their reference (for example the receipt number).
 */
export const buildReferenceKey = ({ memberId, dateKey, amount, reference }) =>
  `manual:${memberId}:${dateKey}:${Math.round(amount * 100)}:${normalizeReference(reference)}`;

/** "+234 803 123 4567" and "0803 123 4567" both end in "8031234567". */
export function phoneTail(input) {
  const digits = String(input ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

export const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? "").trim());

export const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
