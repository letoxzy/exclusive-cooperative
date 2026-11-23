export const SECTION_ORDER = [
  "overview",
  "members",
  "membership",
  "savings",
  "loans",
  "loan-eligibility",
  "loan-requests",
  "repayments",
  "dividends",
  "transactions",
  "withdrawals",
  "statistics",
  "reports",
  "ledger",
  "reconciliation",
  "deletions",
  "audit",
  "gallery",
  "services",
  "manualsavings",
  "settings",
];

export const hasPermission = (user, ...wanted) => {
  if (user?.role !== "admin") return false;
  const have = user.permissions;
  // No list sent (an older server): treat as the full administrator. The server
  // still enforces the real limits.
  if (!Array.isArray(have)) return true;
  if (have.includes("*")) return true;
  return wanted.some((permission) => have.includes(permission));
};

// Used only when an older server does not send `sections`.
const SECTION_PERMISSIONS = {
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
  statistics: ["statistics.view"],
  reports: ["reports.view"],
  ledger: ["ledger.view"],
  reconciliation: ["reconciliation.view"],
  deletions: ["deletions.manage"],
  audit: ["audit.view"],
  gallery: ["gallery.manage"],
  services: ["services.view", "services.manage"],
  manualsavings: ["manualsavings.view", "manualsavings.record", "manualsavings.reverse"],
};

/** The tabs this administrator sees, in the order they are shown. */
export const visibleSections = (user) => {
  if (user?.role !== "admin") return [];

  if (Array.isArray(user.sections)) {
    return user.sections.filter((id) => SECTION_ORDER.includes(id));
  }

  // Everyone keeps "settings" (their own name and password).
  return SECTION_ORDER.filter(
    (id) =>
      id === "settings" || hasPermission(user, ...(SECTION_PERMISSIONS[id] || [])),
  );
};

export const canOpenSection = (user, sectionId) =>
  visibleSections(user).includes(sectionId);

/** The tab shown right after signing in. */
export const landingSection = (user) => visibleSections(user)[0] || "settings";
