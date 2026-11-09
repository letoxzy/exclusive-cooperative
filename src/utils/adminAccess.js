/**
 * Which admin tabs and actions an administrator's office role may use.
 *
 * The server decides this (see utils/adminPermissions.js on the backend) and
 * enforces it on every admin request. The website only uses the same list to
 * hide tabs and buttons the server would refuse, so staff are not shown things
 * they cannot do. The signed-in user carries `permissions` (from login or
 * /auth/me); "*" means everything (the Full Administrator).
 */

export const hasPermission = (user, ...wanted) => {
  if (user?.role !== "admin") return false;
  const have = user.permissions;
  // No list sent (an older server): treat as the full administrator. The server
  // still enforces the real limits.
  if (!Array.isArray(have)) return true;
  if (have.includes("*")) return true;
  return wanted.some((permission) => have.includes(permission));
};

// A tab shows when the user holds at least one of these.
export const SECTION_PERMISSIONS = {
  overview: ["overview.view"],
  members: ["members.view"],
  membership: ["membership.review", "membership.view"],
  savings: ["savings.view", "savings.review"],
  loans: ["loans.view"],
  "loan-eligibility": ["loan.eligibility", "loan.eligibility.view"],
  "loan-requests": ["loans.view"],
  repayments: ["repayments.view", "repayments.review"],
  dividends: ["dividends.view"],
  transactions: ["transactions.view"],
  withdrawals: ["withdrawals.view"],
  reports: ["reports.view"],
  ledger: ["ledger.view"],
  reconciliation: ["reconciliation.view"],
  deletions: ["deletions.manage"],
  audit: ["audit.view"],
  gallery: ["gallery.manage"],
  settings: ["settings.manage"],
};

export const canOpenSection = (user, sectionId) => {
  const needed = SECTION_PERMISSIONS[sectionId];
  return needed ? hasPermission(user, ...needed) : false;
};
