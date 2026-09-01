import { useState } from "react";
import { Link } from "react-router-dom";
import request from "../utils/api";
import "../styles/login.css";
import "../styles/forgot-password.css";

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");
    setError("");
    setLoading(true);

    try {
      const data = await request("/auth/forgot-password", {
        method: "POST",
        body: { email },
      });
      setMessage(data.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <p className="eyebrow">Account Recovery</p>
        <h1>Forgot your password?</h1>
        <p className="auth-sub">
          Enter the email address connected to your account and we&apos;ll send
          you a secure password reset link.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="reset-email">Email Address *</label>
            <input
              id="reset-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {error && <p className="form-error">{error}</p>}
          {message && <p className="form-success">{message}</p>}

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Sending reset link..." : "Send Reset Link"}
          </button>
        </form>

        <p className="auth-switch">
          Remember your password? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  );
}

export default ForgotPassword;
