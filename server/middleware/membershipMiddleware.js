// Must run after `protect`.
// Blocks cooperative financial actions until the member's
// membership application has been approved by an admin.

export const requireApprovedMember = (req, res, next) => {
  if (!req.user.isApprovedMember) {
    return res.status(403).json({
      message:
        "Your membership application must be approved before you can use this cooperative service.",
    });
  }

  next();
};