// One-time patcher: makes POST /api/security/pin (the app's Change PIN route)
// count wrong CURRENT-PIN guesses toward the same account lock-out as the PIN
// screen (5 failures -> 10 min, next 5 -> 30 min, next 5 -> admin unlock), and
// refuses to run while the account is locked. Before this, someone holding a
// stolen login token could guess the current PIN without limit.
//
// Run from the server folder:   node scripts/applyPinLockout.js
// Safe to run twice. Review with `git diff`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "routes/securityRoutes.js");

const marker = "current-pin lockout";

const edits = [
  {
    name: "load the lock-out fields",
    find: `  const member = await User.findById(req.user._id).select("+appPinHash");`,
    replace: `  const member = await User.findById(req.user._id).select(
    "+appPinHash +securityFailedAttempts +securityLockLevel +securityLockedUntil"
  );`,
  },
  {
    name: "count wrong current-PIN guesses",
    find: `    const matches = await bcrypt.compare(String(currentPin), member.appPinHash);

    if (!matches) {
      return res.status(401).json({
        code: "INCORRECT_PIN",
        message: "Current PIN is incorrect.",
      });
    }`,
    replace: `    // current-pin lockout: same rules as POST /api/security/pin/verify.
    const securityState = getSecurityState(member);

    if (securityState.permanent) {
      return res.status(403).json({
        code: "ACCOUNT_SECURITY_LOCKED",
        message:
          "Your account has been locked for security after repeated failed PIN or password attempts. Please contact the cooperative to unlock your account.",
      });
    }

    if (securityState.locked) {
      return res.status(429).json({
        code: "ACCOUNT_TEMPORARILY_LOCKED",
        message: \`Too many incorrect attempts. Please try again in \${Math.ceil((new Date(securityState.lockedUntil).getTime() - Date.now()) / 60000)} minutes.\`,
        lockedUntil: securityState.lockedUntil,
        securityLockLevel: securityState.level,
      });
    }

    const matches = await bcrypt.compare(String(currentPin), member.appPinHash);

    if (!matches) {
      const result = await recordSecurityFailure(member);

      if (result.permanent) {
        await notifyPermanentSecurityLock(member);
        return res.status(403).json({
          code: "ACCOUNT_SECURITY_LOCKED",
          message:
            "Your account has been locked for security after repeated failed PIN or password attempts. Please contact the cooperative to unlock your account.",
        });
      }

      if (result.locked) {
        return res.status(429).json({
          code: "ACCOUNT_TEMPORARILY_LOCKED",
          message: \`Too many incorrect attempts. Your account is locked for \${result.lockMinutes} minutes.\`,
          lockedUntil: result.lockedUntil,
          securityLockLevel: result.level,
        });
      }

      return res.status(401).json({
        code: "INCORRECT_PIN",
        message: \`Current PIN is incorrect. \${result.remainingAttempts} attempt\${result.remainingAttempts === 1 ? "" : "s"} remaining before a temporary lock.\`,
        remainingAttempts: result.remainingAttempts,
      });
    }

    await recordSecuritySuccess(member);`,
  },
];

const raw = fs.readFileSync(file, "utf8");
const crlf = raw.includes("\r\n");
let text = raw.replace(/\r\n/g, "\n");

if (text.includes(marker)) {
  console.log("already  current-PIN lock-out is already applied");
  process.exit(0);
}

for (const edit of edits) {
  const n = text.split(edit.find).length - 1;
  if (n !== 1) {
    console.log(`SKIPPED  "${edit.name}": expected 1 match, found ${n}. Nothing was changed.`);
    process.exit(1);
  }
}
for (const edit of edits) {
  text = text.replace(edit.find, () => edit.replace);
  console.log("applied ", edit.name);
}
fs.writeFileSync(file, crlf ? text.replace(/\n/g, "\r\n") : text);