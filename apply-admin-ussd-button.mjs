// One-time patcher: adds a "USSD Code" button to each member in the admin
// dashboard. Staff click it, confirm, and the activation code is shown ONCE.
//
// Run from the WEBSITE project root (the folder that contains src/):
//   node apply-admin-ussd-button.mjs
// Safe to run twice. Each edit must match exactly one place or it is skipped.
// Review the result with `git diff`.
import fs from "node:fs";
import path from "node:path";

const file = path.join(process.cwd(), "src/pages/AdminDashboard.jsx");
if (!fs.existsSync(file)) {
  console.log("MISSING  src/pages/AdminDashboard.jsx - run this from the website project root.");
  process.exit(1);
}

const edits = [
  {
    name: "import the notice modal",
    marker: 'import AdminNoticeModal from "../components/admin/AdminNoticeModal";',
    find: `import AdminActionModal from "../components/admin/AdminActionModal";`,
    replace: `import AdminActionModal from "../components/admin/AdminActionModal";
import AdminNoticeModal from "../components/admin/AdminNoticeModal";`,
  },
  {
    name: "state for the one-time code",
    marker: "const [ussdCodeNotice, setUssdCodeNotice]",
    find: `  const [members, setMembers] = useState([]);
`,
    replace: `  const [members, setMembers] = useState([]);
  const [ussdCodeNotice, setUssdCodeNotice] = useState(null);
`,
  },
  {
    name: "request the code when confirmed",
    marker: `actionModal.type === "ussd-activation"`,
    find: `      if (actionModal.type === "delete-member") {`,
    replace: `      if (actionModal.type === "ussd-activation") {
        const issued = await request(
          \`/admin/members/\${actionModal.member._id}/ussd-activation\`,
          {
            method: "POST",
            token: user.token,
          },
        );

        setUssdCodeNotice({
          name: actionModal.member.fullName || actionModal.member.email,
          code: issued.code,
          phoneEnding: issued.phoneEnding,
        });
      }

      if (actionModal.type === "delete-member") {`,
  },
  {
    name: "button handler",
    marker: "const handleUssdActivation",
    find: `  const handleBlockToggle = (member) => {`,
    replace: `  const handleUssdActivation = (member) => {
    if (!member?._id || member.role === "admin") return;

    setActionModal({
      type: "ussd-activation",
      member,
      title: "Create USSD Activation Code",
      description: \`This creates a one-time code for \${member.fullName || member.email}. Give it to the member in person only after checking their ID. They dial the USSD code from their registered phone, enter the code, and choose their own 6-digit PIN. If they already have a PIN, it will be replaced. The code is valid for 48 hours and is shown only once.\`,
      confirmText: "Create Code",
      danger: false,
    });
  };

  const handleBlockToggle = (member) => {`,
  },
  {
    name: "button in the member row",
    marker: "handleUssdActivation(m)",
    find: `                          <div className="member-action-stack">
`,
    replace: `                          <div className="member-action-stack">
                            <button
                              type="button"
                              className="admin-secondary-btn"
                              onClick={() => handleUssdActivation(m)}
                              title={\`Create a USSD activation code for \${m.fullName || "member"}\`}
                            >
                              USSD Code
                            </button>
`,
  },
  {
    name: "show the code once",
    marker: "open={Boolean(ussdCodeNotice)}",
    find: `      <AddExistingMemberModal
        open={showAddExistingMember}`,
    replace: `      <AdminNoticeModal
        open={Boolean(ussdCodeNotice)}
        title="USSD activation code"
        message={
          ussdCodeNotice
            ? \`\${ussdCodeNotice.name}: \${ussdCodeNotice.code}. Valid for 48 hours and shown only once. The member dials the USSD code from the phone ending \${ussdCodeNotice.phoneEnding}, enters this code, then chooses a new 6-digit PIN.\`
            : ""
        }
        onClose={() => setUssdCodeNotice(null)}
      />

      <AddExistingMemberModal
        open={showAddExistingMember}`,
  },
];

const raw = fs.readFileSync(file, "utf8");
const crlf = raw.includes("\r\n");
let text = raw.replace(/\r\n/g, "\n");
let changed = false;

for (const edit of edits) {
  if (text.includes(edit.marker)) { console.log("already ", edit.name); continue; }
  const n = text.split(edit.find).length - 1;
  if (n !== 1) { console.log("SKIPPED ", edit.name, `- expected 1 match, found ${n}; edit this one by hand`); continue; }
  text = text.replace(edit.find, () => edit.replace);
  changed = true;
  console.log("applied ", edit.name);
}

if (changed) fs.writeFileSync(file, crlf ? text.replace(/\n/g, "\r\n") : text);
