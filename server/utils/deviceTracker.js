import crypto from "crypto";
import User from "../models/User.js";
import { alertSecurityChange } from "./securityAlerts.js";

/**
 * "New sign-in" alerts.
 *
 * Each successful login is matched against the member's known devices
 * (stored as hashes in User.knownDevices). A device that has not been seen
 * before triggers an alert, EXCEPT the very first device ever recorded for
 * the account (so existing members are not alerted once after deployment).
 *
 * Mobile app: for reliable per-phone detection the app should send a random
 * ID, generated once and kept in secure storage, in the `X-Device-Id` header
 * (optionally a friendly name in `X-Device-Name`, e.g. "Pixel 7"). Without it,
 * all Android phones look like "the Android app" and all iPhones like "the
 * iOS app", so a login from a second phone on the same OS is not detected.
 * The website is identified by browser + operating system.
 *
 * recordLoginDevice never throws; call it as `void recordLoginDevice(...)`.
 */

const MAX_DEVICES = 10;

const sha = (value) => crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);

function webLabel(ua) {
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "a browser";
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Macintosh|Mac OS X/.test(ua)
          ? "Mac"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
}

export function describeDevice(req) {
  const header = String(req.get("X-App-Platform") || "").toLowerCase();
  const platform = header === "android" || header === "ios" ? header : "web";
  const ua = String(req.get("User-Agent") || "");

  const rawId = String(req.get("X-Device-Id") || "");
  const explicitId = /^[A-Za-z0-9_-]{8,64}$/.test(rawId) ? rawId : null;
  const rawName = String(req.get("X-Device-Name") || "").replace(/[^A-Za-z0-9 ._-]/g, "").trim().slice(0, 40);

  let label;
  if (platform === "web") label = webLabel(ua);
  else label = rawName ? `${rawName} (${platform === "ios" ? "iOS" : "Android"} app)` : platform === "ios" ? "the iOS app" : "the Android app";

  const id = explicitId ? sha(`d|${explicitId}`) : sha(`p|${platform}|${platform === "web" ? label : ""}`);
  return { id, label };
}

const whenLagos = (date = new Date()) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);

export async function recordLoginDevice(user, req) {
  try {
    if (!user?._id || user.role === "admin") return;

    const { id, label } = describeDevice(req);
    const now = new Date();

    const stored = await User.findById(user._id).select("+knownDevices").lean();
    const devices = stored?.knownDevices || [];

    if (devices.some((d) => d.id === id)) {
      await User.updateOne(
        { _id: user._id, "knownDevices.id": id },
        { $set: { "knownDevices.$.lastSeen": now } }
      );
      return;
    }

    await User.updateOne(
      { _id: user._id },
      {
        $push: {
          knownDevices: { $each: [{ id, label, firstSeen: now, lastSeen: now }], $slice: -MAX_DEVICES },
        },
      }
    );

    // First device ever recorded: just remember it.
    if (devices.length === 0) return;

    void alertSecurityChange(user._id, "new-device", { label, when: whenLagos(now) });
  } catch (err) {
    console.error("[device] could not record login device:", err?.message || err);
  }
}
