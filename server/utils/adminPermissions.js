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

export const ADMIN_ROLES = {
  full: {
    label: "Full Administrator",
    permissions: ["*"],
  },

  membership: {
    label: "Membership & Member Care Officer",
    permissions: [
      "overview.view",
      "members.view",
      "members.ussd",
      "members.add",
      "membership.review",
      "gallery.manage",
    ],
  },

  cash: {
    label: "Cash Officer",
    permissions: [
      "overview.view",
      "savings.review",
      "repayments.review",
      "loans.view",
      "transactions.view",
    ],
  },

  loan: {
    label: "Loan Officer",
    permissions: [
      "overview.view",
      "loan.eligibility",
      "loan.decide",
      "loans.view",
    ],
  },

  disbursement: {
    label: "Disbursement Officer",
    permissions: [
      "overview.view",
      "loans.view",
      "loan.disburse",
      "withdrawals.view",
      "withdrawals.sync",
    ],
  },

  finance: {
    label: "Finance Officer",
    permissions: [
      "overview.view",
      "reconciliation.view",
      "reconciliation.credit",
      "ledger.view",
      "reports.view",
      "dividends.view",
      "dividends.prepare",
      "transactions.view",
      "savings.view",
      "repayments.view",
      "loans.view",
      "withdrawals.view",
      "members.view",
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
      "membership.view",
      "savings.view",
      "repayments.view",
      "loan.eligibility.view",
      "loans.view",
      "transactions.view",
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
      }
    : {};
