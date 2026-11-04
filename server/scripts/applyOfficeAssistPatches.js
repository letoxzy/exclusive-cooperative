// One-time patcher for the office-assisted USSD activation:
//  - adds the activation fields to the User model,
//  - adds POST /api/admin/members/:id/ussd-activation to the admin routes.
//
// Run from the server folder:   node scripts/applyOfficeAssistPatches.js
// Safe to run twice. Each edit must match exactly one place or it is skipped.
// Needs applyAlertPatches.js to have been run first (it adds the User fields
// this script builds on). Review the result with `git diff`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const ROUTE = `// POST /api/admin/members/:id/ussd-activation
// Issues a one-time code so a member without a smartphone can choose their own
// USSD PIN. The code is returned ONCE here; only its hash is stored. Issuing
// one for a member who already has a PIN is an in-person PIN reset.
router.post("/members/:id/ussd-activation", async (req, res) => {
  try {
    const member = await User.findById(req.params.id).select(
      "fullName email role isApprovedMember isBlocked"
    );

    if (!member) {
      return res.status(404).json({ message: "Member account not found." });
    }
    if (member.role === "admin") {
      return res.status(403).json({ message: "Administrator accounts cannot use USSD." });
    }
    if (!member.isApprovedMember || member.isBlocked) {
      return res.status(400).json({
        message: "Only approved, unblocked members can be activated for USSD.",
      });
    }

    const membership = await Membership.findOne({
      user: member._id,
      status: "approved",
    }).select("phone");
    const phone = normalizeNgPhone(membership?.phone);
    if (!phone) {
      return res.status(400).json({
        message:
          "This member has no valid phone number on their membership. Correct the phone number first.",
      });
    }

    const { code, expiresAt } = await issueActivation(member._id);

    await audit(req, "member.ussd_activation_issued", "User", member._id, {
      member: member.email,
      phoneEnding: phone.slice(-4),
      expiresAt,
    });

    // Tell the member, so a code they never asked for does not go unnoticed.
    try {
      await createNotificationAndPush({
        user: member._id,
        type: "security",
        title: "USSD Activation Code Issued",
        message:
          "The cooperative office issued a code for you to set up your PIN on USSD. If you did not ask for this, contact the cooperative immediately.",
      });
    } catch (notificationError) {
      console.error("USSD activation notification failed:", notificationError);
    }

    res.setHeader("Cache-Control", "no-store");
    return res.json({ code, expiresAt, phoneEnding: phone.slice(-4) });
  } catch (err) {
    console.error("USSD activation error:", err);
    return res.status(500).json({ message: "Failed to issue the activation code." });
  }
});

`;

const edits = [
  {
    file: "models/User.js",
    name: "User: activation fields",
    marker: "ussdActivationHash",
    find: `    smsNotifications: { type: Boolean, default: true },
`,
    replace: `    smsNotifications: { type: Boolean, default: true },

    // One-time code issued by the office so a member without a smartphone can
    // set their own PIN over USSD. Only a hash is stored.
    ussdActivationHash: { type: String, select: false },
    ussdActivationExpires: { type: Date, select: false },
    ussdActivationFailures: { type: Number, default: 0, select: false },
`,
  },
  {
    file: "routes/adminRoutes.js",
    name: "admin: imports",
    marker: "utils/ussdActivation.js",
    find: `import { audit } from "../utils/audit.js";`,
    replace: `import { audit } from "../utils/audit.js";
import { issueActivation } from "../utils/ussdActivation.js";
import { normalizeNgPhone } from "../sms.js";`,
  },
  {
    file: "routes/adminRoutes.js",
    name: "admin: POST /members/:id/ussd-activation",
    marker: `"/members/:id/ussd-activation"`,
    find: `/*
  ============================
  DELETE MEMBER ACCOUNT
  ============================
*/`,
    replace:
      ROUTE +
      `/*
  ============================
  DELETE MEMBER ACCOUNT
  ============================
*/`,
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
  if (n !== 1) { results.push(["SKIPPED", edit.name, `expected 1 match, found ${n}; was applyAlertPatches.js run first?`]); continue; }
  entry.text = entry.text.replace(edit.find, () => edit.replace);
  entry.changed = true;
  results.push(["applied", edit.name, ""]);
}

for (const [file, entry] of files) {
  if (!entry.changed) continue;
  fs.writeFileSync(path.join(root, file), entry.crlf ? entry.text.replace(/\n/g, "\r\n") : entry.text);
}
for (const [status, name, note] of results) console.log(status.padEnd(8), name, note ? `- ${note}` : "");
