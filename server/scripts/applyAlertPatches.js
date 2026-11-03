// One-time patcher: adds the security-alert, new-device and contribution-
// reminder hooks to your existing files. Run from the server folder:
//
//   node scripts/applyAlertPatches.js
//
// Safe to run twice (already-applied edits are skipped). Every edit must match
// exactly ONE place in the file, otherwise that edit is skipped and reported,
// and nothing in that file is changed. Review the result with `git diff`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const edits = [
  {
    file: "models/User.js",
    name: "User: smsNotifications + knownDevices fields",
    marker: "knownDevices",
    find: `    // Expo push tokens are stored on the account so security notifications`,
    replace: `    // Members can switch SMS copies of their notifications off.
    smsNotifications: { type: Boolean, default: true },

    // Hashed fingerprints of devices that have signed in, used for the
    // "new sign-in" alert. Hidden from normal queries.
    knownDevices: {
      type: [{ _id: false, id: String, label: String, firstSeen: Date, lastSeen: Date }],
      default: [],
      select: false,
    },

    // Expo push tokens are stored on the account so security notifications`,
  },
  {
    file: "routes/authRoutes.js",
    name: "auth: imports",
    marker: "utils/deviceTracker.js",
    find: `import { validatePassword } from "../utils/passwordPolicy.js";`,
    replace: `import { validatePassword } from "../utils/passwordPolicy.js";
import { recordLoginDevice } from "../utils/deviceTracker.js";
import { alertSecurityChange } from "../utils/securityAlerts.js";`,
  },
  {
    file: "routes/authRoutes.js",
    name: "auth: password reset alert",
    marker: `"password-reset"`,
    find: `    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    await user.save();
`,
    replace: `    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    await user.save();
    void alertSecurityChange(user._id, "password-reset");
`,
  },
  {
    file: "routes/authRoutes.js",
    name: "auth: new-device check on login",
    marker: "recordLoginDevice(user",
    find: `    const token = generateToken(user._id);
    setAuthCookie(res, token);

    res.json({
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      savingsBalance: user.savingsBalance,`,
    replace: `    const token = generateToken(user._id);
    setAuthCookie(res, token);
    void recordLoginDevice(user, req);

    res.json({
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      savingsBalance: user.savingsBalance,`,
  },
  {
    file: "routes/userRoutes.js",
    name: "users: import",
    marker: "utils/securityAlerts.js",
    find: `import { validatePassword } from "../utils/passwordPolicy.js";`,
    replace: `import { validatePassword } from "../utils/passwordPolicy.js";
import { alertSecurityChange } from "../utils/securityAlerts.js";`,
  },
  {
    file: "routes/userRoutes.js",
    name: "users: password changed alert",
    marker: `"password-changed"`,
    find: `    user.password = newPassword;
    user.mustChangePassword = false;

    await user.save();
`,
    replace: `    user.password = newPassword;
    user.mustChangePassword = false;

    await user.save();
    void alertSecurityChange(user._id, "password-changed");
`,
  },
  {
    file: "routes/userRoutes.js",
    name: "users: PIN saved alert",
    marker: "const hadPin = Boolean(user.appPinHash);",
    find: `    user.appPinHash = await bcrypt.hash(pin, 12);
    user.appPinFailedAttempts = 0;
    user.appPinLockedUntil = null;
    await user.save();
`,
    replace: `    const hadPin = Boolean(user.appPinHash);
    user.appPinHash = await bcrypt.hash(pin, 12);
    user.appPinFailedAttempts = 0;
    user.appPinLockedUntil = null;
    await user.save();
    void alertSecurityChange(user._id, hadPin ? "pin-changed" : "pin-created");
`,
  },
  {
    file: "routes/securityRoutes.js",
    name: "security: import",
    marker: "utils/securityAlerts.js",
    find: `import { protect } from "../middleware/authMiddleware.js";`,
    replace: `import { protect } from "../middleware/authMiddleware.js";
import { alertSecurityChange } from "../utils/securityAlerts.js";`,
  },
  {
    file: "routes/securityRoutes.js",
    name: "security: PIN created/changed alert",
    marker: `"pin-changed" : "pin-created"`,
    find: `  member.appPinHash = await bcrypt.hash(String(pin), 12);
  await member.save();
`,
    replace: `  member.appPinHash = await bcrypt.hash(String(pin), 12);
  await member.save();
  void alertSecurityChange(member._id, hadPin ? "pin-changed" : "pin-created");
`,
  },
  {
    file: "server.js",
    name: "server: import reminder scheduler",
    marker: "contributionReminderService",
    find: `import { startLoanOverdueScheduler } from "./services/loanOverdueService.js";`,
    replace: `import { startLoanOverdueScheduler } from "./services/loanOverdueService.js";
import { startContributionReminderScheduler } from "./services/contributionReminderService.js";`,
  },
  {
    file: "server.js",
    name: "server: start reminder scheduler",
    marker: "startContributionReminderScheduler();",
    find: `connectDB().then(async () => {
  startLoanOverdueScheduler();
`,
    replace: `connectDB().then(async () => {
  startLoanOverdueScheduler();
  startContributionReminderScheduler();
`,
  },
  {
    file: "package.json",
    name: "package.json: reminders:dry-run script",
    marker: "reminders:dry-run",
    find: `    "dividends:freeze-interest": "node scripts/freezeRepaymentInterest.js"`,
    replace: `    "dividends:freeze-interest": "node scripts/freezeRepaymentInterest.js",
    "reminders:dry-run": "node scripts/contributionRemindersDryRun.js"`,
  },
];

const count = (haystack, needle) => haystack.split(needle).length - 1;
const files = new Map(); // file -> { text (LF), crlf }
const results = [];

for (const edit of edits) {
  const full = path.join(root, edit.file);
  if (!fs.existsSync(full)) {
    results.push(["MISSING", edit.name, `${edit.file} not found`]);
    continue;
  }
  if (!files.has(edit.file)) {
    const raw = fs.readFileSync(full, "utf8");
    files.set(edit.file, { text: raw.replace(/\r\n/g, "\n"), crlf: raw.includes("\r\n"), changed: false });
  }
  const entry = files.get(edit.file);

  if (entry.text.includes(edit.marker)) {
    results.push(["already", edit.name, ""]);
    continue;
  }
  const n = count(entry.text, edit.find);
  if (n !== 1) {
    results.push(["SKIPPED", edit.name, `expected 1 match, found ${n}; edit this one by hand`]);
    continue;
  }
  entry.text = entry.text.replace(edit.find, () => edit.replace);
  entry.changed = true;
  results.push(["applied", edit.name, ""]);
}

for (const [file, entry] of files) {
  if (!entry.changed) continue;
  const out = entry.crlf ? entry.text.replace(/\n/g, "\r\n") : entry.text;
  fs.writeFileSync(path.join(root, file), out);
}

for (const [status, name, note] of results) {
  console.log(status.padEnd(8), name, note ? `- ${note}` : "");
}
