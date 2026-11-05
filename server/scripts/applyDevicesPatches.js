// One-time patcher for "My devices" / "Sign out other devices":
//  - adds User.sessionsValidAfter,
//  - makes the auth middleware reject tokens issued before that moment,
//  - mounts the new /api/devices routes in server.js.
//
// Run from the server folder:   node scripts/applyDevicesPatches.js
// Safe to run twice. Each edit must match exactly one place or it is skipped.
// Needs the earlier patchers (applyAlertPatches.js and applyOfficeAssistPatches.js)
// to have been run. Review the result with `git diff`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const edits = [
  {
    file: "models/User.js",
    name: "User: sessionsValidAfter",
    marker: "sessionsValidAfter",
    find: `    smsNotifications: { type: Boolean, default: true },
`,
    replace: `    smsNotifications: { type: Boolean, default: true },

    // "Sign out other devices": login tokens issued before this moment are
    // rejected by the auth middleware.
    sessionsValidAfter: { type: Date, default: null },
`,
  },
  {
    file: "middleware/authMiddleware.js",
    name: "auth: reject signed-out sessions",
    marker: "SESSION_ENDED",
    find: `    if (req.user.isBlocked) {`,
    replace: `    // Tokens issued before "Sign out other devices" was used are no longer valid.
    if (
      req.user.sessionsValidAfter &&
      decoded.iat &&
      decoded.iat * 1000 < new Date(req.user.sessionsValidAfter).getTime()
    ) {
      return res.status(401).json({
        code: "SESSION_ENDED",
        message: "You were signed out of this device. Please log in again.",
      });
    }

    if (req.user.isBlocked) {`,
  },
  {
    file: "server.js",
    name: "server: import device routes",
    marker: "routes/deviceRoutes.js",
    find: `import ussdRoutes from "./routes/ussdRoutes.js";`,
    replace: `import ussdRoutes from "./routes/ussdRoutes.js";
import deviceRoutes from "./routes/deviceRoutes.js";`,
  },
  {
    file: "server.js",
    name: "server: mount /api/devices",
    marker: `"/api/devices"`,
    find: `app.use("/api/ussd", ussdRoutes);`,
    replace: `app.use("/api/ussd", ussdRoutes);
app.use("/api/devices", deviceRoutes);`,
  },
];

const count = (h, n) => h.split(n).length - 1;
const files = new Map();
const results = [];

for (const edit of edits) {
  const full = path.join(root, edit.file);
  if (!fs.existsSync(full)) { results.push(["MISSING", edit.name, `${edit.file} not found`]); continue; }
  if (!files.has(edit.file)) {
    const raw = fs.readFileSync(full, "utf8");
    files.set(edit.file, { text: raw.replace(/\r\n/g, "\n"), crlf: raw.includes("\r\n"), changed: false });
  }
  const entry = files.get(edit.file);
  if (entry.text.includes(edit.marker)) { results.push(["already", edit.name, ""]); continue; }
  const n = count(entry.text, edit.find);
  if (n !== 1) { results.push(["SKIPPED", edit.name, `expected 1 match, found ${n}; were the earlier patchers run?`]); continue; }
  entry.text = entry.text.replace(edit.find, () => edit.replace);
  entry.changed = true;
  results.push(["applied", edit.name, ""]);
}

for (const [file, entry] of files) {
  if (!entry.changed) continue;
  fs.writeFileSync(path.join(root, file), entry.crlf ? entry.text.replace(/\n/g, "\r\n") : entry.text);
}
for (const [status, name, note] of results) console.log(status.padEnd(8), name, note ? `- ${note}` : "");
