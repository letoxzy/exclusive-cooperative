import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useFlash } from "../context/ToastContext";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import "../styles/login.css";

function Login() {
  const [form, setForm] = useState({ identifier: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  useFlash(error, "error");
  const [loading, setLoading] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(null);
  const [lockRemaining, setLockRemaining] = useState(0);
  const { login } = useAuth();
  const navigate = useNavigate();

  const update = (field) => (e) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  useEffect(() => {
    if (!lockedUntil) {
      setLockRemaining(0);
      return;
    }

    const update = () => {
      const remaining = Math.max(
        0,
        new Date(lockedUntil).getTime() - Date.now(),
      );
      setLockRemaining(remaining);
      if (remaining === 0) {
        setLockedUntil(null);
        setError("Your security lock has expired. You can try again now.");
      }
    };

    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [lockedUntil]);

  const formatLockRemaining = (milliseconds) => {
    const totalSeconds = Math.ceil(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (lockRemaining > 0) return;
    setError("");
    setLoading(true);

    try {
      const data = await login(form.identifier, form.password);

      // Password accepted -> a code was emailed; continue on the code page.
      if (data.otpRequired) {
        navigate("/verify-login", { state: data });
        return;
      }

      if (data.mustChangePassword) {
        navigate("/change-password", { replace: true });
        return;
      }

      navigate(data.role === "admin" ? "/admin" : "/dashboard");
    } catch (err) {
      if (err?.code === "LOGIN_LOCKED" && err?.lockedUntil) {
        setLockedUntil(err.lockedUntil);
        setError("Your account has been temporarily locked for security.");
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <p className="eyebrow">Welcome Back</p>
        <h1>Log in to your account</h1>
        <p className="auth-sub">
          Access your savings history, loan status, and membership details.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="identifier">Email, phone number or name *</label>
            <input
              id="identifier"
              type="text"
              required
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Email, phone number or full name"
              value={form.identifier}
              onChange={update("identifier")}
            />
            <small className="field-hint">
              Signing in with your name only works if no other member has the
              same name. If it does not work, use your email or phone number.
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="password">Password *</label>

            <div className="password-wrapper">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                value={form.password}
                onChange={update("password")}
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
          </div>

          <div className="forgot-password-link">
            <Link to="/forgot-password">Forgot password?</Link>
          </div>

          {lockRemaining > 0 && (
            <p className="form-error">
              Your account has been temporarily locked for security. Try again
              in {formatLockRemaining(lockRemaining)}.
            </p>
          )}

          <button
            type="submit"
            className="btn-primary"
            disabled={loading || lockRemaining > 0}
          >
            {lockRemaining > 0
              ? `Try again in ${formatLockRemaining(lockRemaining)}`
              : loading
                ? "Logging in..."
                : "Log In"}
          </button>
        </form>

        <p className="auth-switch">
          Don't have an account? <Link to="/register">Register</Link>
        </p>
      </div>
    </div>
  );
}

export default Login;
