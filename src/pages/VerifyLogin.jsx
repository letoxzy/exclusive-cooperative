import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "../styles/login.css";
import "../styles/verify-login.css";
import { useFlash } from "../context/ToastContext.jsx";

const LENGTH = 6;

// Errors after which the current code can no longer work: the member has to
// go back and log in again to get a new one.
const DEAD_CODES = new Set([
  "OTP_CHALLENGE_EXPIRED",
  "OTP_TOO_MANY_ATTEMPTS",
  "OTP_TOO_MANY_RESENDS",
  "OTP_EMAIL_FAILED",
  "ACCOUNT_BLOCKED",
  "ACCOUNT_SECURITY_LOCKED",
]);

function VerifyLogin() {
  const location = useLocation();
  const navigate = useNavigate();
  const { verifyLogin, resendLoginCode } = useAuth();
  const pending = location.state;

  const [challengeToken, setChallengeToken] = useState(
    pending?.challengeToken || "",
  );
  const [digits, setDigits] = useState(Array(LENGTH).fill(""));
  const [error, setError] = useState("");
  useFlash(error, "error");
  const [info, setInfo] = useState("");
  useFlash(info, "success");
  const [loading, setLoading] = useState(false);
  const [dead, setDead] = useState(false);
  const [resendIn, setResendIn] = useState(pending?.resendAfterSeconds || 60);
  const [resending, setResending] = useState(false);
  const inputs = useRef([]);

  // Count down until "Resend code" becomes available again.
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  useEffect(() => {
    inputs.current[0]?.focus();
  }, []);

  const code = digits.join("");

  const submit = async (value) => {
    if (loading || dead || value.length !== LENGTH) return;
    setError("");
    setInfo("");
    setLoading(true);

    try {
      const data = await verifyLogin(challengeToken, value);

      if (data.mustChangePassword) {
        navigate("/change-password", { replace: true });
        return;
      }
      navigate(data.role === "admin" ? "/admin" : "/dashboard", {
        replace: true,
      });
    } catch (err) {
      setError(err.message);
      if (DEAD_CODES.has(err.code)) {
        setDead(true);
      } else {
        setDigits(Array(LENGTH).fill(""));
        inputs.current[0]?.focus();
      }
    } finally {
      setLoading(false);
    }
  };

  // Sign in automatically as soon as the sixth digit is typed or pasted.
  useEffect(() => {
    if (code.length === LENGTH) submit(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const setDigitAt = (index, value) =>
    setDigits((prev) => prev.map((d, i) => (i === index ? value : d)));

  const handleChange = (index) => (e) => {
    const typed = e.target.value.replace(/\D/g, "");
    if (!typed) {
      setDigitAt(index, "");
      return;
    }
    // Typing (or autofill) of several digits fills the following boxes too.
    const next = [...digits];
    typed
      .slice(0, LENGTH - index)
      .split("")
      .forEach((d, i) => {
        next[index + i] = d;
      });
    setDigits(next);
    inputs.current[Math.min(index + typed.length, LENGTH - 1)]?.focus();
  };

  const handleKeyDown = (index) => (e) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      setDigitAt(index - 1, "");
      inputs.current[index - 1]?.focus();
    }
    if (e.key === "ArrowLeft" && index > 0) inputs.current[index - 1]?.focus();
    if (e.key === "ArrowRight" && index < LENGTH - 1)
      inputs.current[index + 1]?.focus();
  };

  const handlePaste = (e) => {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "");
    if (!pasted) return;
    e.preventDefault();
    const next = Array(LENGTH).fill("");
    pasted
      .slice(0, LENGTH)
      .split("")
      .forEach((d, i) => {
        next[i] = d;
      });
    setDigits(next);
    inputs.current[Math.min(pasted.length, LENGTH - 1)]?.focus();
  };

  const handleResend = async () => {
    if (resendIn > 0 || resending || dead) return;
    setError("");
    setInfo("");
    setResending(true);

    try {
      const data = await resendLoginCode(challengeToken);
      setChallengeToken(data.challengeToken);
      setResendIn(data.resendAfterSeconds || 60);
      setDigits(Array(LENGTH).fill(""));
      inputs.current[0]?.focus();
      setInfo("A new code has been sent to your email.");
    } catch (err) {
      setError(err.message);
      if (err.retryAfterSeconds) setResendIn(err.retryAfterSeconds);
      if (DEAD_CODES.has(err.code)) setDead(true);
    } finally {
      setResending(false);
    }
  };

  // Opened directly (or refreshed): there is no pending login to verify.
  if (!pending?.challengeToken) return <Navigate to="/login" replace />;

  const expiryMinutes = Math.round((pending.expiresInSeconds || 600) / 60);

  return (
    <div className="auth-page">
      <div className="auth-card">
        <p className="eyebrow">Verify it&apos;s you</p>
        <h1>Check your email</h1>
        <p className="auth-sub">
          Enter the {LENGTH}-digit verification code we sent to{" "}
          <strong>{pending.email}</strong>. It expires in {expiryMinutes}{" "}
          minutes.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(code);
          }}
        >
          <div className="otp-row" onPaste={handlePaste}>
            {digits.map((digit, index) => (
              <input
                key={index}
                ref={(el) => {
                  inputs.current[index] = el;
                }}
                className="otp-box"
                type="text"
                inputMode="numeric"
                autoComplete={index === 0 ? "one-time-code" : "off"}
                maxLength={LENGTH}
                value={digit}
                disabled={loading || dead}
                aria-label={`Digit ${index + 1}`}
                onChange={handleChange(index)}
                onKeyDown={handleKeyDown(index)}
                onFocus={(e) => e.target.select()}
              />
            ))}
          </div>


          <button
            type="submit"
            className="btn-primary"
            disabled={loading || dead || code.length !== LENGTH}
          >
            {loading ? "Verifying..." : "Sign in"}
          </button>
        </form>

        <div className="otp-footer">
          {dead ? (
            <Link to="/login" replace>
              Back to log in
            </Link>
          ) : (
            <>
              <button
                type="button"
                className="otp-resend"
                onClick={handleResend}
                disabled={resendIn > 0 || resending}
              >
                {resending
                  ? "Sending..."
                  : resendIn > 0
                    ? `Resend code in 0:${String(resendIn).padStart(2, "0")}`
                    : "Resend code"}
              </button>
              <Link to="/login" replace>
                Use a different account
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default VerifyLogin;
