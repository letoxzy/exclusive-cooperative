import { useEffect, useState } from "react";

const INITIAL_FORM = {
  fullName: "",
  gender: "",
  phone: "",
  email: "",
  employmentStatus: "",
  employmentOther: "",
  lga: "",
  dob: "",
  maritalStatus: "",
  whatsapp: "",
  occupation: "",
  stateOfOrigin: "",
  address: "",
  frequency: "",
  voluntarySavings: "",
  referralSource: "",
  proposedAmount: "",
  startDate: "",
  membershipCategory: "",
  membershipType: "interest-bearing",
  kinName: "",
  kinPhone: "",
  kinAddress: "",
  kinRelationship: "",
  kinAltPhone: "",
  kinEmail: "",
  beneficiaryName: "",
  beneficiaryPhone: "",
  beneficiaryAddress: "",
  beneficiaryRelationship: "",
  declarationName: "",
  declarationDate: "",
  declarationPhone: "",
  passportPhoto: null,
  signature: null,
};

const GROUPS = [
  {
    title: "Account & Personal Information",
    fields: [
      ["fullName", "Full Name", "text", true],
      ["email", "Email Address", "email", true],
      ["phone", "Phone", "text"],
      ["gender", "Gender", "text"],
      ["dob", "Date of Birth", "date"],
      ["maritalStatus", "Marital Status", "text"],
      ["whatsapp", "WhatsApp", "text"],
      ["occupation", "Occupation", "text"],
      ["employmentStatus", "Employment Status", "text"],
      ["employmentOther", "Employment Details", "text"],
      ["lga", "LGA", "text"],
      ["stateOfOrigin", "State of Origin", "text"],
      ["address", "Residential Address", "textarea"],
    ],
  },
  {
    title: "Membership & Savings",
    fields: [
      ["membershipType", "Membership Type", "select-membership"],
      ["membershipCategory", "Membership Category", "text"],
      ["frequency", "Preferred Frequency", "text"],
      ["voluntarySavings", "Voluntary Savings", "text"],
      ["proposedAmount", "Proposed Monthly Amount", "number"],
      ["startDate", "Expected Start Date", "date"],
      ["referralSource", "How They Heard About Us", "text"],
    ],
  },
  {
    title: "Next of Kin",
    fields: [
      ["kinName", "Full Name", "text"],
      ["kinPhone", "Phone", "text"],
      ["kinAltPhone", "Alternative Phone", "text"],
      ["kinEmail", "Email", "email"],
      ["kinRelationship", "Relationship", "text"],
      ["kinAddress", "Address", "textarea"],
    ],
  },
  {
    title: "Beneficiary / Nominee",
    fields: [
      ["beneficiaryName", "Full Name", "text"],
      ["beneficiaryPhone", "Phone", "text"],
      ["beneficiaryRelationship", "Relationship", "text"],
      ["beneficiaryAddress", "Address", "textarea"],
    ],
  },
  {
    title: "Declaration & Existing Documents",
    fields: [
      ["declarationName", "Applicant's Name", "text"],
      ["declarationDate", "Declaration Date", "date"],
      ["declarationPhone", "Declaration Phone", "text"],
      ["passportPhoto", "Passport Photo", "file"],
      ["signature", "Signature", "file"],
    ],
  },
];

