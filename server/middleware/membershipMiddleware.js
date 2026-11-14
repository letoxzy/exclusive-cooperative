// Must run after `protect`.

export const ADMIN_NOT_MEMBER_MESSAGE =
  "Administrator and staff accounts cannot use member services. Use your own member account for personal savings, loans or withdrawals.";

// Member-only routes. Administrator and staff accounts work on the admin page
// only: they are not members, and an account that can both approve and use
// cooperative money is a conflict of interest.
export const memberOnly = (req, res, next) => {
  if (req.user?.role === "admin") {
    return res.status(403).json({ message: ADMIN_NOT_MEMBER_MESSAGE });
  }

  next();
};

// Blocks cooperative financial actions until the member's
// membership application has been approved by an admin.
export const requireApprovedMember = (req, res, next) => {
  if (req.user?.role === "admin") {
    return res.status(403).json({ message: ADMIN_NOT_MEMBER_MESSAGE });
  }

  if (!req.user.isApprovedMember) {
    return res.status(403).json({
      message:
        "Your membership application must be approved before you can use this cooperative service.",
    });
  }

  next();
};
