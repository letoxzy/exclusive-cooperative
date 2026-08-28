import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import request from "../utils/api";
import "../styles/loan-application.css";

// Kept in sync with server/routes/loanRoutes.js — 3/6/12 month terms
// with interest scaling 5% -> 10%. Interest-free members are always
// charged 0%, regardless of term.
const INTEREST_RATE_BY_TERM = { 3: 5, 6: 7, 12: 10 };

function LoanApplication() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [membershipType, setMembershipType] = useState(null);

  const [form, setForm] = useState({
    loanType: "",
    amount: "",
    termMonths: "",
    purpose: "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    request("/loans/eligibility", { token: user.token })
      .then((data) => {
        if (!cancelled) setMembershipType(data.membershipType);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [user]);

  const selectedRate = form.termMonths
    ? membershipType === "interest-free"
      ? 0
      : INTEREST_RATE_BY_TERM[Number(form.termMonths)]
    : null;

  const estimatedTotal =
    selectedRate !== null && form.amount && Number(form.amount) > 0
      ? Number(form.amount) + (Number(form.amount) * selectedRate) / 100
      : null;

  const handleChange = (e) => {
    const { name, value } = e.target;

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    setError("");
    setSuccess("");

    if (!form.loanType) {
      setError("Please select a loan category.");
      return;
    }

    if (!form.amount || Number(form.amount) <= 0) {
      setError("Please enter a valid loan amount.");
      return;
    }

    if (!form.termMonths) {
      setError("Please select a repayment period.");
      return;
    }

    try {
      setLoading(true);

      await request("/loans", {
        method: "POST",
        token: user.token,
        body: {
          loanType: form.loanType,
          amount: Number(form.amount),
          termMonths: Number(form.termMonths),
          purpose: form.purpose.trim(),
        },
      });

      setSuccess("Your loan application has been submitted successfully.");

      setForm({
        loanType: "",
        amount: "",
        termMonths: "",
        purpose: "",
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="loan-application-page">
        <div className="loan-application-card">
          <h1>Loan Application</h1>

          <p>Please log in to apply for a cooperative loan.</p>

          <Link to="/login" className="btn-primary">
            Log In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="loan-application-page">
      <div className="loan-application-card">
        <div className="loan-application-header">
          <p className="eyebrow">Loan Application</p>

          <h1>Apply for a Loan</h1>

          <p>
            Complete the form below. Your application will be reviewed by the
            cooperative administrator.
          </p>
        </div>

        {error && <div className="loan-form-message error">{error}</div>}

        {success && (
          <div className="loan-form-message success">
            <strong>Application submitted</strong>

            <p>{success}</p>

            <button
              type="button"
              className="btn-primary"
              onClick={() => navigate("/loans")}
            >
              Back to Loans
            </button>
          </div>
        )}

        {!success && (
          <form className="loan-application-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="loanType">Loan Category</label>

              <select
                id="loanType"
                name="loanType"
                value={form.loanType}
                onChange={handleChange}
                required
              >
                <option value="">Select loan category</option>

                <option value="emergency">Emergency Loan</option>

                <option value="business">Business Loan</option>

                <option value="personal">Personal Loan</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="amount">Amount Requested (₦)</label>

              <input
                id="amount"
                name="amount"
                type="number"
                min="1"
                step="1"
                placeholder="e.g. 100000"
                value={form.amount}
                onChange={handleChange}
                required
              />

              <small>
                Your requested amount will be checked against your current loan
                eligibility.
              </small>
            </div>

            <div className="form-group">
              <label htmlFor="termMonths">Repayment Period</label>

              <select
                id="termMonths"
                name="termMonths"
                value={form.termMonths}
                onChange={handleChange}
                required
              >
                <option value="">Select repayment period</option>

                <option value="3">
                  3 Months
                  {membershipType === "interest-free" ? "" : " (5% interest)"}
                </option>
                <option value="6">
                  6 Months
                  {membershipType === "interest-free" ? "" : " (7% interest)"}
                </option>
                <option value="12">
                  12 Months
                  {membershipType === "interest-free"
                    ? ""
                    : " (10% interest)"}
                </option>
              </select>

              {membershipType === "interest-free" && (
                <small>
                  Your membership is interest-free — no interest is charged
                  on loans.
                </small>
              )}

              {estimatedTotal !== null && (
                <small>
                  Estimated total repayment: ₦
                  {estimatedTotal.toLocaleString()} at {selectedRate}%
                  interest.
                </small>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="purpose">Purpose of Loan</label>

              <textarea
                id="purpose"
                name="purpose"
                rows="5"
                maxLength="1000"
                placeholder="Briefly explain what you need the loan for..."
                value={form.purpose}
                onChange={handleChange}
              />
            </div>

            <div className="loan-form-notice">
              <strong>Important</strong>

              <p>
                Submitting this form does not guarantee approval. Your
                application will be reviewed by the cooperative administrator.
              </p>
            </div>

            <div className="loan-form-actions">
              <Link to="/loans" className="btn-secondary">
                Cancel
              </Link>

              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? "Submitting..." : "Submit Loan Application"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default LoanApplication;
