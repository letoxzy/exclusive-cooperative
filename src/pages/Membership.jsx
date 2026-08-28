import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import request from "../utils/api";
import "../styles/membership.css";

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

const initialState = {
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
  passportPhoto: null,

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
  signature: null,
  declarationPhone: "",
  agreed: false,
};

const sections = [
  { id: 1, label: "Personal Information" },
  { id: 2, label: "Membership & Savings" },
  { id: 3, label: "Next of Kin" },
  { id: 4, label: "Beneficiary" },
  { id: 5, label: "Declaration" },
];

function Membership() {
  const { user } = useAuth();
  const [form, setForm] = useState({
    ...initialState,
    fullName: user?.fullName || "",
    email: user?.email || "",
    declarationName: user?.fullName || "",
  });
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [existingApp, setExistingApp] = useState(null);

  useEffect(() => {
    if (!user) return;
    request("/membership/me", { token: user.token })
      .then((data) => setExistingApp(data))
      .catch(() => setExistingApp(null))
      .finally(() => setChecking(false));
  }, [user]);

  const update = (field) => (e) => {
    const { type, value, checked, files } = e.target;
    setForm((prev) => ({
      ...prev,
      [field]:
        type === "checkbox" ? checked : type === "file" ? files[0] : value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.agreed) {
      setError("Please confirm the declaration before submitting.");
      return;
    }

    setError("");
    setLoading(true);

    const payload = new FormData();
    Object.entries(form).forEach(([key, val]) => {
      if (val !== null) payload.append(key, val);
    });

    try {
      await request("/membership", {
        method: "POST",
        token: user.token,
        body: payload,
        isFormData: true,
      });
      setSubmitted(true);
    } catch (err) {
      setError(
        err.message || "Something went wrong submitting your application.",
      );
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return <div className="membership-page" />;
  }

  if (existingApp) {
    return (
      <div className="membership-page">
        <div className="membership-success">
          <span className="success-mark">
            {existingApp.status === "approved"
              ? "✓"
              : existingApp.status === "rejected"
                ? "✕"
                : "…"}
          </span>
          <h2>
            {existingApp.status === "approved"
              ? "Application approved"
              : existingApp.status === "rejected"
                ? "Application not approved"
                : "Application under review"}
          </h2>
          <p>
            {existingApp.status === "approved"
              ? "Welcome to the cooperative! Head to your dashboard to start saving."
              : existingApp.status === "rejected"
                ? "Your application wasn't approved this time. Contact the cooperative for details."
                : "Your membership application has already been submitted and is pending admin review. No need to submit again."}
          </p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="membership-page">
        <div className="membership-success">
          <span className="success-mark">✓</span>
          <h2>Application received</h2>
          <p>
            Thank you, {form.fullName.split(" ")[0] || "there"}. Your membership
            application has been recorded. Our team will reach out to you on{" "}
            {form.phone || "the number you provided"} once it's reviewed.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="membership-page">
      <header className="membership-hero">
        <p className="hero-eyebrow">Exclusive (Oshodi/Isolo) Cooperative</p>
        <h1>Membership Application</h1>
        <p className="hero-sub">
          Complete all sections accurately. Applicants within the first 200
          intake are exempt from the application fee.
        </p>
      </header>

      <nav className="section-tracker" aria-hidden="true">
        {sections.map((s) => (
          <div key={s.id} className="tracker-item">
            <span className="tracker-index">{s.id}</span>
            <span className="tracker-label">{s.label}</span>
          </div>
        ))}
      </nav>

      <form className="membership-form" onSubmit={handleSubmit}>
        {/* 1. PERSONAL INFORMATION */}
        <section className="form-card" id="personal-info">
          <h2>
            <span className="section-number">1</span> Personal Information
          </h2>

          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="fullName">Full Name *</label>
              <input
                id="fullName"
                required
                value={form.fullName}
                onChange={update("fullName")}
              />
            </div>

            <div className="form-group">
              <label>Gender *</label>
              <div className="pill-group">
                {["Male", "Female"].map((g) => (
                  <label key={g} className="pill">
                    <input
                      type="radio"
                      name="gender"
                      value={g}
                      checked={form.gender === g}
                      onChange={update("gender")}
                      required
                    />
                    {g}
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="phone">Phone Number *</label>
              <input
                id="phone"
                type="tel"
                required
                value={form.phone}
                onChange={update("phone")}
              />
            </div>

            <div className="form-group">
              <label htmlFor="email">Email Address *</label>
              <input
                id="email"
                type="email"
                required
                value={form.email}
                onChange={update("email")}
              />
            </div>

            <div className="form-group">
              <label htmlFor="employmentStatus">
                Employed / Self-Employed / Business Owner *
              </label>
              <select
                id="employmentStatus"
                required
                value={form.employmentStatus}
                onChange={update("employmentStatus")}
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
              <div className="form-group">
                <label htmlFor="employmentOther">Please specify</label>
                <input
                  id="employmentOther"
                  value={form.employmentOther}
                  onChange={update("employmentOther")}
                />
              </div>
            )}

            <div className="form-group">
              <label htmlFor="lga">LGA (Local Government Area) *</label>
              <input
                id="lga"
                required
                value={form.lga}
                onChange={update("lga")}
              />
            </div>

            <div className="form-group">
              <label htmlFor="dob">Date of Birth *</label>
              <input
                id="dob"
                type="date"
                required
                value={form.dob}
                onChange={update("dob")}
              />
            </div>

            <div className="form-group">
              <label>Marital Status *</label>
              <div className="pill-group">
                {["Single", "Married", "Other"].map((m) => (
                  <label key={m} className="pill">
                    <input
                      type="radio"
                      name="maritalStatus"
                      value={m}
                      checked={form.maritalStatus === m}
                      onChange={update("maritalStatus")}
                      required
                    />
                    {m}
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="whatsapp">WhatsApp No *</label>
              <input
                id="whatsapp"
                type="tel"
                required
                value={form.whatsapp}
                onChange={update("whatsapp")}
              />
            </div>

            <div className="form-group">
              <label htmlFor="occupation">Occupation *</label>
              <input
                id="occupation"
                required
                value={form.occupation}
                onChange={update("occupation")}
              />
            </div>

            <div className="form-group">
              <label htmlFor="stateOfOrigin">State of Origin *</label>
              <select
                id="stateOfOrigin"
                required
                value={form.stateOfOrigin}
                onChange={update("stateOfOrigin")}
              >
                <option value="" disabled>
                  Select state
                </option>
                {NIGERIAN_STATES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className="form-group span-2">
              <label htmlFor="address">Residential Address *</label>
              <textarea
                id="address"
                rows={2}
                required
                value={form.address}
                onChange={update("address")}
              />
            </div>

            <div className="form-group span-2">
              <label htmlFor="passportPhoto">Passport Photograph *</label>
              <input
                id="passportPhoto"
                type="file"
                accept="image/*"
                required
                onChange={update("passportPhoto")}
              />
              {form.passportPhoto && (
                <span className="file-name">{form.passportPhoto.name}</span>
              )}
            </div>
          </div>
        </section>

        {/* 2. MEMBERSHIP & SAVINGS */}
        <section className="form-card" id="membership-savings">
          <h2>
            <span className="section-number">2</span> Membership & Savings
            Information
          </h2>

          <div className="form-grid">
            <div className="form-group span-2">
              <label>
                Membership Type *
                <span className="hint">
                  {" "}
                  Interest-Bearing members pay interest on loans and earn
                  dividends on their savings. Interest-Free members pay no
                  loan interest and earn no dividends.
                </span>
              </label>
              <div className="pill-group">
                {[
                  { value: "interest-bearing", label: "Interest-Bearing Member" },
                  { value: "interest-free", label: "Interest-Free Member" },
                ].map((t) => (
                  <label key={t.value} className="pill">
                    <input
                      type="radio"
                      name="membershipType"
                      value={t.value}
                      checked={form.membershipType === t.value}
                      onChange={update("membershipType")}
                      required
                    />
                    {t.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label>Preferred Frequency *</label>
              <div className="pill-group">
                {["Daily", "Weekly", "Monthly"].map((f) => (
                  <label key={f} className="pill">
                    <input
                      type="radio"
                      name="frequency"
                      value={f}
                      checked={form.frequency === f}
                      onChange={update("frequency")}
                      required
                    />
                    {f}
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group span-2">
              <label>
                Do you subscribe to other voluntary savings? *
                <span className="hint">
                  {" "}
                  Any extra amount you choose to save above the required minimum
                  monthly contribution of ₦10,000.
                </span>
              </label>
              <div className="pill-group">
                {["Yes", "No", "Maybe"].map((v) => (
                  <label key={v} className="pill">
                    <input
                      type="radio"
                      name="voluntarySavings"
                      value={v}
                      checked={form.voluntarySavings === v}
                      onChange={update("voluntarySavings")}
                      required
                    />
                    {v}
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="referralSource">
                How did you hear about the society? *
              </label>
              <select
                id="referralSource"
                required
                value={form.referralSource}
                onChange={update("referralSource")}
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

            <div className="form-group">
              <label>Minimum Monthly Savings</label>
              <input value="₦10,000.00" disabled />
            </div>

            <div className="form-group">
              <label htmlFor="proposedAmount">
                Proposed Monthly Amount *
                <span className="hint">
                  {" "}
                  The amount you plan to save every month.
                </span>
              </label>
              <input
                id="proposedAmount"
                type="number"
                min="10000"
                required
                value={form.proposedAmount}
                onChange={update("proposedAmount")}
              />
            </div>

            <div className="form-group">
              <label htmlFor="startDate">
                Expected Start Date *
                <span className="hint"> When you plan to start saving.</span>
              </label>
              <input
                id="startDate"
                type="date"
                required
                value={form.startDate}
                onChange={update("startDate")}
              />
            </div>

            <div className="form-group span-2">
              <label>Membership Category *</label>
              <div className="pill-group">
                {[
                  "Ordinary Member",
                  "Associate Member",
                  "Corporate/Institutional Member",
                ].map((c) => (
                  <label key={c} className="pill">
                    <input
                      type="radio"
                      name="membershipCategory"
                      value={c}
                      checked={form.membershipCategory === c}
                      onChange={update("membershipCategory")}
                      required
                    />
                    {c}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* 3. NEXT OF KIN */}
        <section className="form-card" id="next-of-kin">
          <h2>
            <span className="section-number">3</span> Next of Kin / Emergency
            Contact
          </h2>

          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="kinName">Full Name *</label>
              <input
                id="kinName"
                required
                value={form.kinName}
                onChange={update("kinName")}
              />
            </div>

            <div className="form-group">
              <label htmlFor="kinPhone">Phone Number *</label>
              <input
                id="kinPhone"
                type="tel"
                required
                value={form.kinPhone}
                onChange={update("kinPhone")}
              />
            </div>

            <div className="form-group span-2">
              <label htmlFor="kinAddress">Address *</label>
              <textarea
                id="kinAddress"
                rows={2}
                required
                value={form.kinAddress}
                onChange={update("kinAddress")}
              />
            </div>

            <div className="form-group">
              <label htmlFor="kinRelationship">Relationship *</label>
              <select
                id="kinRelationship"
                required
                value={form.kinRelationship}
                onChange={update("kinRelationship")}
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

            <div className="form-group">
              <label htmlFor="kinAltPhone">Alternative No. *</label>
              <input
                id="kinAltPhone"
                type="tel"
                required
                value={form.kinAltPhone}
                onChange={update("kinAltPhone")}
              />
            </div>

            <div className="form-group span-2">
              <label htmlFor="kinEmail">Email (Optional)</label>
              <input
                id="kinEmail"
                type="email"
                value={form.kinEmail}
                onChange={update("kinEmail")}
              />
            </div>
          </div>
        </section>

        {/* 4. BENEFICIARY */}
        <section className="form-card" id="beneficiary">
          <h2>
            <span className="section-number">4</span> Beneficiary / Nominee
          </h2>
          <p className="section-note">
            The person who will receive your eligible cooperative benefits,
            savings, or other entitlements if something happens to you,
            according to the cooperative's rules.
          </p>

          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="beneficiaryName">Full Name *</label>
              <input
                id="beneficiaryName"
                required
                value={form.beneficiaryName}
                onChange={update("beneficiaryName")}
              />
            </div>

            <div className="form-group">
              <label htmlFor="beneficiaryPhone">Phone Number *</label>
              <input
                id="beneficiaryPhone"
                type="tel"
                required
                value={form.beneficiaryPhone}
                onChange={update("beneficiaryPhone")}
              />
            </div>

            <div className="form-group span-2">
              <label htmlFor="beneficiaryAddress">Address *</label>
              <textarea
                id="beneficiaryAddress"
                rows={2}
                required
                value={form.beneficiaryAddress}
                onChange={update("beneficiaryAddress")}
              />
            </div>

            <div className="form-group span-2">
              <label htmlFor="beneficiaryRelationship">Relationship *</label>
              <select
                id="beneficiaryRelationship"
                required
                value={form.beneficiaryRelationship}
                onChange={update("beneficiaryRelationship")}
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

        {/* 5. DECLARATION */}
        <section className="form-card" id="declaration">
          <h2>
            <span className="section-number">5</span> Applicant's Declaration
          </h2>

          <p className="declaration-text">
            I hereby declare that the information provided in this application
            is true and correct to the best of my knowledge. I agree to abide by
            the registered rules, regulations, policies, and decisions of
            Exclusive (Oshodi/Isolo) Cooperative Multipurpose Society Limited. I
            understand the cooperative's savings/contribution requirements and
            that membership does not automatically guarantee a loan or any other
            financial benefit. I consent to the Society maintaining and using my
            information for legitimate membership and administrative purposes.
          </p>

          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="declarationName">Applicant's Name *</label>
              <input
                id="declarationName"
                required
                value={form.declarationName}
                onChange={update("declarationName")}
              />
            </div>

            <div className="form-group">
              <label htmlFor="declarationDate">Date *</label>
              <input
                id="declarationDate"
                type="date"
                required
                value={form.declarationDate}
                onChange={update("declarationDate")}
              />
            </div>

            <div className="form-group">
              <label htmlFor="signature">
                Signature *
                <span className="hint">
                  {" "}
                  Sign on paper, take a clear picture, and upload it.
                </span>
              </label>
              <input
                id="signature"
                type="file"
                accept="image/*"
                required
                onChange={update("signature")}
              />
              {form.signature && (
                <span className="file-name">{form.signature.name}</span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="declarationPhone">Phone *</label>
              <input
                id="declarationPhone"
                type="tel"
                required
                value={form.declarationPhone}
                onChange={update("declarationPhone")}
              />
            </div>
          </div>

          <label className="agree-checkbox">
            <input
              type="checkbox"
              checked={form.agreed}
              onChange={update("agreed")}
            />
            I confirm the declaration above is true and I agree to the
            cooperative's rules and policies.
          </label>
        </section>

        {error && <p className="form-error submit-error">{error}</p>}

        <div className="submit-row">
          <p className="fee-note">
            First 200 members are exempt from the application form fee.
          </p>
          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? "Submitting..." : "Submit Application"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default Membership;