function AddExistingMemberModal({ open, onClose, onCreate }) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [credentials, setCredentials] = useState(null);

  useEffect(() => {
    if (open) {
      setForm(INITIAL_FORM);
      setSaving(false);
      setError("");
      setCredentials(null);
    }
  }, [open]);

  if (!open) return null;

  const update = (field) => (e) => {
    const value = e.target.files?.[0] ?? e.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSaving(true);

    try {
      const result = await onCreate(form);
      setCredentials(result);
    } catch (err) {
      setError(err.message || "Failed to create member account.");
    } finally {
      setSaving(false);
    }
  };

  const handleDone = () => {
    setCredentials(null);
    onClose();
  };

  const loginDetails = credentials
    ? `Exclusive Cooperative\nName: ${credentials.user.fullName}\nEmail: ${credentials.user.email}\nTemporary Password: ${credentials.temporaryPassword}`
    : "";

  return (
    <div className="modal-overlay" onClick={handleDone}>
      <div
        className="modal-panel add-member-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Member Management</p>
            <h2>{credentials ? "Member Account Created" : "Add Existing Member"}</h2>
            <span className="add-member-subtitle">
              {credentials
                ? "Give the temporary login details to the member."
                : "Create the account and import the member's existing membership information."}
            </span>
          </div>
          <button className="modal-close" onClick={handleDone} aria-label="Close">
            ✕
          </button>
        </div>

        {credentials ? (
          <div className="modal-body add-member-success-body">
            <div className="existing-member-success">
              <div className="existing-member-success-icon">✓</div>
              <h3>Account created successfully</h3>
              <p>
                The member has been added as an approved cooperative member and
                their membership record has been linked to the new account.
              </p>
            </div>

            <div className="temporary-credentials-card">
              <div>
                <span>Member</span>
                <strong>{credentials.user.fullName}</strong>
              </div>
              <div>
                <span>Email</span>
                <strong>{credentials.user.email}</strong>
              </div>
              <div>
                <span>Temporary Password</span>
                <strong className="temporary-password">
                  {credentials.temporaryPassword}
                </strong>
              </div>
            </div>

            <div className="temporary-password-warning">
              <strong>Important</strong>
              <p>
                This temporary password is shown only now. The member must
                change it after their first login.
              </p>
            </div>

            <div className="modal-footer add-member-result-actions">
              <button
                className="admin-link-btn"
                type="button"
                onClick={() => navigator.clipboard?.writeText(loginDetails)}
              >
                Copy Login Details
              </button>
              <button className="approve-btn" type="button" onClick={handleDone}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <form className="modal-body add-member-form" onSubmit={handleSubmit}>
            <div className="add-member-notice">
              <strong>Existing member migration</strong>
              <span>
                The account will be created as an approved member. A secure
                temporary password will be generated automatically and will not
                be stored in plain text.
              </span>
            </div>

            {GROUPS.map((group) => (
              <section key={group.title} className="modal-section">
                <h3>{group.title}</h3>
                <div className="modal-grid">
                  {group.fields.map(([field, label, type, required]) => (
                    <div
                      className={`modal-field ${type === "textarea" ? "modal-field-full" : ""}`}
                      key={field}
                    >
                      <label className="modal-field-label" htmlFor={`existing-${field}`}>
                        {label}{required ? " *" : ""}
                      </label>

                      {type === "textarea" ? (
                        <textarea
                          id={`existing-${field}`}
                          rows={2}
                          value={form[field]}
                          onChange={update(field)}
                          required={required}
                        />
                      ) : type === "select-membership" ? (
                        <select
                          id={`existing-${field}`}
                          value={form[field]}
                          onChange={update(field)}
                        >
                          <option value="interest-bearing">Interest-Bearing</option>
                          <option value="interest-free">Interest-Free</option>
                        </select>
                      ) : type === "file" ? (
                        <>
                          <input
                            id={`existing-${field}`}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={update(field)}
                            required={required}
                          />
                          {form[field]?.name && (
                            <small className="modal-file-name">
                              Selected: {form[field].name}
                            </small>
                          )}
                        </>
                      ) : (
                        <input
                          id={`existing-${field}`}
                          type={type}
                          value={form[field]}
                          onChange={update(field)}
                          required={required}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ))}

            {error && <p className="form-error">{error}</p>}

            <div className="modal-footer add-member-footer">
              <button type="button" className="reject-btn" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="approve-btn" disabled={saving}>
                {saving ? "Creating Member..." : "Create Member Account"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default AddExistingMemberModal;
