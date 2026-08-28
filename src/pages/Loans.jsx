import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import request from "../utils/api";
import "../styles/loans.css";

function Loans() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [eligibility, setEligibility] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadEligibility = useCallback(async () => {
    if (!user?.token) {
      setEligibility(null);
      return;
    }

    try {
      setLoading(true);
      setError("");

      const data = await request("/loans/eligibility", {
        token: user.token,
      });

      setEligibility(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user?.token]);

  useEffect(() => {
    loadEligibility();
  }, [loadEligibility]);

  const loanTypes = [
    {
      name: "Emergency Loan",
      value: "emergency",
      desc: "Fast-access support for urgent, unplanned expenses.",
    },
    {
      name: "Business Loan",
      value: "business",
      desc: "Capital support for members growing or starting a business.",
    },
    {
      name: "Personal Loan",
      value: "personal",
      desc: "Flexible funding for personal goals and major purchases.",
    },
  ];

  const handleApply = () => {
    navigate("/loans/apply");
  };

  const handleApplyFull = () => {
    navigate("/loans/apply-full");
  };

  return (
    <div className="loans-page">
      <header className="page-hero">
        <p className="eyebrow">Loans</p>

        <h1>Support when you need it, on fair member-first terms</h1>

        <p className="page-hero-sub">
          Active, savings-consistent members can access loan facilities designed
          to be achievable — not another burden.
        </p>
      </header>

      <section className="loan-calculator">
        <div className="calc-card">
          <h2>Check Your Loan Eligibility</h2>

          <p className="calc-rule">
            Members can borrow up to <strong>2x</strong> their total savings
            with the cooperative.
          </p>

          {!user ? (
            <div className="loan-login-message">
              <p>
                Please log in to view your actual savings balance and loan
                eligibility.
              </p>

              <Link to="/login" className="btn-primary">
                Log In
              </Link>
            </div>
          ) : loading ? (
            <div className="loan-loading">Checking your eligibility...</div>
          ) : error ? (
            <div className="loan-error">
              <p>{error}</p>

              <button
                type="button"
                className="btn-primary"
                onClick={loadEligibility}
              >
                Try Again
              </button>
            </div>
          ) : eligibility ? (
            <div className="real-eligibility">
              <div className="eligibility-summary">
                <div className="eligibility-item">
                  <span>Your Savings</span>
                  <strong>
                    ₦{Number(eligibility.savingsBalance || 0).toLocaleString()}
                  </strong>
                </div>

                <div className="eligibility-item">
                  <span>Maximum Loan</span>
                  <strong>
                    ₦{Number(eligibility.eligibleAmount || 0).toLocaleString()}
                  </strong>
                </div>
              </div>

              {eligibility.hasActiveLoan ? (
                <div className="loan-status-message warning">
                  <strong>You have an active loan.</strong>

                  <p>
                    Please complete your current loan before applying for
                    another one.
                  </p>
                </div>
              ) : eligibility.hasPendingApplication ? (
                <div className="loan-status-message pending">
                  <strong>Loan application under review.</strong>

                  <p>
                    You already have a pending loan application. Please
                    wait for the cooperative administrator to review it.
                  </p>
                </div>
              ) : !eligibility.isLoanEligible ? (
                eligibility.eligibilityApplication?.status === "pending" ? (
                  <div className="loan-status-message pending">
                    <strong>Full loan application under review.</strong>

                    <p>
                      Your full loan application is awaiting review by the
                      cooperative administrator. You'll be able to apply
                      for a loan once it's approved.
                    </p>
                  </div>
                ) : eligibility.eligibilityApplication?.status ===
                  "rejected" ? (
                  <div className="loan-status-message warning">
                    <strong>Full loan application not approved.</strong>

                    <p>
                      {eligibility.eligibilityApplication.rejectionReason ||
                        "Your last full loan application was not approved."}
                    </p>

                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleApplyFull}
                    >
                      Resubmit Full Loan Application
                    </button>
                  </div>
                ) : (
                  <div className="loan-status-message eligible">
                    <strong>Start your full loan application.</strong>

                    <p>
                      Before you can apply for a loan, submit a full loan
                      application (your BVN and details from your
                      membership record) for admin review.
                    </p>

                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleApplyFull}
                    >
                      Full Loan Application
                    </button>
                  </div>
                )
              ) : eligibility.canApply ? (
                <div className="loan-status-message eligible">
                  <strong>You are eligible to apply.</strong>

                  <p>
                    You can request up to ₦
                    {Number(eligibility.eligibleAmount || 0).toLocaleString()}.
                  </p>

                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleApply}
                  >
                    Apply for Loan
                  </button>
                </div>
              ) : (
                <div className="loan-status-message warning">
                  <strong>You are not currently eligible.</strong>

                  <p>
                    Your full loan application has been approved, but you
                    need savings with the cooperative to determine your
                    loan amount (up to 2x your savings balance).
                  </p>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </section>

      <section className="loan-types">
        <h2>Loan Categories</h2>

        <div className="loan-grid">
          {loanTypes.map((loan) => (
            <div className="loan-card" key={loan.value}>
              <h3>{loan.name}</h3>
              <p>{loan.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="eligibility">
        <h2>Eligibility</h2>

        <ul>
          <li>Registered member in good standing</li>

          <li>Membership application must be approved by the cooperative</li>

          <li>Consistent savings history with the cooperative</li>

          <li>Loan amount is capped at 2x your total savings balance</li>

          <li>
            Members cannot have another active or pending loan application
          </li>

          <li>
            Membership does not automatically guarantee a loan — each request is
            reviewed
          </li>
        </ul>
      </section>

      <section className="cta-banner">
        <h2>Not a member yet? Start with membership first.</h2>

        <Link to="/membership" className="btn-primary">
          Apply for Membership
        </Link>
      </section>
    </div>
  );
}

export default Loans;
