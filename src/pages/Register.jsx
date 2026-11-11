import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "../styles/register.css";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import { getPasswordChecks, isStrongPassword } from "../utils/passwordPolicy";
import { useFlash } from "../context/ToastContext.jsx";

const MIN_AGE = 18;
const MAX_AGE = 110;

// "YYYY-MM-DD" from a date input -> age in whole years (null if not a real date).
function ageFromDateOfBirth(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return null;

  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null;
  }

  const today = new Date();
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) {
    age -= 1;
  }
  return age;
}

// Same date format the date input uses, N years before today.
function yearsAgo(years) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 0803..., 803..., 234803... and +234803... are all fine.
function isNigerianPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return (
    digits.length === 10 ||
    (digits.length === 11 && digits.startsWith("0")) ||
    (digits.length === 13 && digits.startsWith("234"))
  );
}

function Register() {
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    dateOfBirth: "",
    password: "",
    confirmPassword: "",
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [error, setError] = useState("");
  useFlash(error, "error");

  const passwordChecks = getPasswordChecks(form.password);
  const passwordScore = Object.values(passwordChecks).filter(Boolean).length;
  const passwordStrength = !form.password
    ? ""
    : passwordScore <= 1
      ? "Weak"
      : passwordScore === 2
        ? "Fair"
        : passwordScore === 3
          ? "Good"
          : "Strong";
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const update = (field) => (e) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const age = ageFromDateOfBirth(form.dateOfBirth);
  const isUnderage = age !== null && age < MIN_AGE;

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!isNigerianPhone(form.phone)) {
      setError("Enter a valid Nigerian phone number, for example 0803 123 4567.");
      return;
    }

    if (age === null || age > MAX_AGE) {
      setError("Enter your date of birth.");
      return;
    }

    if (isUnderage) {
      setError("You must be at least 18 years old to register.");
      return;
    }

    if (!isStrongPassword(form.password)) {
      setError(
        "Please choose a strong password that meets all the requirements.",
      );
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setError("");
    setLoading(true);

    try {
      await register(
        form.fullName,
        form.email,
        form.password,
        form.phone,
        form.dateOfBirth,
      );
      navigate("/membership");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <p className="eyebrow">Get Started</p>
        <h1>Create your account</h1>
        <p className="auth-sub">
          This creates your login access. To formally apply for cooperative
          membership, use the Membership Application form.
        </p>

        <form onSubmit={handleSubmit}>
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
            <label htmlFor="phone">Phone Number *</label>
            <input
              id="phone"
              type="tel"
              required
              autoComplete="tel"
              inputMode="tel"
              placeholder="0803 123 4567"
              value={form.phone}
              onChange={update("phone")}
            />
            <small className="field-hint">
              You can use this number to log in.
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="dateOfBirth">Date of Birth *</label>
            <input
              id="dateOfBirth"
              type="date"
              required
              autoComplete="bday"
              min={yearsAgo(MAX_AGE)}
              max={yearsAgo(MIN_AGE)}
              value={form.dateOfBirth}
              onChange={update("dateOfBirth")}
            />
            {age !== null && (
              <small className={`field-hint${isUnderage ? " field-hint-error" : ""}`}>
                {isUnderage
                  ? "You must be at least 18 years old to register."
                  : `Age: ${age} years`}
              </small>
            )}
            {age === null && (
              <small className="field-hint">
                You must be 18 or older to register.
              </small>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="password">Password *</label>

            <div
              className={`password-wrapper ${passwordStrength === "Strong" ? "password-strong" : ""}`}
            >
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                value={form.password}
                onChange={update("password")}
                autoComplete="new-password"
                aria-describedby="password-requirements"
              />

              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <FaEyeSlash /> : <FaEye />}
              </button>
            </div>

            {form.password && (
              <div className="password-strength" aria-live="polite">
                <div className="strength-header">
                  <span>Password strength</span>
                  <strong
                    className={`strength-${passwordStrength.toLowerCase()}`}
                  >
                    {passwordStrength}
                  </strong>
                </div>

                <div className="strength-bars" aria-hidden="true">
                  {[1, 2, 3, 4].map((bar) => (
                    <span
                      key={bar}
                      className={`strength-bar ${bar <= passwordScore ? `active strength-${passwordStrength.toLowerCase()}` : ""}`}
                    />
                  ))}
                </div>

                <ul
                  id="password-requirements"
                  className="password-requirements"
                >
                  <li className={passwordChecks.length ? "met" : ""}>
                    At least 8 characters
                  </li>
                  <li className={passwordChecks.upperLower ? "met" : ""}>
                    Uppercase and lowercase letters
                  </li>
                  <li className={passwordChecks.number ? "met" : ""}>
                    At least one number
                  </li>
                  <li className={passwordChecks.special ? "met" : ""}>
                    At least one special character
                  </li>
                </ul>
              </div>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">Confirm Password *</label>

            <div className="password-wrapper">
              <input
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                required
                value={form.confirmPassword}
                onChange={update("confirmPassword")}
                autoComplete="new-password"
              />

              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowConfirmPassword((prev) => !prev)}
                aria-label={
                  showConfirmPassword
                    ? "Hide confirmation password"
                    : "Show confirmation password"
                }
              >
                {showConfirmPassword ? <FaEyeSlash /> : <FaEye />}
              </button>
            </div>
          </div>


          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </form>

        <p className="auth-switch">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  );
}

export default Register;
