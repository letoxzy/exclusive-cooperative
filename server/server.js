import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import connectDB from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import securityRoutes from "./routes/securityRoutes.js";
import membershipRoutes from "./routes/membershipRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import loanRoutes from "./routes/loanRoutes.js";
import kycRoutes from "./routes/kycRoutes.js";
import withdrawalRoutes from "./routes/withdrawalRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import galleryRoutes from "./routes/galleryRoutes.js";
import { startLoanOverdueScheduler } from "./services/loanOverdueService.js";


connectDB().then(() => {
  startLoanOverdueScheduler();
});

const app = express();

const allowedOrigins = [
  "http://localhost:5173",
  "https://exclusive-cooperative.vercel.app",
  "https://exclusivecooperative.com",
  "https://www.exclusivecooperative.com"
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    // Required so the website can send/receive the httpOnly auth cookie.
    credentials: true,
  })
);

app.use(cookieParser());

app.use(
  express.json({
    // Paystack's webhook signature is computed over the exact bytes it
    // sent. Re-serializing the parsed body with JSON.stringify() usually
    // matches, but isn't guaranteed to byte-for-byte (key order, number
    // formatting, etc.), which would falsely reject a genuine webhook.
    // Capturing the raw buffer here lets the webhook routes verify
    // against the real payload instead.
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Brute-force protection: limit how often one IP can hit the auth
// endpoints (login, register, password reset). The per-account lockout
// already handles repeated failures on one account; this stops an
// attacker from spraying attempts across many accounts or IPs.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts. Please try again later." },
});

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/security", securityRoutes);
app.use("/api/membership", membershipRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/loans", loanRoutes);
app.use("/api/kyc", kycRoutes);
app.use("/api/withdrawals", withdrawalRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/gallery", galleryRoutes);

app.get("/", (req, res) =>
  res.send("Exclusive Cooperative API is running")
);

// 404 for unknown API routes
app.use((req, res) => {
  res.status(404).json({ message: "Not found" });
});

// Global error handler: never leak internal error details or stack
// traces to clients in production.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  const message =
    process.env.NODE_ENV === "production" && status === 500
      ? "Something went wrong. Please try again later."
      : err.message || "Something went wrong. Please try again later.";
  res.status(status).json({ message });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () =>
  console.log(`Server running on port ${PORT}`)
);
