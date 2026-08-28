import { useState, useEffect } from "react";

const FIELD_GROUPS = [
  {
    title: "Personal Information",
    fields: [
      ["fullName", "Full Name"],
      ["gender", "Gender"],
      ["phone", "Phone"],
      ["email", "Email"],
      ["whatsapp", "WhatsApp No."],
      ["dob", "Date of Birth", "date"],
      ["maritalStatus", "Marital Status"],
      ["employmentStatus", "Employment Status"],
      ["employmentOther", "Employment (Other)"],
      ["occupation", "Occupation"],
      ["lga", "LGA"],
      ["stateOfOrigin", "State of Origin"],
      ["address", "Residential Address", "textarea"],
    ],
  },
  {
    title: "Membership & Savings",
    fields: [
      ["frequency", "Preferred Frequency"],
      ["voluntarySavings", "Voluntary Savings"],
      ["referralSource", "How They Heard About Us"],
      ["proposedAmount", "Proposed Monthly Amount", "number"],
      ["startDate", "Expected Start Date", "date"],
      ["membershipCategory", "Membership Category"],
      ["membershipType", "Membership Type (interest-bearing/interest-free)"],
    ],
  },
  {
    title: "Next of Kin",
    fields: [
      ["kinName", "Full Name"],
      ["kinPhone", "Phone"],
      ["kinAltPhone", "Alternative No."],
      ["kinEmail", "Email"],
      ["kinRelationship", "Relationship"],
      ["kinAddress", "Address", "textarea"],
    ],
  },
  {
    title: "Beneficiary / Nominee",
    fields: [
      ["beneficiaryName", "Full Name"],
      ["beneficiaryPhone", "Phone"],
      ["beneficiaryRelationship", "Relationship"],
      ["beneficiaryAddress", "Address", "textarea"],
    ],
  },
  {
    title: "Declaration",
    fields: [
      ["declarationName", "Applicant's Name"],
      ["declarationDate", "Date", "date"],
      ["declarationPhone", "Phone"],
    ],
  },
];

function MembershipModal({
  application,
  startInEditMode,
  onClose,
  onSave,
  onStatusChange,
}) {
  const [editing, setEditing] = useState(!!startInEditMode);
  const [form, setForm] = useState(application);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setForm(application);
    setEditing(!!startInEditMode);
    setError("");
  }, [application, startInEditMode]);

  if (!application) return null;

  const update = (field) => (e) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await onSave(application._id, form);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">
              {editing ? "Editing Application" : "Membership Application"}
            </p>
            <h2>{application.fullName}</h2>
            <span className={`status-badge ${application.status}`}>
              {application.status}
            </span>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          {(application.passportPhotoUrl || application.signatureUrl) && (
            <div className="modal-photo-row">
              {application.passportPhotoUrl && (
                <a
                  href={application.passportPhotoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="modal-photo-block"
                >
                  <img src={application.passportPhotoUrl} alt="Passport" />
                  <span>Passport Photo</span>
                </a>
              )}
              {application.signatureUrl && (
                <a
                  href={application.signatureUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="modal-photo-block"
                >
                  <img src={application.signatureUrl} alt="Signature" />
                  <span>Signature</span>
                </a>
              )}
            </div>
          )}

          {FIELD_GROUPS.map((group) => (
            <section key={group.title} className="modal-section">
              <h3>{group.title}</h3>
              <div className="modal-grid">
                {group.fields.map(([key, label, type]) => (
                  <div key={key} className="modal-field">
                    <span className="modal-field-label">{label}</span>
                    {editing ? (
                      type === "textarea" ? (
                        <textarea
                          rows={2}
                          value={form[key] || ""}
                          onChange={update(key)}
                        />
                      ) : (
                        <input
                          type={type || "text"}
                          value={form[key] || ""}
                          onChange={update(key)}
                        />
                      )
                    ) : (
                      <span className="modal-field-value">
                        {application[key] || <em className="muted">—</em>}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}

          {error && <p className="form-error">{error}</p>}
        </div>

        <div className="modal-footer">
          {editing ? (
            <>
              <button
                className="reject-btn"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="approve-btn"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </>
          ) : (
            <>
              {application.status === "pending" && (
                <>
                  <button
                    className="reject-btn"
                    onClick={() => onStatusChange(application._id, "rejected")}
                  >
                    Reject
                  </button>
                  <button
                    className="approve-btn"
                    onClick={() => onStatusChange(application._id, "approved")}
                  >
                    Approve
                  </button>
                </>
              )}
              <button
                className="admin-link-btn"
                onClick={() => setEditing(true)}
              >
                Update Details
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default MembershipModal;
