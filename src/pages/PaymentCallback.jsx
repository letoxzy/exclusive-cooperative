import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import request from "../utils/api";
import "../styles/dashboard.css";

function PaymentCallback() {
  const [searchParams] = useSearchParams();
  const { user, refreshUser } = useAuth();
  const [status, setStatus] = useState("checking");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const reference =
      searchParams.get("reference") || searchParams.get("trxref");

    if (!reference || !user) {
      setStatus("error");
      setMessage("Missing payment reference.");
      return;
    }

    request(`/payments/paystack/verify/${reference}`, { token: user.token })
      .then(async (data) => {
        await refreshUser();
        setStatus("success");
        setMessage(
          data.status === "already_processed"
            ? `This payment was already confirmed (₦${data.amount?.toLocaleString()}).`
            : `₦${data.amount?.toLocaleString()} has been added to your savings.`,
        );
      })
      .catch((err) => {
        setStatus("error");
        setMessage(err.message);
      });
  }, [searchParams, user, refreshUser]);

  return (
    <div className="dashboard-page">
      <div className="payment-status-card">
        <span className={`payment-status-mark ${status}`}>
          {status === "success" ? "✓" : status === "error" ? "✕" : "…"}
        </span>
        <h2>
          {status === "checking" && "Confirming your payment..."}
          {status === "success" && "Payment confirmed"}
          {status === "error" && "Payment could not be confirmed"}
        </h2>
        <p>{message}</p>
        <Link to="/dashboard" className="banner-link">
          Back to Dashboard →
        </Link>
      </div>
    </div>
  );
}

export default PaymentCallback;
