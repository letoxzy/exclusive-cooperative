// Maintenance mode + app update policy, controlled by Render environment variables.
// Optional updates:
//   LATEST_APP_VERSION=1.0.1
//   LATEST_APP_BUILD_NUMBER=2
//   ANDROID_APK_URL=https://github.com/OWNER/REPO/releases/download/v1.0.1/exclusive-cooperative.apk
//   APP_RELEASE_NOTES="Bug fixes and improvements"
// Critical / mandatory updates:
//   MIN_APP_VERSION_ANDROID=1.0.1   (older Android builds receive HTTP 426)
//   FORCE_APP_UPDATE=true           (makes the latest release mandatory when outdated)
// Existing variables remain supported: MIN_APP_VERSION, MIN_APP_VERSION_IOS,
// ANDROID_STORE_URL, IOS_STORE_URL, MAINTENANCE_MODE, MAINTENANCE_MESSAGE.

const ALWAYS_ALLOWED = [
  /^\/app-config$/,
  /^\/admin(\/|$)/,
  /^\/payments\/paystack\/webhook$/,
  /^\/withdrawals\/paystack\/webhook$/,
];

function parseVersion(value) {
  return String(value || "0").split("-")[0].split(".").map((part) => parseInt(part, 10) || 0);
}

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
  if (p === "android" && process.env.MIN_APP_VERSION_ANDROID) return process.env.MIN_APP_VERSION_ANDROID;
  if (p === "ios" && process.env.MIN_APP_VERSION_IOS) return process.env.MIN_APP_VERSION_IOS;
  return process.env.MIN_APP_VERSION || "0.0.0";
}

function downloadUrlFor(platform) {
  const p = String(platform || "").toLowerCase();
  if (p === "ios") return process.env.IOS_STORE_URL || "";
  return process.env.ANDROID_APK_URL || process.env.ANDROID_STORE_URL || "";
}

const maintenanceOn = () => String(process.env.MAINTENANCE_MODE || "").toLowerCase() === "true";
const maintenanceMessage = () => process.env.MAINTENANCE_MESSAGE || "We're doing some scheduled maintenance. Please try again shortly.";
const boolEnv = (name) => String(process.env[name] || "").toLowerCase() === "true";

// GET /api/app-config (public; checked on app launch and resume)
export const appConfigHandler = (req, res) => {
  const platform = req.get("X-App-Platform") || req.query.platform;
  res.set("Cache-Control", "no-store");
  res.json({
    maintenance: { enabled: maintenanceOn(), message: maintenanceOn() ? maintenanceMessage() : "" },
    minVersion: minVersionFor(platform),
    latestVersion: process.env.LATEST_APP_VERSION || "",
    latestBuildNumber: Math.max(0, parseInt(process.env.LATEST_APP_BUILD_NUMBER || "0", 10) || 0),
    forceUpdate: boolEnv("FORCE_APP_UPDATE"),
    releaseNotes: process.env.APP_RELEASE_NOTES || "A newer version of Exclusive Cooperative is available.",
    storeUrl: downloadUrlFor(platform),
  });
};

export const appGate = (req, res, next) => {
  if (ALWAYS_ALLOWED.some((pattern) => pattern.test(req.path))) return next();
  if (maintenanceOn()) return res.status(503).json({ code: "MAINTENANCE", message: maintenanceMessage() });

  // Mandatory enforcement is controlled by MIN_APP_VERSION(_ANDROID/_IOS).
  // Only clients announcing a version are enforced, preserving older clients
  // that predate version headers.
  const version = req.get("X-App-Version");
  const platform = req.get("X-App-Platform");
  if (version && isOlderVersion(version, minVersionFor(platform))) {
    return res.status(426).json({
      code: "UPDATE_REQUIRED",
      message: "A critical update is required to keep your account secure.",
      storeUrl: downloadUrlFor(platform),
    });
  }
  next();
};
