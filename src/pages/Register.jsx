import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "../styles/register.css";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import { getPasswordChecks, isStrongPassword } from "../utils/passwordPolicy";

function Register() {
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [error, setError] = useState("");

  const passwordChecks = getPasswordChecks(form.password);
  const passwordScore = Object.values(passwordChecks).filter(Boolean).length;
  const passwordStrength =
    passwordScore === 0
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

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!isStrongPassword(form.password)) {
      setError("Please choose a strong password that meets all the requirements.");
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setError("");
    setLoading(true);

    try {
      await register(form.fullName, form.email, form.password);
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
            <label htmlFor="password">Password *</label>

            <div className={`password-wrapper ${passwordStrength === "Strong" ? "password-strong" : ""}`}>
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
                  <strong className={`strength-${passwordStrength.toLowerCase()}`}>
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

                <ul id="password-requirements" className="password-requirements">
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
                  showConfirmPassword ? "Hide confirmation password" : "Show confirmation password"
                }
              >
                {showConfirmPassword ? <FaEyeSlash /> : <FaEye />}
              </button>
            </div>
          </div>

          {error && <p className="form-error">{error}</p>}

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
