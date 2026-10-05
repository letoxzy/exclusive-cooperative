import jwt from "jsonwebtoken";
import User from "../models/User.js";

// Verifies the JWT sent in the Authorization header
// and attaches the authenticated user to req.user.
export const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  // Accept the token either as a Bearer header (mobile app) or as an
  // httpOnly cookie (website). The cookie can't be read by JavaScript,
  // which protects website users from token theft via script injection.
  let token;
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  } else if (req.cookies?.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({
      message: "Not authorized, no token",
    });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    // Only a bad/expired token is an authentication failure.
    return res.status(401).json({
      message:
        err?.name === "TokenExpiredError"
          ? "Your session has expired. Please log in again."
          : "Not authorized, invalid token",
    });
  }

  try {

    // Keep the password hidden from normal authenticated requests.
    // The password-change route will fetch the user separately
    // when it needs to verify the current password.
    req.user = await User.findById(decoded.id).select("-password");

    if (!req.user) {
      return res.status(401).json({
        message: "User no longer exists",
      });
    }

    if (req.user.isBlocked) {
      return res.status(403).json({
        code: "ACCOUNT_BLOCKED",
        message: "Your account has been blocked by an administrator. Please contact the cooperative.",
      });
    }

    if (req.user.role !== "admin" && req.user.securityLockedPermanently) {
      return res.status(403).json({
        code: "ACCOUNT_SECURITY_LOCKED",
        message: "Your account has been locked for security after repeated failed sign-in attempts. Please contact the cooperative to unlock your account.",
      });
    }

    next();
  } catch (err) {
    // Database/other failure: NOT an auth problem. Answering 401 here made the
    // mobile app think the session had expired and log the member out whenever
    // the database was slow or briefly unreachable.
    console.error("Authentication error:", err);

    return res.status(503).json({
      message: "Service temporarily unavailable. Please try again shortly.",
    });
  }
};
