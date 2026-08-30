import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getPasswordChecks, isStrongPassword } from "../utils/passwordPolicy";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import "../styles/change-password.css";

function ChangePassword() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  /* =========================
     PASSWORD STRENGTH
  ========================= */

  const checks = getPasswordChecks(form.newPassword);

  const score = Object.values(checks).filter(Boolean).length;

  const passwordStrength =
    score === 0
      ? ""
      : score <= 1
        ? "Weak"
        : score === 2
          ? "Fair"
          : score === 3
            ? "Good"
            : "Strong";

  /* =========================
     UPDATE FORM
  ========================= */

  const update = (field) => (e) => {
    setForm((previous) => ({
      ...previous,
      [field]: e.target.value,
    }));
  };

  /* =========================
     SUBMIT
  ========================= */

  const submit = async (e) => {
    e.preventDefault();

    setError("");
    setMessage("");

    if (!isStrongPassword(form.newPassword)) {
      setError(
        "New password must be at least 8 characters and include uppercase and lowercase letters, a number, and a special character.",
      );
      return;
    }

    if (form.newPassword !== form.confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    try {
      setSaving(true);

      const result = await fetch(
        `${import.meta.env.VITE_API_URL || "http://localhost:5000/api"}/users/me/password`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${user.token}`,
          },
          body: JSON.stringify({
            currentPassword: form.currentPassword,
            newPassword: form.newPassword,
          }),
        },
      );

      const data = await result.json().catch(() => ({}));

      if (!result.ok) {
        throw new Error(data.message || "Failed to update password.");
      }

      await refreshUser();

      setMessage(
        "Password changed successfully. Redirecting to your dashboard...",
      );

      setTimeout(() => {
        navigate("/dashboard", {
          replace: true,
        });
      }, 700);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="change-password-page">
      <section className="change-password-card">
        <p className="eyebrow">SECURITY</p>

        <h1>Create your password</h1>

        <p className="change-password-help">
          Your cooperative account was created with a temporary password. Set a
          new private password before continuing.
        </p>

        <form onSubmit={submit}>
          {/* =========================
              TEMPORARY PASSWORD
          ========================= */}

          <div className="form-group">
            <label htmlFor="temporary-password">Temporary Password *</label>

            <div className="password-wrapper">
              <input
                id="temporary-password"
                type={showCurrentPassword ? "text" : "password"}
                required
                value={form.currentPassword}
                onChange={update("currentPassword")}
                autoComplete="current-password"
              />

              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowCurrentPassword((previous) => !previous)}
                aria-label={
                  showCurrentPassword
                    ? "Hide temporary password"
                    : "Show temporary password"
                }
              >
                {showCurrentPassword ? <FaEyeSlash /> : <FaEye />}
              </button>
            </div>
          </div>

          {/* =========================
              NEW PASSWORD
          ========================= */}

          <div className="form-group">
            <label htmlFor="new-member-password">New Password *</label>

            <div
              className={`password-wrapper ${
                passwordStrength === "Strong" ? "password-strong" : ""
              }`}
            >
              <input
                id="new-member-password"
                type={showNewPassword ? "text" : "password"}
                required
                value={form.newPassword}
                onChange={update("newPassword")}
                autoComplete="new-password"
                aria-describedby="password-requirements"
              />

              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowNewPassword((previous) => !previous)}
                aria-label={
                  showNewPassword ? "Hide new password" : "Show new password"
                }
              >
                {showNewPassword ? <FaEyeSlash /> : <FaEye />}
              </button>
            </div>

            {/* =========================
                PASSWORD STRENGTH
            ========================= */}

            {form.newPassword && (
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
                        bar <= score
                          ? `active strength-${passwordStrength.toLowerCase()}`
                          : ""
                      }`}
                    />
                  ))}
                </div>

                <ul
                  id="password-requirements"
                  className="password-requirements"
                >
                  <li className={checks.length ? "met" : ""}>
                    At least 8 characters
                  </li>

                  <li className={checks.upperLower ? "met" : ""}>
                    Uppercase and lowercase letters
                  </li>

                  <li className={checks.number ? "met" : ""}>
                    At least one number
                  </li>

                  <li className={checks.special ? "met" : ""}>
                    At least one special character
                  </li>
                </ul>
              </div>
            )}
          </div>

          {/* =========================
              CONFIRM PASSWORD
          ========================= */}

          <div className="form-group">
            <label htmlFor="confirm-member-password">
              Confirm New Password *
            </label>

            <div className="password-wrapper">
              <input
                id="confirm-member-password"
                type={showConfirmPassword ? "text" : "password"}
                required
                value={form.confirmPassword}
                onChange={update("confirmPassword")}
                autoComplete="new-password"
              />

              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowConfirmPassword((previous) => !previous)}
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

          {/* =========================
              MESSAGES
          ========================= */}

          {error && <p className="form-error">{error}</p>}

          {message && <p className="form-note">{message}</p>}

          {/* =========================
              SUBMIT
          ========================= */}

          <button className="btn-primary" type="submit" disabled={saving}>
            {saving ? "Saving Password..." : "Set My Password"}
          </button>
        </form>
      </section>
    </main>
  );
}

export default ChangePassword;
