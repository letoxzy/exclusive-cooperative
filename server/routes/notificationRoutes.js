import express from "express";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import { protect } from "../middleware/authMiddleware.js";
import { getVapidPublicKey, sendWebPushToUser } from "../utils/webPush.js";

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

    // Use atomic updates instead of user.save(). This avoids validating
    // unrelated legacy push-token entries already stored on the account.
    // First remove this exact token if it already exists, then add the
    // current device with a normalized platform value.
    await User.updateOne(
      { _id: user._id },
      { $pull: { pushTokens: { token } } },
    );

    await User.updateOne(
      { _id: user._id },
      {
        $push: {
          pushTokens: {
            $each: [{ token, platform, updatedAt: new Date() }],
            $sort: { updatedAt: -1 },
            $slice: 5,
          },
        },
      },
    );

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

// GET /api/notifications/web-push/public-key
// The website needs this to ask the browser for notification permission.
router.get("/web-push/public-key", (req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

// POST /api/notifications/web-push/subscribe
// Save this browser's push subscription on the member's account.
router.post("/web-push/subscribe", protect, async (req, res) => {
  try {
    const sub = req.body?.subscription || {};
    const endpoint = String(sub.endpoint || "");
    const p256dh = String(sub.keys?.p256dh || "");
    const auth = String(sub.keys?.auth || "");

    if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth) {
      return res.status(400).json({ message: "A valid push subscription is required." });
    }

    // Replace this endpoint if it exists (it may have belonged to another
    // account on a shared computer), then keep the 5 most recent browsers.
    await User.updateMany(
      { "webPushSubscriptions.endpoint": endpoint },
      { $pull: { webPushSubscriptions: { endpoint } } }
    );

    await User.updateOne(
      { _id: req.user._id },
      {
        $push: {
          webPushSubscriptions: {
            $each: [
              {
                endpoint,
                p256dh,
                auth,
                userAgent: String(req.get("User-Agent") || "").slice(0, 200),
                createdAt: new Date(),
              },
            ],
            $slice: -5,
          },
        },
      }
    );

    res.json({ message: "Website notifications turned on." });
  } catch (err) {
    console.error("Web push subscribe error:", err);
    res.status(500).json({ message: "Failed to turn on website notifications." });
  }
});

// DELETE /api/notifications/web-push/subscribe — { endpoint }
router.delete("/web-push/subscribe", protect, async (req, res) => {
  try {
    const endpoint = String(req.body?.endpoint || "");
    if (!endpoint) return res.status(400).json({ message: "Endpoint is required." });

    await User.updateOne(
      { _id: req.user._id },
      { $pull: { webPushSubscriptions: { endpoint } } }
    );

    res.json({ message: "Website notifications turned off." });
  } catch (err) {
    console.error("Web push unsubscribe error:", err);
    res.status(500).json({ message: "Failed to turn off website notifications." });
  }
});

// POST /api/notifications/web-push/test — sends a confirmation notification
router.post("/web-push/test", protect, async (req, res) => {
  const result = await sendWebPushToUser(req.user._id, {
    type: "announcement",
    title: "Notifications are on",
    body: "You will now get alerts from Exclusive Cooperative in this browser.",
  });
  res.json(result);
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