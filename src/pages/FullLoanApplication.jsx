import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import request from "../utils/api";
import "../styles/loan-application.css";
import "../styles/full-loan-application.css";

function FullLoanApplication() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [membership, setMembership] = useState(null);
  const [application, setApplication] = useState(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState("");

  const [bvn, setBvn] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");

  // Savings/contributions are a separate concern — this only loads
  // the member's bio-data (membership) and their existing Full Loan
  // Application status, if any.
  useEffect(() => {
    if (!user) {
      setPageLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setPageLoading(true);

        const [membershipData, applicationData] = await Promise.all([
          request("/membership/me", { token: user.token }),
          request("/loans/eligibility-application/me", {
            token: user.token,
          }),
        ]);

        if (cancelled) return;

        if (!membershipData || membershipData.status !== "approved") {
          setPageError(
            "You need an approved membership application before you can submit a full loan application."
          );
        } else {
          setMembership(membershipData);
        }

        setApplication(applicationData);
      } catch (err) {
        if (!cancelled) setPageError(err.message);
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    setFormError("");
    setSuccess("");

    if (!/^\d{11}$/.test(bvn.trim())) {
      setFormError("Please enter a valid 11-digit BVN.");
      return;
    }

    try {
      setSubmitting(true);

      const created = await request("/loans/eligibility-application", {
        method: "POST",
        token: user.token,
        body: { bvn: bvn.trim() },
      });

      setApplication(created);
      setSuccess(
        "Your full loan application has been submitted. An admin will review your details before you're eligible to apply for a loan."
      );
      setBvn("");
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) {
    return (
      <div className="loan-application-page">
        <div className="loan-application-card">
          <h1>Full Loan Application</h1>

          <p>Please log in to submit a full loan application.</p>

          <Link to="/login" className="btn-primary">
            Log In
          </Link>
        </div>
      </div>
    );
  }

  if (pageLoading) {
    return (
      <div className="loan-application-page">
        <div className="loan-application-card">
          <p className="loan-loading-text">Loading your details...</p>
        </div>
      </div>
    );
  }

  if (pageError) {
    return (
      <div className="loan-application-page">
        <div className="loan-application-card">
          <div className="loan-application-header">
            <p className="eyebrow">Full Loan Application</p>
            <h1>Full Loan Application</h1>
          </div>

          <div className="loan-form-message error">{pageError}</div>

          <Link to="/loans" className="btn-secondary">
            Back to Loans
          </Link>
        </div>
      </div>
    );
  }

  // Already approved — nothing more to do here.
  if (application?.status === "approved") {
    return (
      <div className="loan-application-page">
        <div className="loan-application-card">
          <div className="loan-application-header">
            <p className="eyebrow">Full Loan Application</p>
            <h1>You're Loan Eligible</h1>
          </div>

          <div className="loan-form-message success">
            <strong>Application approved</strong>
            <p>
              Your full loan application has been approved. You can now
              apply for a loan.
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => navigate("/loans/apply")}
            >
              Apply for Loan
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Awaiting admin review.
  if (application?.status === "pending") {
    return (
      <div className="loan-application-page">
        <div className="loan-application-card">
          <div className="loan-application-header">
            <p className="eyebrow">Full Loan Application</p>
            <h1>Application Under Review</h1>
          </div>

          <div className="loan-form-message pending-message">
            <strong>Awaiting review</strong>
            <p>
              Your full loan application (submitted{" "}
              {application.submittedDate
                ? new Date(application.submittedDate).toLocaleDateString()
                : "recently"}
              ) is awaiting review by the cooperative administrator. You'll
              be able to apply for a loan once it's approved.
            </p>
          </div>

          <Link to="/loans" className="btn-secondary">
            Back to Loans
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="loan-application-page">
      <div className="loan-application-card">
        <div className="loan-application-header">
          <p className="eyebrow">Full Loan Application</p>

          <h1>Full Loan Application</h1>

          <p>
            Before you can apply for a loan, submit your full loan
            application for review. Your personal details below were
            pulled from your approved membership record — review them,
            then add your BVN to submit.
          </p>
        </div>

        {application?.status === "rejected" && (
          <div className="loan-form-message error">
            <strong>Previous application rejected</strong>
            <p>
              {application.rejectionReason ||
                "Your last full loan application was not approved."}{" "}
              You can submit a new one below.
            </p>
          </div>
        )}

        {formError && (
          <div className="loan-form-message error">{formError}</div>
        )}

        {success && (
          <div className="loan-form-message success">
            <strong>Application submitted</strong>
            <p>{success}</p>
          </div>
        )}

        {!success && membership && (
          <>
            <div className="applicant-details-summary">
              <strong>Applicant Details (from your membership record)</strong>

              <dl>
                <dt>Full Name</dt>
                <dd>{membership.fullName || "—"}</dd>

                <dt>Phone</dt>
                <dd>{membership.phone || "—"}</dd>

                <dt>Email</dt>
                <dd>{membership.email || "—"}</dd>

                <dt>Address</dt>
                <dd>{membership.address || "—"}</dd>

                <dt>Occupation</dt>
                <dd>{membership.occupation || "—"}</dd>

                <dt>Next of Kin</dt>
                <dd>
                  {membership.kinName || "—"}
                  {membership.kinPhone ? ` (${membership.kinPhone})` : ""}
                </dd>
              </dl>

              <small>
                Need to update any of this? Update it on your{" "}
                <Link to="/profile">profile</Link> first, then come back to
                apply.
              </small>
            </div>

            <form className="loan-application-form" onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="bvn">Bank Verification Number (BVN)</label>

                <input
                  id="bvn"
                  name="bvn"
                  type="text"
                  inputMode="numeric"
                  maxLength="11"
                  placeholder="e.g. 22112233445"
                  value={bvn}
                  onChange={(e) => setBvn(e.target.value)}
                  required
                />

                <small>Your 11-digit BVN, required for loan eligibility.</small>
              </div>

              <div className="loan-form-notice">
                <strong>Important</strong>

                <p>
                  This is not a loan request — it's the eligibility review
                  step. Once approved, you'll be able to apply for an
                  actual loan (amount, term, and purpose) separately.
                </p>
              </div>

              <div className="loan-form-actions">
                <Link to="/loans" className="btn-secondary">
                  Cancel
                </Link>

                <button
                  type="submit"
                  className="btn-primary"
                  disabled={submitting}
                >
                  {submitting ? "Submitting..." : "Submit for Review"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default FullLoanApplication;
