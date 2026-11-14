export const ADMIN_NOT_MEMBER_MESSAGE =
  "Administrator and staff accounts cannot use member services. Use your own member account for personal savings, loans or withdrawals.";

export const memberOnly = (req, res, next) => {
  if (req.user?.role === "admin") {
    return res.status(403).json({ message: ADMIN_NOT_MEMBER_MESSAGE });
  }

  next();
};

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
