// One-time patcher: closes a hole in PATCH /api/users/me/security/pin, which
// let anyone holding a login token overwrite an existing app PIN without
// knowing the current one. After this, that route only CREATES a first PIN;
// changing an existing PIN must go through POST /api/security/pin (the route
// the mobile app already uses), which asks for the current PIN.
//
// Run from the server folder:   node scripts/applyPinLockdown.js
// Safe to run twice. Review with `git diff`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "routes/userRoutes.js");

const marker = "PIN_ALREADY_SET";
const find = `    const hadPin = Boolean(user.appPinHash);
    user.appPinHash = await bcrypt.hash(pin, 12);`;
const replace = `    const hadPin = Boolean(user.appPinHash);

    // Changing an existing PIN requires the current PIN, which only
    // POST /api/security/pin checks (with the account lock-out rules).
    // Allowing it here would let a stolen login token overwrite the PIN.
    if (hadPin) {
      return res.status(409).json({
        code: "PIN_ALREADY_SET",
        message: "A PIN is already set. Use Change PIN in the mobile app to change it.",
      });
    }

    user.appPinHash = await bcrypt.hash(pin, 12);`;

const raw = fs.readFileSync(file, "utf8");
const crlf = raw.includes("\r\n");
let text = raw.replace(/\r\n/g, "\n");

if (text.includes(marker)) {
  console.log("already  PIN lockdown is already applied");
} else {
  const n = text.split(find).length - 1;
  if (n !== 1) {
    console.log(`SKIPPED  expected 1 match in routes/userRoutes.js, found ${n}. Did you run applyAlertPatches.js first?`);
    process.exit(1);
  }
  text = text.replace(find, () => replace);
  fs.writeFileSync(file, crlf ? text.replace(/\n/g, "\r\n") : text);
  console.log("applied  PATCH /api/users/me/security/pin no longer overwrites an existing PIN");
}
