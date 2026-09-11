import express from "express";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// POST /api/notifications/device-token
// Save the member's Expo push token on the account.
router.post("/device-token", protect, async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    const platform = String(req.body?.platform || "").toLowerCase();

    if (!token || !["ios", "android"].includes(platform)) {
      return res.status(400).json({ message: "A valid push token and platform are required." });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "Account not found." });

    const tokens = Array.isArray(user.pushTokens) ? user.pushTokens : [];
    const existing = tokens.find((item) => item.token === token);

    if (existing) {
      existing.platform = platform;
      existing.updatedAt = new Date();
    } else {
      tokens.push({ token, platform, updatedAt: new Date() });
    }

    // Keep only the most recent five devices/tokens for an account.
    user.pushTokens = tokens
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
      .slice(0, 5);

    await user.save();
    res.json({ message: "Push notification device registered." });
  } catch (err) {
    console.error("Device token registration error:", err);
    res.status(500).json({ message: "Failed to register notification device." });
  }
});

// DELETE /api/notifications/device-token
// Remove this device token when the member signs out.
router.delete("/device-token", protect, async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    if (!token) {
      return res.status(400).json({ message: "Push token is required." });
    }

    await User.updateOne(
      { _id: req.user._id },
      { $pull: { pushTokens: { token } } },
    );

    res.json({ message: "Push notification device removed." });
  } catch (err) {
    console.error("Device token removal error:", err);
    res.status(500).json({ message: "Failed to remove notification device." });
  }
});

// GET /api/notifications
// Get the logged-in member's notifications
router.get("/", protect, async (req, res) => {
  try {
    const notifications = await Notification.find({
      user: req.user._id,
    }).sort("-createdAt");

    res.json(notifications);
  } catch (err) {
    console.error("Notification fetch error:", err);

    res.status(500).json({
      message: "Failed to load notifications",
    });
  }
});

// PATCH /api/notifications/:id/read
// Mark one notification as read
router.patch("/:id/read", protect, async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      {
        _id: req.params.id,
        user: req.user._id,
      },
      {
        isRead: true,
      },
      {
        new: true,
      }
    );

    if (!notification) {
      return res.status(404).json({
        message: "Notification not found",
      });
    }

    res.json(notification);
  } catch (err) {
    console.error("Mark notification read error:", err);

    res.status(500).json({
      message: "Failed to mark notification as read",
    });
  }
});

// PATCH /api/notifications/read-all
// Mark all member notifications as read
router.patch("/read-all", protect, async (req, res) => {
  try {
    await Notification.updateMany(
      {
        user: req.user._id,
        isRead: false,
      },
      {
        isRead: true,
      }
    );

    res.json({
      message: "All notifications marked as read",
    });
  } catch (err) {
    console.error("Mark all notifications read error:", err);

    res.status(500).json({
      message: "Failed to mark notifications as read",
    });
  }
});

export default router;