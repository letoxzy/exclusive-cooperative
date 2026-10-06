// Maintenance mode + minimum app version, controlled by environment variables
// (change them in Render and restart; no code change or app release needed).
//
//   MAINTENANCE_MODE=true            turn maintenance on
//   MAINTENANCE_MESSAGE="..."        text shown to members (optional)
//   MIN_APP_VERSION=1.0.3            oldest app version allowed (all platforms)
//   MIN_APP_VERSION_ANDROID / _IOS   per-platform override (optional)
//   ANDROID_STORE_URL / IOS_STORE_URL  where "Update" sends members (optional)

const DEFAULT_ANDROID_URL =
  "https://play.google.com/store/apps/details?id=com.exclusivecooperative.app";

// Server-to-server and staff traffic must keep working during maintenance.
// Blocking a Paystack webhook could lose a payment confirmation.
const ALWAYS_ALLOWED = [
  /^\/app-config$/,
  /^\/admin(\/|$)/,
  /^\/payments\/paystack\/webhook$/,
  /^\/withdrawals\/paystack\/webhook$/,
];

function parseVersion(value) {
  return String(value || "0")
    .split("-")[0]
    .split(".")
    .map((part) => parseInt(part, 10) || 0);
}

// true when `current` is older than `minimum`
export function isOlderVersion(current, minimum) {
  const a = parseVersion(current);
  const b = parseVersion(minimum);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x < y;
  }
  return false;
}

function minVersionFor(platform) {
  const p = String(platform || "").toLowerCase();
  if (p === "android" && process.env.MIN_APP_VERSION_ANDROID)
    return process.env.MIN_APP_VERSION_ANDROID;
  if (p === "ios" && process.env.MIN_APP_VERSION_IOS)
    return process.env.MIN_APP_VERSION_IOS;
  return process.env.MIN_APP_VERSION || "0.0.0";
}

function storeUrlFor(platform) {
  const p = String(platform || "").toLowerCase();
  if (p === "ios") return process.env.IOS_STORE_URL || "";
  return process.env.ANDROID_STORE_URL || DEFAULT_ANDROID_URL;
}

const maintenanceOn = () =>
  String(process.env.MAINTENANCE_MODE || "").toLowerCase() === "true";

const maintenanceMessage = () =>
  process.env.MAINTENANCE_MESSAGE ||
  "We're doing some scheduled maintenance. Please try again shortly.";

// GET /api/app-config  (public; the app calls this on launch and resume)
export const appConfigHandler = (req, res) => {
  const platform = req.get("X-App-Platform") || req.query.platform;
  res.set("Cache-Control", "no-store");
  res.json({
    maintenance: {
      enabled: maintenanceOn(),
      message: maintenanceOn() ? maintenanceMessage() : "",
    },
    minVersion: minVersionFor(platform),
    storeUrl: storeUrlFor(platform),
  });
};

// Mount on /api BEFORE the route handlers.
export const appGate = (req, res, next) => {
  if (ALWAYS_ALLOWED.some((pattern) => pattern.test(req.path))) return next();

  if (maintenanceOn()) {
    return res.status(503).json({
      code: "MAINTENANCE",
      message: maintenanceMessage(),
    });
  }

  // Only enforced for clients that announce their version, so older builds
  // that do not send the header are not locked out unexpectedly.
  const version = req.get("X-App-Version");
  const platform = req.get("X-App-Platform");
  if (version && isOlderVersion(version, minVersionFor(platform))) {
    return res.status(426).json({
      code: "UPDATE_REQUIRED",
      message: "Please update the app to continue.",
      storeUrl: storeUrlFor(platform),
    });
  }

  next();
};
