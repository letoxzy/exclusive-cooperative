import express from "express";
import Notification from "../models/Notification.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

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