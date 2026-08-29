import jwt from "jsonwebtoken";
import User from "../models/User.js";

// Verifies the JWT sent in the Authorization header
// and attaches the authenticated user to req.user.
export const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Not authorized, no token",
    });
  }

  try {
    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Keep the password hidden from normal authenticated requests.
    // The password-change route will fetch the user separately
    // when it needs to verify the current password.
    req.user = await User.findById(decoded.id).select("-password");

    if (!req.user) {
      return res.status(401).json({
        message: "User no longer exists",
      });
    }

    next();
  } catch (err) {
    console.error("Authentication error:", err);

    return res.status(401).json({
      message: "Not authorized, invalid token",
    });
  }
};