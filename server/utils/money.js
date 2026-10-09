// Money helpers. The ledger stores integer kobo; the rest of the app still
// speaks naira, so conversion happens only at the ledger boundary.

export const toKobo = (naira) => Math.round(Number(naira || 0) * 100);
export const fromKobo = (kobo) => Number(kobo || 0) / 100;

/**
 * Splits `totalKobo` across `weights` using the largest-remainder method, so
 * the parts always add up to exactly `totalKobo` (no stray kobo/naira).
 * @param {number} totalKobo integer
 * @param {number[]} weights non-negative
 * @returns {number[]} integer kobo, same order as weights
 */
export function splitProportional(totalKobo, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!weights.length || sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (w / sum) * totalKobo);
  const parts = raw.map(Math.floor);
  let left = totalKobo - parts.reduce((a, b) => a + b, 0);
  raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
    .forEach(({ i }) => {
      if (left > 0) {
        parts[i] += 1;
        left -= 1;
      }
    });
  return parts;
}
