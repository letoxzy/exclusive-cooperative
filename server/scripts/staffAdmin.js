import "dotenv/config";
import crypto from "crypto";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import { ADMIN_ROLES, ADMIN_ROLE_KEYS } from "../utils/adminPermissions.js";

const [command, arg1, arg2] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const dryRun = flags.has("--dry-run");
const promote = flags.has("--promote");

const STAFF_ROLE_KEYS = ADMIN_ROLE_KEYS.filter((k) => k !== "full");
const normalize = (e) => String(e || "").trim().toLowerCase();
const list = (v) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);

function tempPassword() {
  const pick = (chars) => chars[crypto.randomInt(chars.length)];
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digit = "23456789";
  const symbol = "#@$%!*";
  const all = upper + lower + digit;
  const chars = [pick(upper), pick(lower), pick(digit), pick(symbol)];
  while (chars.length < 12) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

const fixedTemp = String(process.env.STAFF_TEMP_PASSWORD || "").trim();
const newTemp = () => fixedTemp || tempPassword();

const mainAdminEmail = normalize(process.env.ADMIN_EMAIL);

async function activeFullAdmins() {
  return User.countDocuments({ role: "admin", adminRole: "full", isBlocked: { $ne: true } });
}

async function cmdList() {
  const admins = await User.find({ role: "admin" }).select("fullName email adminRole isBlocked mustChangePassword").lean();
  if (!admins.length) return console.log("No administrator accounts found.");
  console.log("\nRole".padEnd(34), "Email".padEnd(38), "Status");
  for (const a of admins) {
    const role = ADMIN_ROLES[a.adminRole]?.label || "Full Administrator";
    const status = a.isBlocked ? "DISABLED" : a.mustChangePassword ? "must change password" : "active";
    console.log(role.padEnd(33), String(a.email).padEnd(38), status);
  }
}

async function cmdCreate() {
  const results = [];
  let any = false;

  for (const roleKey of STAFF_ROLE_KEYS) {
    const emails = list(process.env[`STAFF_${roleKey.toUpperCase()}_EMAIL`]).map(normalize);
    const names = list(process.env[`STAFF_${roleKey.toUpperCase()}_NAME`]);
    for (const [i, email] of emails.entries()) {
      any = true;
      const label = ADMIN_ROLES[roleKey].label;
      const fullName = names[i] || label;

      if (email === mainAdminEmail) {
        results.push([label, email, "SKIPPED: this is the main administrator", ""]);
        continue;
      }

      const existing = await User.findOne({ email });

      if (existing && existing.role !== "admin" && !promote) {
        results.push([label, email, "SKIPPED: already an ordinary member (use --promote to make them staff)", ""]);
        continue;
      }

      if (dryRun) {
        results.push([label, email, existing ? "would update role" : "would create", ""]);
        continue;
      }

      if (existing) {
        const wasAdmin = existing.role === "admin";
        existing.role = "admin";
        existing.adminRole = roleKey;
        if (names[i]) existing.fullName = fullName;
        let temp = "";
        if (!wasAdmin) {

          temp = newTemp();
          existing.password = temp;
          existing.mustChangePassword = true;
          existing.sessionsValidAfter = new Date();
        }
        await existing.save();
        results.push([label, email, wasAdmin ? "role updated" : "member promoted", temp]);
      } else {
        const temp = newTemp();
        await User.create({
          fullName,
          email,
          password: temp,
          role: "admin",
          adminRole: roleKey,
          mustChangePassword: true,
        });
        results.push([label, email, "created", temp]);
      }
    }
  }

  if (!any) {
    console.log("No STAFF_*_EMAIL values found in .env. See the top of this file.");
    return;
  }

  console.log(dryRun ? "\nDRY RUN: nothing was changed.\n" : "\nDone.\n");
  for (const [role, email, status, temp] of results) {
    console.log(`${role}\n  ${email}\n  ${status}${temp ? `\n  Temporary password: ${temp}` : ""}\n`);
  }
  if (results.some((r) => r[3])) {
    console.log("Give each person their own password PRIVATELY (never in a group chat).");
    console.log("They must choose a new password the first time they sign in.");
    if (fixedTemp) {
      console.log("\nWARNING: STAFF_TEMP_PASSWORD gave every account the SAME starting password.");
      console.log("Anyone who knows it can sign in as a colleague who has not logged in yet.");
    }
  }
}

async function findAdminOrExit(email) {
  const user = await User.findOne({ email: normalize(email) });
  if (!user || user.role !== "admin") {
    console.error(`No administrator account found for ${email}`);
    process.exit(1);
  }
  return user;
}

async function cmdRole() {
  if (!arg1 || !arg2 || !STAFF_ROLE_KEYS.includes(arg2)) {
    console.error(`Usage: node scripts/staffAdmin.js role <email> <${STAFF_ROLE_KEYS.join("|")}>`);
    process.exit(1);
  }
  const user = await findAdminOrExit(arg1);
  if (user.adminRole === "full" && (await activeFullAdmins()) <= 1) {
    console.error("Refusing: this is the only active Full Administrator.");
    process.exit(1);
  }
  user.adminRole = arg2;
  user.sessionsValidAfter = new Date(); 
  await user.save();
  console.log(`${user.email} is now: ${ADMIN_ROLES[arg2].label}`);
}

async function cmdReset() {
  if (!arg1) return console.error("Usage: node scripts/staffAdmin.js reset <email>");
  const user = await findAdminOrExit(arg1);
  const temp = newTemp();
  user.password = temp;
  user.mustChangePassword = true;
  user.sessionsValidAfter = new Date();
  await user.save();
  console.log(`${user.email}\n  New temporary password: ${temp}\n  They must change it at next sign-in. Existing sessions were signed out.`);
}

async function cmdDisable(disable) {
  if (!arg1) return console.error(`Usage: node scripts/staffAdmin.js ${disable ? "disable" : "enable"} <email>`);
  const user = await findAdminOrExit(arg1);
  if (disable && user.adminRole === "full" && (await activeFullAdmins()) <= 1) {
    console.error("Refusing: this is the only active Full Administrator.");
    process.exit(1);
  }
  user.isBlocked = disable;
  if (disable) user.sessionsValidAfter = new Date(); 
  await user.save();
  console.log(`${user.email} is now ${disable ? "DISABLED and signed out everywhere" : "enabled"}.`);
}

const run = async () => {
  await connectDB();
  switch (command) {
    case "list": await cmdList(); break;
    case "create": await cmdCreate(); break;
    case "role": await cmdRole(); break;
    case "reset": await cmdReset(); break;
    case "disable": await cmdDisable(true); break;
    case "enable": await cmdDisable(false); break;
    default:
      console.log("Commands: list | create [--dry-run] [--promote] | role <email> <role> | reset <email> | disable <email> | enable <email>");
  }
  process.exit(0);
};

run().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
