import { toKobo, fromKobo, splitProportional } from "./money.js";

/*
  Pure dividend arithmetic (no database), so it can be tested directly.
  Basis: loan interest actually collected in the period.
*/

/**
 * Splits a repayment (naira) across principal, interest and overdue charges.
 * Pro-rata, in whole kobo, always adding up to exactly the repayment.
 */
export function repaymentPortions(loan, amountNaira) {
  const principal = Number(loan?.amount || 0);
  const interest = Math.max(0, Number(loan?.totalRepayment || 0) - principal);
  const charges = Math.max(0, Number(loan?.overdueChargeTotal || 0));
  const [p, i, c] = splitProportional(toKobo(amountNaira), [principal, interest, charges]);
  return {
    principalKobo: p,
    interestKobo: i,
    chargesKobo: c,
    principal: fromKobo(p),
    interest: fromKobo(i),
    charges: fromKobo(c),
  };
}

/**
 * Totals collected interest per ELIGIBLE member.
 * @param rows        [{ userId, interestKobo, derived }]
 * @param eligibleIds Set of member ids who may receive dividends
 */
export function summarizeInterest(rows, eligibleIds) {
  const byMember = new Map();
  let repaymentsCounted = 0;
  let derivedRepayments = 0;

  for (const row of rows) {
    if (!eligibleIds.has(row.userId)) continue; // not an eligible member
    if (!(row.interestKobo > 0)) continue; // principal-only / interest-free
    const acc = byMember.get(row.userId) || { interestKobo: 0, count: 0 };
    acc.interestKobo += row.interestKobo;
    acc.count += 1;
    byMember.set(row.userId, acc);
    repaymentsCounted += 1;
    if (row.derived) derivedRepayments += 1;
  }

  const members = Array.from(byMember.entries()).map(([user, acc]) => ({
    user,
    interestKobo: acc.interestKobo,
    qualifyingInterest: fromKobo(acc.interestKobo),
    repaymentsCounted: acc.count,
  }));
  const totalKobo = members.reduce((s, m) => s + m.interestKobo, 0);
  return { members, totalKobo, totalInterest: fromKobo(totalKobo), repaymentsCounted, derivedRepayments };
}

/** Shares of a pool (naira) in exact kobo, proportional to each member's interest. */
export function allocatePool(poolNaira, members) {
  return splitProportional(toKobo(poolNaira), members.map((m) => m.interestKobo));
}
