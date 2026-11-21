/**
 * Decides when the dashboard should congratulate a member on a dividend or a
 * shareholding credit. Same rules as the mobile app:
 *  - the notification must be UNREAD and from the last 30 days;
 *  - dividend: type "dividend" with an amount above zero;
 *  - shareholding: only a real INCREASE (a reduction or an unchanged save is
 *    never congratulated);
 *  - amounts come from the notification's structured `data` when present,
 *    otherwise from the standard message text. No clear number -> nothing shows.
 */

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const round2 = (n) => Math.round(n * 100) / 100;

const parseNaira = (text) => {
  if (!text) return null;
  const n = Number(String(text).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

const idOf = (n) => String(n?._id ?? n?.id ?? "");

function dividendAmount(n) {
  const fromData = Number(n?.data?.amount);
  if (n?.data?.kind === "dividend-paid" && Number.isFinite(fromData) && fromData > 0) {
    return round2(fromData);
  }
  const match = /dividend of ₦\s*([\d,]+(?:\.\d+)?)\s*has been paid/i.exec(n?.message || "");
  const parsed = parseNaira(match?.[1]);
  return parsed !== null && parsed > 0 ? round2(parsed) : null;
}

function shareholdingChange(n) {
  const previous = Number(n?.data?.previous);
  const current = Number(n?.data?.current);
  if (
    typeof n?.data?.kind === "string" &&
    n.data.kind.startsWith("shareholding") &&
    Number.isFinite(previous) &&
    Number.isFinite(current)
  ) {
    return { previous, current };
  }
  const match = /updated from ₦\s*([\d,]+(?:\.\d+)?)\s*to ₦\s*([\d,]+(?:\.\d+)?)/i.exec(
    n?.message || "",
  );
  const prev = parseNaira(match?.[1]);
  const curr = parseNaira(match?.[2]);
  if (prev === null || curr === null) return null;
  return { previous: prev, current: curr };
}

export function getCredits(notifications, now = new Date()) {
  const dividendIds = [];
  let dividendTotal = 0;
  const shareIds = [];
  let shareIncrease = 0;
  let newest = null;

  for (const n of notifications || []) {
    if (n?.isRead === true || n?.read === true) continue;
    const id = idOf(n);
    if (!id) continue;

    const created = n.createdAt ? new Date(n.createdAt).getTime() : NaN;
    if (!Number.isFinite(created) || now.getTime() - created > WINDOW_MS) continue;
    if (created > now.getTime() + 5 * 60 * 1000) continue;

    if (n.type === "dividend") {
      const amount = dividendAmount(n);
      if (amount === null) continue;
      dividendIds.push(id);
      dividendTotal += amount;
    } else if (n.type === "shareholding") {
      const change = shareholdingChange(n);
      if (!change || change.current <= change.previous) continue;
      shareIds.push(id);
      shareIncrease += change.current - change.previous;
      if (!newest || created > newest.time) newest = { time: created, current: change.current };
    }
  }

  return {
    dividend: dividendIds.length
      ? { ids: dividendIds, count: dividendIds.length, amount: round2(dividendTotal) }
      : null,
    shareholding: shareIds.length
      ? {
          ids: shareIds,
          count: shareIds.length,
          amount: round2(shareIncrease),
          current: newest?.current,
        }
      : null,
  };
}
