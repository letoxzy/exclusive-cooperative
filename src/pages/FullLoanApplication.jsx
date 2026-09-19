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
  const [kycLoading, setKycLoading] = useState(false);
  const [showKycWidget, setShowKycWidget] = useState(false);
  const [kycStatus, setKycStatus] = useState(null);

  const DOJAH_WIDGET_URL = import.meta.env.VITE_DOJAH_WIDGET_URL || "";

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

        const [membershipData, applicationData, kycData] = await Promise.all([
          request("/membership/me", { token: user.token }),
          request("/loans/eligibility-application/me", {
            token: user.token,
          }),
          request("/kyc/status", { token: user.token }),
        ]);

        if (cancelled) return;

        if (!membershipData || membershipData.status !== "approved") {
          setPageError(
            "You need an approved membership application before you can submit a full loan application."
          );
        } else {
          setMembership(membershipData);
        }

        setApplication(applicationData || kycData?.application || null);
        setKycStatus(kycData?.application || null);
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

      const result = await request("/kyc/bvn/verify", {
        method: "POST",
        token: user.token,
        body: { bvn: bvn.trim() },
      });

      setApplication(result.application || null);
      setKycStatus(result.application || null);
      setBvn("");
      setSuccess(
        result.message ||
          "Your BVN has been verified and your Full Loan Application is awaiting cooperative review."
      );
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const startKycWidget = () => {
    setFormError("");
    setSuccess("");
    if (!DOJAH_WIDGET_URL) {
      setFormError(
        "Dojah Sandbox widget is not configured yet. Add VITE_DOJAH_WIDGET_URL to the website environment variables after publishing your EasyOnboard Sandbox flow."
      );
      return;
    }
    setShowKycWidget(true);
  };

  const refreshKycStatus = async () => {
    try {
      const data = await request("/kyc/status", { token: user.token });
      setKycStatus(data?.application || null);
      setApplication(data?.application || application);
    } catch {
      // Keep the current UI state if the status refresh fails.
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
            then complete secure BVN verification to submit.
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

                <dt>Date of Birth</dt>
                <dd>{membership.dob || "—"}</dd>

                <dt>Gender</dt>
                <dd>{membership.gender || "—"}</dd>

                <dt>Phone</dt>
                <dd>{membership.phone || "—"}</dd>

                <dt>Email</dt>
                <dd>{membership.email || "—"}</dd>

                <dt>Address</dt>
                <dd>{membership.address || "—"}</dd>

                <dt>Occupation</dt>
                <dd>{membership.occupation || "—"}</dd>

                <dt>Employment Status</dt>
                <dd>{membership.employmentStatus || "—"}</dd>

                <dt>State of Origin</dt>
                <dd>{membership.stateOfOrigin || "—"}</dd>

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

            <div className="loan-eligibility-summary">
              <strong>Current Savings</strong>
              <p>₦{Number(user.savingsBalance || 0).toLocaleString()}</p>
              <small>
                Your savings balance is used by the cooperative to determine
                your maximum loan eligibility after approval.
              </small>
            </div>

            <form className="loan-application-form" onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="bvn">Bank Verification Number (BVN)</label>

                <input
                  id="bvn"
                  name="bvn"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength="11"
                  placeholder="Enter your 11-digit BVN"
                  value={bvn}
                  onChange={(e) => setBvn(e.target.value.replace(/\D/g, "").slice(0, 11))}
                  required
                />

                <small>
                  Your BVN is sent to the cooperative backend for Dojah Sandbox verification. The raw BVN is not returned to this website or stored in the loan application.
                </small>
              </div>

              <div className="loan-form-notice">
                <strong>Important</strong>

                <p>
                  This is not a loan request. BVN verification happens inside Exclusive Cooperative before the Full Loan Application can proceed. If your EasyOnboard flow includes liveness or face verification, you can complete that inside this page without being sent to another website.
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
                  {submitting ? "Verifying..." : "Verify BVN"}
                </button>

                <button
                  type="button"
                  className="btn-secondary"
                  onClick={startKycWidget}
                  disabled={kycLoading}
                >
                  Face & Liveness Verification
                </button>
              </div>
            </form>

            <div className="kyc-status-panel">
              <div><strong>BVN status:</strong> {kycStatus?.bvnVerificationStatus || "not started"}</div>
              <div><strong>Identity match:</strong> {kycStatus?.identityMatchStatus || "not started"}</div>
              <div><strong>Face/liveness:</strong> {kycStatus?.faceVerificationStatus || "not started"}</div>
            </div>
          </>
        )}

        {showKycWidget && (
          <div className="kyc-widget-overlay" role="dialog" aria-modal="true" aria-label="Identity verification">
            <div className="kyc-widget-card">
              <div className="kyc-widget-header">
                <div>
                  <p className="eyebrow">Exclusive Cooperative</p>
                  <h2>Identity verification</h2>
                  <p>Complete the Dojah Sandbox verification inside this page.</p>
                </div>
                <button type="button" className="kyc-close" onClick={() => setShowKycWidget(false)}>Close</button>
              </div>
              <iframe
                title="Dojah identity verification"
                src={DOJAH_WIDGET_URL}
                className="kyc-widget-frame"
                allow="camera; microphone; geolocation"
              />
              <div className="kyc-widget-footer">
                <button type="button" className="btn-secondary" onClick={refreshKycStatus}>Refresh verification status</button>
                <button type="button" className="btn-primary" onClick={() => setShowKycWidget(false)}>Done</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default FullLoanApplication;
