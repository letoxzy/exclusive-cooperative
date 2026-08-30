import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getPasswordChecks, isStrongPassword } from "../utils/passwordPolicy";
import "../styles/change-password.css";

function ChangePassword() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const checks = getPasswordChecks(form.newPassword);
  const score = Object.values(checks).filter(Boolean).length;

  const update = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (!isStrongPassword(form.newPassword)) {
      setError("New password must be at least 8 characters and include uppercase and lowercase letters, a number, and a special character.");
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
      if (!result.ok) throw new Error(data.message || "Failed to update password.");

      await refreshUser();
      setMessage("Password changed successfully. Redirecting to your dashboard...");
      setTimeout(() => navigate("/dashboard", { replace: true }), 700);
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
          <div className="form-group">
            <label htmlFor="temporary-password">Temporary Password *</label>
            <input id="temporary-password" type="password" required value={form.currentPassword} onChange={update("currentPassword")} autoComplete="current-password" />
          </div>

          <div className="form-group">
            <label htmlFor="new-member-password">New Password *</label>
            <input id="new-member-password" type="password" required value={form.newPassword} onChange={update("newPassword")} autoComplete="new-password" />
          </div>

          {form.newPassword && (
            <ul className="change-password-requirements">
              <li className={checks.length ? "met" : ""}>At least 8 characters</li>
              <li className={checks.upperLower ? "met" : ""}>Uppercase and lowercase letters</li>
              <li className={checks.number ? "met" : ""}>At least one number</li>
              <li className={checks.special ? "met" : ""}>At least one special character</li>
              <li className={score === 4 ? "met" : ""}>Strong password</li>
            </ul>
          )}

          <div className="form-group">
            <label htmlFor="confirm-member-password">Confirm New Password *</label>
            <input id="confirm-member-password" type="password" required value={form.confirmPassword} onChange={update("confirmPassword")} autoComplete="new-password" />
          </div>

          {error && <p className="form-error">{error}</p>}
          {message && <p className="form-note">{message}</p>}

          <button className="btn-primary" type="submit" disabled={saving}>
            {saving ? "Saving Password..." : "Set My Password"}
          </button>
        </form>
      </section>
    </main>
  );
}

export default ChangePassword;
