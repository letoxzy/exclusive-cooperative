import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import request from "../utils/api";
import { getPasswordChecks, isStrongPassword } from "../utils/passwordPolicy";
import "../styles/login.css";
import "../styles/reset-password.css";

function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const passwordChecks = useMemo(() => getPasswordChecks(password), [password]);
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!isStrongPassword(password)) {
      setError(
        "Please choose a strong password that meets all the requirements.",
      );
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (!token) {
      setError("This password reset link is invalid.");
      return;
    }

    setLoading(true);

    try {
      const data = await request(`/auth/reset-password/${token}`, {
        method: "POST",
        body: { password },
      });

      setSuccess(data.message);
      setPassword("");
      setConfirmPassword("");

      setTimeout(() => {
        navigate("/login", { replace: true });
      }, 1800);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card reset-password-card">
        <p className="eyebrow">Account Recovery</p>
        <h1>Create a new password</h1>
        <p className="auth-sub">
          Choose a strong password for your Exclusive Cooperative account.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="new-password">New Password *</label>
            <div
              className={`password-wrapper ${passwordStrength === "Strong" ? "password-strong" : ""}`}
            >
              <input
                id="new-password"
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                aria-describedby="reset-password-requirements"
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

            {password && (
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
                      className={`strength-bar ${
                        bar <= passwordScore
                          ? `active strength-${passwordStrength.toLowerCase()}`
                          : ""
                      }`}
                    />
                  ))}
                </div>

                <ul
                  id="reset-password-requirements"
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
            <label htmlFor="confirm-new-password">Confirm New Password *</label>
            <div className="password-wrapper">
              <input
                id="confirm-new-password"
                type={showConfirmPassword ? "text" : "password"}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
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

          {error && <p className="form-error">{error}</p>}
          {success && <p className="form-success">{success}</p>}

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Updating password..." : "Reset Password"}
          </button>
        </form>

        <p className="auth-switch">
          <Link to="/login">Back to Log In</Link>
        </p>
      </div>
    </div>
  );
}

export default ResetPassword;
