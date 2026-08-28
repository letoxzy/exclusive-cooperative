import express from "express";
import multer from "multer";
import SavingsTransaction from "../models/SavingsTransaction.js";
import { protect } from "../middleware/authMiddleware.js";
import { uploadBufferToCloudinary } from "../utils/cloudinaryUpload.js";

const router = express.Router();

const uploadAvatar = multer({ storage: multer.memoryStorage() });

// PATCH /api/users/me   body: { fullName }
router.patch("/me", protect, async (req, res) => {
  const { fullName } = req.body;
  if (!fullName || !fullName.trim()) {
    return res.status(400).json({ message: "Full name cannot be empty" });
  }
  req.user.fullName = fullName.trim();
  await req.user.save();
  res.json(req.user);
});

// PATCH /api/users/me/password   body: { currentPassword, newPassword }
router.patch("/me/password", protect, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: "Both current and new password are required" });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ message: "New password must be at least 6 characters" });
  }

  const matches = await req.user.matchPassword(currentPassword);
  if (!matches) {
    return res.status(401).json({ message: "Current password is incorrect" });
  }

  req.user.password = newPassword;
  await req.user.save();
  res.json({ message: "Password updated" });
});

// POST /api/users/me/avatar   (multipart/form-data, field name "avatar")
router.post("/me/avatar", protect, uploadAvatar.single("avatar"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No image uploaded" });
  }

  try {
    const result = await uploadBufferToCloudinary(req.file.buffer, {
      folder: "exclusive-cooperative/avatars",
      transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }],
    });

    req.user.avatarUrl = result.secure_url;
    await req.user.save();
    res.json({ avatarUrl: req.user.avatarUrl });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/users/me/savings-requests
// History of a member's savings top-ups. Manual/bank-transfer submission
// was removed — every top-up now comes through Paystack's checkout, so
// entries here will always be method: "paystack".
router.get("/me/savings-requests", protect, async (req, res) => {
  const txns = await SavingsTransaction.find({ user: req.user._id }).sort("-createdAt");
  res.json(txns);
});

// GET /api/users/me/transactions
// Member transaction history
router.get("/me/transactions", protect, async (req, res) => {
  try {
    const savingsTransactions = await SavingsTransaction.find({
      user: req.user._id,
    }).sort("-createdAt");

    const transactions = savingsTransactions.map((transaction) => ({
      _id: transaction._id,
      type: "savings",
      description: "Savings Deposit",
      amount: Number(transaction.amount || 0),
      status: transaction.status,
      reference: transaction.reference || null,
      date: transaction.createdAt,
    }));

    res.json(transactions);
  } catch (err) {
    console.error("Transaction history error:", err);
    res.status(500).json({
      message: "Failed to load transactions",
    });
  }
});

export default router;