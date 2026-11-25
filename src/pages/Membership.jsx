import { useState, useEffect, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { useAuth } from "../context/AuthContext";
import request from "../utils/api";
import "../styles/membership.css";
import { useFlash } from "../context/ToastContext.jsx";

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

// What each step needs before the applicant can continue.
// (Same fields the form has always required; the optional ones are not listed.)
const STEP_REQUIREMENTS = {
  1: [
    ["fullName", "Full Name"],
    ["gender", "Gender"],
    ["phone", "Phone Number"],
    ["email", "Email Address"],
    ["employmentStatus", "Employment status"],
    ["lga", "LGA"],
    ["dob", "Date of Birth"],
    ["maritalStatus", "Marital Status"],
    ["whatsapp", "WhatsApp No"],
    ["occupation", "Occupation"],
    ["stateOfOrigin", "State of Origin"],
    ["address", "Residential Address"],
    ["passportPhoto", "Passport Photograph"],
  ],
  2: [
    ["membershipType", "Membership Type"],
    ["frequency", "Preferred Frequency"],
    ["voluntarySavings", "Voluntary savings"],
    ["referralSource", "How you heard about the society"],
    ["proposedAmount", "Proposed Monthly Amount"],
    ["startDate", "Expected Start Date"],
    ["membershipCategory", "Membership Category"],
  ],
  3: [
    ["kinName", "Full Name"],
    ["kinPhone", "Phone Number"],
    ["kinAddress", "Address"],
    ["kinRelationship", "Relationship"],
    ["kinAltPhone", "Alternative No."],
  ],
  4: [
    ["beneficiaryName", "Full Name"],
    ["beneficiaryPhone", "Phone Number"],
    ["beneficiaryAddress", "Address"],
    ["beneficiaryRelationship", "Relationship"],
  ],
  5: [
    ["declarationName", "Applicant's Name"],
    ["declarationDate", "Date"],
    ["signature", "Signature"],
    ["declarationPhone", "Phone"],
    ["agreed", "Declaration confirmation"],
  ],
};

const MIN_MONTHLY_AMOUNT = 10000;

const isEmpty = (value) =>
  value === null ||
  value === undefined ||
  value === false ||
  (typeof value === "string" && value.trim() === "");

/**
 * Checks one step. Returns { fieldName: "message" } for everything wrong,
 * or an empty object when the step is complete.
 */
function validateStep(stepId, form) {
  const problems = {};

  (STEP_REQUIREMENTS[stepId] || []).forEach(([key, label]) => {
    if (isEmpty(form[key])) problems[key] = `${label} is required`;
  });

  if (!problems.email && stepId === 1 && !/^\S+@\S+\.\S+$/.test(form.email.trim())) {
    problems.email = "Email Address must be a valid email";
  }

  if (!problems.proposedAmount && stepId === 2) {
    const amount = Number(form.proposedAmount);
    if (!Number.isFinite(amount) || amount < MIN_MONTHLY_AMOUNT) {
      problems.proposedAmount = `Proposed Monthly Amount must be at least ₦${MIN_MONTHLY_AMOUNT.toLocaleString("en-NG")}`;
    }
  }

  return problems;
}

const labelFor = (key) => {
  for (const list of Object.values(STEP_REQUIREMENTS)) {
    const found = list.find(([k]) => k === key);
    if (found) return found[1];
  }
  return key;
};

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
  useFlash(error, "error");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [existingApp, setExistingApp] = useState(null);

  // One step at a time.
  const [step, setStep] = useState(1);
  const [maxStep, setMaxStep] = useState(1); // furthest step reached (earlier ones can be revisited)
  const [problems, setProblems] = useState({}); // { field: message } for the step being shown
  const formRef = useRef(null);
  const topRef = useRef(null);
  const firstRender = useRef(true);
  const totalSteps = sections.length;
  const percent = Math.round(((step - 1) / totalSteps) * 100);

  // Bring the new step into view (matters most on phones).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [step]);

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
    setProblems((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  // Shows what is missing and takes the applicant to the first problem.
  const showProblems = (found) => {
    setProblems(found);
    const first = Object.keys(found)[0];
    requestAnimationFrame(() => {
      const el = formRef.current?.querySelector(`#${first}, [name="${first}"]`);
      el?.focus?.({ preventScroll: true });
      el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    });
  };

  const goBack = () => {
    setProblems({});
    setStep((current) => Math.max(1, current - 1));
  };

  const goNext = () => {
    const found = validateStep(step, form);
    if (Object.keys(found).length > 0) {
      showProblems(found);
      return;
    }
    setProblems({});
    const next = Math.min(totalSteps, step + 1);
    setMaxStep((current) => Math.max(current, next));
    setStep(next);
  };

  // Clicking a step in the tracker: going back is always allowed; going
  // forward only to a step already reached, and only if this one is complete.
  const goToStep = (target) => {
    if (target === step || target > maxStep) return;
    if (target < step) {
      setProblems({});
      setStep(target);
      return;
    }
    const found = validateStep(step, form);
    if (Object.keys(found).length > 0) {
      showProblems(found);
      return;
    }
    setProblems({});
    setStep(target);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Pressing Enter inside a field on steps 1 to 4 means "Next", not "Submit".
    if (step < totalSteps) {
      goNext();
      return;
    }

    // Final check of every step, in case something was changed after it was completed.
    for (const sectionInfo of sections) {
      const found = validateStep(sectionInfo.id, form);
      if (Object.keys(found).length > 0) {
        setStep(sectionInfo.id);
        showProblems(found);
        return;
      }
    }

    setProblems({});
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
    <>
      <Helmet>
        <title>
          Membership Application | Exclusive Cooperative Oshodi-Isolo
        </title>

        <meta
          name="description"
          content="Apply to become a member of Exclusive (Oshodi/Isolo) Cooperative Multipurpose Society Limited. Complete your membership application and start building disciplined savings."
        />

        <link
          rel="canonical"
          href="https://www.exclusivecooperative.com/membership"
        />
      </Helmet>

      <div className="membership-page">
        <header className="membership-hero">
          <p className="hero-eyebrow">Exclusive (Oshodi/Isolo) Cooperative</p>
          <h1>Membership Application</h1>
          <p className="hero-sub">
            Complete all sections accurately. Applicants within the first 200
            intake are exempt from the application fee.
          </p>
        </header>

        <div className="wizard-progress" ref={topRef}>
          <div className="wizard-meta">
            <span>
              Step {step} of {totalSteps}
            </span>
            <span>{percent}% complete</span>
          </div>

          <nav className="section-tracker" aria-label="Application progress">
            {sections.map((sectionInfo) => {
              const state =
                sectionInfo.id < step
                  ? "done"
                  : sectionInfo.id === step
                    ? "active"
                    : "todo";
              const clickable =
                sectionInfo.id !== step && sectionInfo.id <= maxStep;

              return (
                <div key={sectionInfo.id} className={`tracker-item ${state}`}>
                  <button
                    type="button"
                    className="tracker-btn"
                    disabled={!clickable}
                    aria-current={state === "active" ? "step" : undefined}
                    aria-label={`Step ${sectionInfo.id}: ${sectionInfo.label}${
                      state === "done" ? " (completed)" : ""
                    }`}
                    onClick={() => goToStep(sectionInfo.id)}
                  >
                    <span className="tracker-index">
                      {state === "done" ? "✓" : sectionInfo.id}
                    </span>
                  </button>
                  <span className="tracker-label">{sectionInfo.label}</span>
                </div>
              );
            })}
          </nav>

          <div className="wizard-bar" aria-hidden="true">
            <span style={{ width: `${percent}%` }} />
          </div>
        </div>

        {/* Highlights the fields that still need attention on this step. */}
        {Object.keys(problems).length > 0 && (
          <style>
            {Object.keys(problems)
              .map(
                (key) =>
                  `#${key}{border-color:#b42318 !important;box-shadow:0 0 0 3px rgba(180,35,24,.12) !important}` +
                  `.form-group:has([name="${key}"]) .pill-group{outline:1.5px solid #b42318;outline-offset:4px;border-radius:12px}` +
                  `.agree-checkbox:has([name="${key}"]){color:#b42318}`,
              )
              .join("")}
          </style>
        )}

        <form
          className="membership-form"
          onSubmit={handleSubmit}
          noValidate
          ref={formRef}
        >
          {Object.keys(problems).length > 0 && (
            <div className="step-alert" role="alert">
              <strong>Please complete the highlighted fields to continue.</strong>
              <ul>
                {Object.entries(problems).map(([key, message]) => (
                  <li key={key}>{message || labelFor(key)}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 1. PERSONAL INFORMATION */}
          {step === 1 && (
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
                  required={!form.passportPhoto}
                  onChange={update("passportPhoto")}
                />
                {form.passportPhoto && (
                  <span className="file-name">
                    Selected: {form.passportPhoto.name}
                  </span>
                )}
              </div>
            </div>
          </section>
          )}

          {/* 2. MEMBERSHIP & SAVINGS */}
          {step === 2 && (
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
                    {
                      value: "interest-bearing",
                      label: "Interest-Bearing Member",
                    },
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
                    Any extra amount you choose to save above the required
                    minimum monthly contribution of ₦10,000.
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
          )}

          {/* 3. NEXT OF KIN */}
          {step === 3 && (
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
          )}

          {/* 4. BENEFICIARY */}
          {step === 4 && (
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
          )}

          {/* 5. DECLARATION */}
          {step === 5 && (
          <section className="form-card" id="declaration">
            <h2>
              <span className="section-number">5</span> Applicant's Declaration
            </h2>

            <p className="declaration-text">
              I hereby declare that the information provided in this application
              is true and correct to the best of my knowledge. I agree to abide
              by the registered rules, regulations, policies, and decisions of
              Exclusive (Oshodi/Isolo) Cooperative Multipurpose Society Limited.
              I understand the cooperative's savings/contribution requirements
              and that membership does not automatically guarantee a loan or any
              other financial benefit. I consent to the Society maintaining and
              using my information for legitimate membership and administrative
              purposes.
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
                  required={!form.signature}
                  onChange={update("signature")}
                />
                {form.signature && (
                  <span className="file-name">
                    Selected: {form.signature.name}
                  </span>
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
                name="agreed"
                checked={form.agreed}
                onChange={update("agreed")}
              />
              I confirm the declaration above is true and I agree to the
              cooperative's rules and policies.
            </label>
          </section>
          )}

          <div className="wizard-nav">
            {step > 1 ? (
              <button type="button" className="back-btn" onClick={goBack}>
                ← Back
              </button>
            ) : (
              <span />
            )}

            {step < totalSteps ? (
              <button type="submit" className="submit-btn">
                Next →
              </button>
            ) : (
              <button type="submit" className="submit-btn" disabled={loading}>
                {loading ? "Submitting..." : "Submit Application"}
              </button>
            )}
          </div>

          <p className="fee-note wizard-fee">
            First 200 members are exempt from the application form fee.
          </p>
        </form>
      </div>
    </>
  );
}

export default Membership;
