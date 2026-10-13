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
  const [kind, setKind] = useState("savings");

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

        if (data.kind === "loan_repayment") {
          setKind("loan");
          const extra = Number(data.overpaidAmount || 0);
          const left =
            data.outstandingBalance !== null && data.outstandingBalance !== undefined
              ? Number(data.outstandingBalance)
              : null;
          let text =
            data.status === "already_processed"
              ? `This repayment was already confirmed (₦${data.amount?.toLocaleString()}).`
              : `₦${data.amount?.toLocaleString()} has been applied to your loan.`;
          if (data.loanStatus === "completed") {
            text += " Your loan is now fully repaid. Thank you!";
          } else if (left !== null) {
            text += ` You now owe ₦${left.toLocaleString()}.`;
          }
          if (extra > 0) {
            text += ` ₦${extra.toLocaleString()} was more than you owed and will be refunded by the cooperative office.`;
          }
          setMessage(text);
          return;
        }

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
          {kind === "loan" ? "Back to my loan →" : "Back to Dashboard →"}
        </Link>
      </div>
    </div>
  );
}

export default PaymentCallback;
