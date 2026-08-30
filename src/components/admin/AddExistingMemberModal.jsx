import { useEffect, useState } from "react";

const NIGERIAN_STATES = [
  "Abia",
  "Adamawa",
  "Akwa Ibom",
  "Anambra",
  "Bauchi",
  "Bayelsa",
  "Benue",
  "Borno",
  "Cross River",
  "Delta",
  "Ebonyi",
  "Edo",
  "Ekiti",
  "Enugu",
  "FCT - Abuja",
  "Gombe",
  "Imo",
  "Jigawa",
  "Kaduna",
  "Kano",
  "Katsina",
  "Kebbi",
  "Kogi",
  "Kwara",
  "Lagos",
  "Nasarawa",
  "Niger",
  "Ogun",
  "Ondo",
  "Osun",
  "Oyo",
  "Plateau",
  "Rivers",
  "Sokoto",
  "Taraba",
  "Yobe",
  "Zamfara",
];

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
    const { type, value, files } = e.target;

    setForm((previous) => ({
      ...previous,
      [field]: type === "file" ? files?.[0] || null : value,
    }));
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
    ? `Exclusive Cooperative
Name: ${credentials.user.fullName}
Email: ${credentials.user.email}
Temporary Password: ${credentials.temporaryPassword}`
    : "";

  return (
    <div className="modal-overlay" onClick={handleDone}>
      <div
        className="modal-panel add-member-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* =========================
            HEADER
        ========================= */}

        <div className="modal-header">
          <div>
            <p className="eyebrow">Member Management</p>

            <h2>
              {credentials ? "Member Account Created" : "Add Existing Member"}
            </h2>

            <span className="add-member-subtitle">
              {credentials
                ? "Give the temporary login details to the member."
                : "Create the account and import the member's existing membership information."}
            </span>
          </div>

          <button
            type="button"
            className="modal-close"
            onClick={handleDone}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* =========================
            SUCCESS
        ========================= */}

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

              <button
                className="approve-btn"
                type="button"
                onClick={handleDone}
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form className="modal-body add-member-form" onSubmit={handleSubmit}>
            {/* =========================
                NOTICE
            ========================= */}

            <div className="add-member-notice">
              <strong>Existing member migration</strong>

              <span>
                The account will be created as an approved member. A secure
                temporary password will be generated automatically and will not
                be stored in plain text.
              </span>
            </div>

            {/* =========================
                1. PERSONAL INFORMATION
            ========================= */}

            <section className="modal-section">
              <h3>1. Personal Information</h3>

              <div className="modal-grid">
                <div className="modal-field">
                  <label
                    className="modal-field-label"
                    htmlFor="existing-fullName"
                  >
                    Full Name *
                  </label>

                  <input
                    id="existing-fullName"
                    type="text"
                    value={form.fullName}
                    onChange={update("fullName")}
                    required
                  />
                </div>

                <div className="modal-field">
                  <label className="modal-field-label">Gender *</label>

                  <div className="pill-group">
                    {["Male", "Female"].map((gender) => (
                      <label key={gender} className="pill">
                        <input
                          type="radio"
                          name="existing-gender"
                          value={gender}
                          checked={form.gender === gender}
                          onChange={update("gender")}
                          required
                        />

                        {gender}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="modal-field">
                  <label className="modal-field-label" htmlFor="existing-phone">
                    Phone Number *
                  </label>

                  <input
                    id="existing-phone"
                    type="tel"
                    value={form.phone}
                    onChange={update("phone")}
                    required
                  />
                </div>

                <div className="modal-field">
                  <label className="modal-field-label" htmlFor="existing-email">
                    Email Address *
                  </label>

                  <input
                    id="existing-email"
                    type="email"
                    value={form.email}
                    onChange={update("email")}
                    required
                  />
                </div>

                <div className="modal-field">
                  <label
                    className="modal-field-label"
                    htmlFor="existing-employmentStatus"
                  >
                    Employed / Self-Employed / Business Owner *
                  </label>

                  <select
                    id="existing-employmentStatus"
                    value={form.employmentStatus}
                    onChange={update("employmentStatus")}
                    required
                  >
                    <option value="" disabled>
                      Select one
                    </option>

                    <option>Employed</option>

                    <option>Self-Employed / Business Owner</option>

                    <option>Other</option>
                  </select>
                </div>

                {form.employmentStatus === "Other" && (
                  <div className="modal-field">
                    <label
                      className="modal-field-label"
                      htmlFor="existing-employmentOther"
                    >
                      Please specify *
                    </label>

                    <input
                      id="existing-employmentOther"
                      type="text"
                      value={form.employmentOther}
                      onChange={update("employmentOther")}
                      required
                    />
                  </div>
                )}

                <div className="modal-field">
                  <label className="modal-field-label" htmlFor="existing-lga">
                    LGA *
                  </label>

                  <input
                    id="existing-lga"
                    type="text"
                    value={form.lga}
                    onChange={update("lga")}
                    required
                  />
                </div>

                <div className="modal-field">
                  <label className="modal-field-label" htmlFor="existing-dob">
                    Date of Birth *
                  </label>

                  <input
                    id="existing-dob"
                    type="date"
                    value={form.dob}
                    onChange={update("dob")}
                    required
                  />
                </div>

                <div className="modal-field">
                  <label className="modal-field-label">Marital Status *</label>

                  <div className="pill-group">
                    {["Single", "Married", "Other"].map((status) => (
                      <label key={status} className="pill">
                        <input
                          type="radio"
                          name="existing-maritalStatus"
                          value={status}
                          checked={form.maritalStatus === status}
                          onChange={update("maritalStatus")}
                          required
                        />

                        {status}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="modal-field">
                  <label
                    className="modal-field-label"
                    htmlFor="existing-whatsapp"
                  >
                    WhatsApp No *
                  </label>

                  <input
                    id="existing-whatsapp"
                    type="tel"
                    value={form.whatsapp}
                    onChange={update("whatsapp")}
                    required
                  />
                </div>

                <div className="modal-field">
                  <label
                    className="modal-field-label"
                    htmlFor="existing-occupation"
                  >
                    Occupation *
                  </label>

                  <input
                    id="existing-occupation"
                    type="text"
                    value={form.occupation}
                    onChange={update("occupation")}
                    required
                  />
                </div>

                <div className="modal-field">
                  <label
                    className="modal-field-label"
                    htmlFor="existing-stateOfOrigin"
                  >
                    State of Origin *
                  </label>

                  <select
                    id="existing-stateOfOrigin"
                    value={form.stateOfOrigin}
                    onChange={update("stateOfOrigin")}
                    required
                  >
                    <option value="" disabled>
                      Select state
                    </option>

                    {NIGERIAN_STATES.map((state) => (
                      <option key={state} value={state}>
                        {state}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="modal-field modal-field-full">
                  <label
                    className="modal-field-label"
                    htmlFor="existing-address"
                  >
                    Residential Address *
                  </label>

                  <textarea
                    id="existing-address"
                    rows={2}
                    value={form.address}
                    onChange={update("address")}
                    required
                  />
                </div>

                <div className="modal-field modal-field-full">
                  <label
                    className="modal-field-label"
                    htmlFor="existing-passportPhoto"
                  >
                    Passport Photograph *
                  </label>

                  <input
                    id="existing-passportPhoto"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={update("passportPhoto")}
                    required
                  />

                  {form.passportPhoto?.name && (
                    <small className="modal-file-name">
                      Selected: {form.passportPhoto.name}
                    </small>
                  )}
                </div>
              </div>
            </section>

            {/* =========================
                2. MEMBERSHIP & SAVINGS
            ========================= */}

            <section className="modal-section">
              <h3>2. Membership & Savings Information</h3>

              <div className="modal-grid">
                <div className="modal-field modal-field-full">
                  <label className="modal-field-label">Membership Type *</label>

                  <div className="pill-group">
                    {[
                      {
                        value: "interest-bearing",
                        label: "Interest-Bearing Member",
                      },
                      {
                        value: "interest-free",
                        label: "Interest-Free Member",
                      },
                    ].map((type) => (
                      <label key={type.value} className="pill">
                        <input
                          type="radio"
                          name="existing-membershipType"
                          value={type.value}
                          checked={form.membershipType === type.value}
                          onChange={update("membershipType")}
                          required
                        />

                        {type.label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="modal-field">
                  <label className="modal-field-label">
                    Preferred Frequency *
                  </label>

                  <div className="pill-group">
                    {["Daily", "Weekly", "Monthly"].map((frequency) => (
                      <label key={frequency} className="pill">
                        <input
                          type="radio"
                          name="existing-frequency"
                          value={frequency}
                          checked={form.frequency === frequency}
                          onChange={update("frequency")}
                          required
                        />

                        {frequency}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="modal-field modal-field-full">
                  <label className="modal-field-label">
                    Do you subscribe to other voluntary savings? *
                  </label>

                  <div className="pill-group">
                    {["Yes", "No", "Maybe"].map((value) => (
                      <label key={value} className="pill">
                        <input
                          type="radio"
                          name="existing-voluntarySavings"
                          value={value}
                          checked={form.voluntarySavings === value}
                          onChange={update("voluntarySavings")}
                          required
                        />

                        {value}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="modal-field">
                  <label
                    className="modal-field-label"
                    htmlFor="existing-referralSource"
                  >
                    How did you hear about the society? *
                  </label>

                  <select
                    id="existing-referralSource"
                    value={form.referralSource}
                    onChange={update("referralSource")}
                    required
                  >
                    <option value="" disabled>
                      Select one
                    </option>

                    <option>Family/Relative</option>

                    <option>Friend/Colleague</option>

                    <option>Cooperative Member</option>

                    <option>Instagram</option>

                    <option>TikTok</option>

                    <option>Facebook</option>

                    <option>Other</option>
                  </select>
                </div>

                <div className="modal-field">
                  <label className="modal-field-label">
                    Minimum Monthly Savings
                  </label>

                  <input value="₦10,000.00" disabled readOnly />
                </div>

                <div className="modal-field">
                  <label
                    className="modal-field-label"
                    htmlFor="existing-proposedAmount"
                  >
                    Proposed Monthly Amount *
                  </label>

                  <input
                    id="existing-proposedAmount"
                    type="number"
                    min="10000"
                    value={form.proposedAmount}
                    onChange={update("proposedAmount")}
                    required
                  />
                </div>

                <div className="modal-field">
                  <label
                    className="modal-field-label"
                    htmlFor="existing-startDate"
                  >
                    Expected Start Date *
                  </label>

                  <input
                    id="existing-startDate"
                    type="date"
                    value={form.startDate}
                    onChange={update("startDate")}
                    required
                  />
                </div>

                <div className="modal-field modal-field-full">
                  <label className="modal-field-label">
                    Membership Category *
                  </label>

                  <div className="pill-group">
                    {[
                      "Ordinary Member",
                      "Associate Member",
                      "Corporate/Institutional Member",
                    ].map((category) => (
                      <label key={category} className="pill">
                        <input
                          type="radio"
                          name="existing-membershipCategory"
                          value={category}
                          checked={form.membershipCategory === category}
                          onChange={update("membershipCategory")}
                          required
                        />

                        {category}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* =========================
                3. NEXT OF KIN
            ========================= */}

            <section className="modal-section">
              <h3>3. Next of Kin / Emergency Contact</h3>

              <div className="modal-grid">
                <div className="modal-field">
                  <label
                    className="modal-field-label"
                    htmlFor="existing-kinName"
                  >
                    Full Name *
                  </label>

                  <input
                    id="existing-kinName"
                    type="text"
                    value={form.kinName}
                    onChange={update("kinName")}
                    required
                  />
                </div>

                <div className="modal-field">
                  <label
                    className="modal-field-label"
                    htmlFor="existing-kinPhone"
                  >
                    Phone Number *
                  </label>

                  <input
                    id="existing-kinPhone"
                    type="tel"
                    value={form.kinPhone}
                    onChange={update("kinPhone")}
                    required
                  />
                </div>

                <div className="modal-field modal-field-full">
                  <label
                    className="modal-field-label"
                    htmlFor="existing-kinAddress"
                  >
                    Address *
                  </label>

                  <textarea
                    id="existing-kinAddress"
                    rows={2}
                    value={form.kinAddress}
                    onChange={update("kinAddress")}
                    required
                  />
                </div>

                <div className="modal-field">
                  <label
                    className="modal-field-label"
                    htmlFor="existing-kinRelationship"
                  >
                    Relationship *
                  </label>

                  <select
                    id="existing-kinRelationship"
                    value={form.kinRelationship}
                    onChange={update("kinRelationship")}
                    required
                  >
                    <option value="" disabled>
                      Select one
                    </option>

                    <option>Father</option>
                    <option>Mother</option>
                    <option>Friend</option>
                    <option>Other</option>
                  </select>
                </div>

                <div className="modal-field">
                  <label
                    className="modal-field-label"
                    htmlFor="existing-kinAltPhone"
                  >
                    Alternative No. *
                  </label>

                  <input
                    id="existing-kinAltPhone"
                    type="tel"
                    value={form.kinAltPhone}
                    onChange={update("kinAltPhone")}
                    required
                  />
                </div>

                <div className="modal-field modal-field-full">
                  <label
                    className="modal-field-label"
                    htmlFor="existing-kinEmail"
                  >
                    Email (Optional)
                  </label>

                  <input
                    id="existing-kinEmail"
                    type="email"
                    value={form.kinEmail}
                    onChange={update("kinEmail")}
                  />
                </div>
              </div>
            </section>

            {/* =========================
                4. BENEFICIARY
            ========================= */}

            <section className="modal-section">
              <h3>4. Beneficiary / Nominee</h3>

              <div className="modal-grid">
                <div className="modal-field">
                  <label
                    className="modal-field-label"
                    htmlFor="existing-beneficiaryName"
                  >
                    Full Name *
                  </label>

                  <input
                    id="existing-beneficiaryName"
                    type="text"
                    value={form.beneficiaryName}
                    onChange={update("beneficiaryName")}
                    required
                  />
                </div>

                <div className="modal-field">
                  <label
                    className="modal-field-label"
                    htmlFor="existing-beneficiaryPhone"
                  >
                    Phone Number *
                  </label>

                  <input
                    id="existing-beneficiaryPhone"
                    type="tel"
                    value={form.beneficiaryPhone}
                    onChange={update("beneficiaryPhone")}
                    required
                  />
                </div>

                <div className="modal-field modal-field-full">
                  <label
                    className="modal-field-label"
                    htmlFor="existing-beneficiaryAddress"
                  >
                    Address *
                  </label>

                  <textarea
                    id="existing-beneficiaryAddress"
                    rows={2}
                    value={form.beneficiaryAddress}
                    onChange={update("beneficiaryAddress")}
                    required
                  />
                </div>

                <div className="modal-field modal-field-full">
                  <label
                    className="modal-field-label"
                    htmlFor="existing-beneficiaryRelationship"
                  >
                    Relationship *
                  </label>

                  <select
                    id="existing-beneficiaryRelationship"
                    value={form.beneficiaryRelationship}
                    onChange={update("beneficiaryRelationship")}
                    required
                  >
                    <option value="" disabled>
                      Select one
                    </option>

                    <option>Father</option>
                    <option>Mother</option>
                    <option>Sibling</option>
                    <option>Son</option>
                    <option>Daughter</option>
                    <option>Other Relative</option>
                  </select>
                </div>
              </div>
            </section>

            {/* =========================
                5. DECLARATION
            ========================= */}

            <section className="modal-section">
              <h3>5. Applicant's Declaration</h3>

              <p className="modal-declaration-text">
                I hereby declare that the information provided in this
                application is true and correct to the best of my knowledge. I
                agree to abide by the registered rules, regulations, policies,
                and decisions of Exclusive (Oshodi/Isolo) Cooperative
                Multipurpose Society Limited.
              </p>

              <div className="modal-grid">
                <div className="modal-field">
                  <label
                    className="modal-field-label"
                    htmlFor="existing-declarationName"
                  >
                    Applicant's Name *
                  </label>

                  <input
                    id="existing-declarationName"
                    type="text"
                    value={form.declarationName}
                    onChange={update("declarationName")}
                    required
                  />
                </div>

                <div className="modal-field">
                  <label
                    className="modal-field-label"
                    htmlFor="existing-declarationDate"
                  >
                    Date *
                  </label>

                  <input
                    id="existing-declarationDate"
                    type="date"
                    value={form.declarationDate}
                    onChange={update("declarationDate")}
                    required
                  />
                </div>

                <div className="modal-field">
                  <label
                    className="modal-field-label"
                    htmlFor="existing-declarationPhone"
                  >
                    Phone *
                  </label>

                  <input
                    id="existing-declarationPhone"
                    type="tel"
                    value={form.declarationPhone}
                    onChange={update("declarationPhone")}
                    required
                  />
                </div>

                <div className="modal-field">
                  <label
                    className="modal-field-label"
                    htmlFor="existing-signature"
                  >
                    Signature *
                  </label>

                  <input
                    id="existing-signature"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={update("signature")}
                    required
                  />

                  {form.signature?.name && (
                    <small className="modal-file-name">
                      Selected: {form.signature.name}
                    </small>
                  )}
                </div>
              </div>
            </section>

            {/* =========================
                ERROR
            ========================= */}

            {error && <p className="form-error">{error}</p>}

            {/* =========================
                FOOTER
            ========================= */}

            <div className="modal-footer add-member-footer">
              <button
                type="button"
                className="reject-btn"
                onClick={onClose}
                disabled={saving}
              >
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
