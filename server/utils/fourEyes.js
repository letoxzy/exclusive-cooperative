/*
  Maker-checker ("four-eyes") rules. Switched on with MAKER_CHECKER=true so a
  cooperative with a single administrator is never locked out while it is off.
*/
export const makerCheckerEnabled = () => process.env.MAKER_CHECKER === "true";

/** True when the two admins are the same person. Missing ids never block. */
export function sameAdmin(a, b) {
  return Boolean(a) && Boolean(b) && String(a) === String(b);
}
