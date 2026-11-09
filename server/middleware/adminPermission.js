import { hasAnyPermission } from "../utils/adminPermissions.js";

/**
 * Use after protect + adminOnly:
 *   router.patch("/loans/:id/disburse", requirePermission("loan.disburse"), ...)
 * Several permissions mean "any one of them is enough".
 */
export const requirePermission =
  (...wanted) =>
  (req, res, next) => {
    if (hasAnyPermission(req.user, wanted)) return next();

    return res.status(403).json({
      code: "ADMIN_ROLE_FORBIDDEN",
      message:
        "Your office role is not allowed to do this. Please ask your supervisor.",
    });
  };
