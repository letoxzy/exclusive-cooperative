/**
 * Office roles for administrators.
 *
 * Every staff member still has role "admin" (so everything that already checks
 * for an administrator keeps working). `adminRole` decides WHICH admin actions
 * that person may use. The server enforces it on every admin route with
 * requirePermission(); the website only hides what the server would refuse.
 *
 * "full" is the existing administrator account: it can do everything.
 */

// Every tab on the admin page, in the order they normally appear.
export const ALL_SECTIONS = [
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
  "reports",
  "ledger",
  "reconciliation",
  "deletions",
  "audit",
  "gallery",
  "settings",
];

/**
 * `sections` are the tabs the office sees (in its own order; the first one is
 * where it lands after signing in). `permissions` are what the server lets it
 * do, and also decide which data its tabs may load.
 *
 * "overview" is only for the Full Administrator and the Supervisor: it totals
 * savings, members, applications and repayments, and an office that cannot see
 * all of that data would be shown wrong numbers. Every office keeps "settings"
 * for its own name and password.
 */
export const ADMIN_ROLES = {
  full: {
    label: "Full Administrator",
    permissions: ["*"],
    sections: ALL_SECTIONS,
  },

  membership: {
    label: "Membership & Member Care Officer",
    permissions: [
      "members.view",
      "members.ussd",
      "members.add",
      "membership.review",
      "gallery.manage",
    ],
    sections: ["membership", "members", "gallery", "settings"],
  },

  cash: {
    label: "Cash Officer",
    permissions: [
      "savings.review",
      "repayments.review",
      "loans.view", // the Transactions tab lists loan payouts too
      "transactions.view",
    ],
    sections: ["savings", "repayments", "transactions", "settings"],
  },

  loan: {
    label: "Loan Officer",
    permissions: ["loan.eligibility", "loan.decide", "loans.view"],
    sections: ["loan-eligibility", "loan-requests", "settings"],
  },

  disbursement: {
    label: "Disbursement Officer",
    permissions: [
      "loans.view",
      "loan.disburse",
      "withdrawals.view",
      "withdrawals.sync",
    ],
    sections: ["loan-requests", "withdrawals", "settings"],
  },

  finance: {
    label: "Finance Officer",
    permissions: [
      "reconciliation.view",
      "reconciliation.credit",
      "ledger.view",
      "reports.view",
      "dividends.view",
      "dividends.prepare",
      "transactions.view",
      // Read access that Transactions and Reports need for their figures:
      "savings.view",
      "repayments.view",
      "loans.view",
      "members.view",
    ],
    sections: [
      "reconciliation",
      "transactions",
      "reports",
      "ledger",
      "dividends",
      "settings",
    ],
  },

  supervisor: {
    label: "Supervisor",
    permissions: [
      "overview.view",
      "members.view",
      "members.manage",
      "members.unlock",
      "members.ussd",
      "members.shareholding",
      "members.delete",
      "deletions.manage",
      "settings.manage",
      "audit.view",
      "ledger.view",
      "reports.view",
      "reconciliation.view",
      "dividends.view",
      "dividends.approve",
      "dividends.pay",
      "loan.disburse",
      "withdrawals.view",
      "withdrawals.sync",
      // Read access that the Overview and Reports figures need:
      "membership.view",
      "savings.view",
      "repayments.view",
      "loans.view",
      "transactions.view",
    ],
    sections: [
      "overview",
      "members",
      "loan-requests",
      "loans",
      "withdrawals",
      "dividends",
      "transactions",
      "reports",
      "ledger",
      "reconciliation",
      "deletions",
      "audit",
      "settings",
    ],
  },
};

export const ADMIN_ROLE_KEYS = Object.keys(ADMIN_ROLES);

/** The role a user acts under. Admins created before roles existed are "full". */
export const adminRoleOf = (user) =>
  user?.role === "admin" && ADMIN_ROLES[user.adminRole] ? user.adminRole : "full";

/** The list of permissions a user has ([] for anyone who is not an admin). */
export const permissionsFor = (user) => {
  if (user?.role !== "admin") return [];
  return ADMIN_ROLES[adminRoleOf(user)].permissions;
};

/** True when the user holds at least one of the listed permissions. */
export const hasAnyPermission = (user, wanted) => {
  const have = permissionsFor(user);
  if (have.includes("*")) return true;
  return wanted.some((permission) => have.includes(permission));
};

/** What the website and app receive about a signed-in user's admin role. */
export const adminAccessPayload = (user) =>
  user?.role === "admin"
    ? {
        adminRole: adminRoleOf(user),
        adminRoleLabel: ADMIN_ROLES[adminRoleOf(user)].label,
        permissions: permissionsFor(user),
        sections: ADMIN_ROLES[adminRoleOf(user)].sections,
      }
    : {};
