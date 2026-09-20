import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import request from "../utils/api";
import "../styles/loan-application.css";
import "../styles/full-loan-application.css";

const statusLabel = (value) =>
  String(value || "not_started")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

function FullLoanApplication() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [membership, setMembership] = useState(null);
  const [application, setApplication] = useState(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState("");
  const [kycLoading, setKycLoading] = useState(false);
  const [showKycWidget, setShowKycWidget] = useState(false);
  const [verificationReference, setVerificationReference] = useState("");
  const [submissionSuccess, setSubmissionSuccess] = useState(false);
  const [consent, setConsent] = useState(false);
  const [widgetNotice, setWidgetNotice] = useState("");

  const DOJAH_WIDGET_URL = import.meta.env.VITE_DOJAH_WIDGET_URL || "";

  const load = useCallback(async () => {
    if (!user) return;

    try {
      setPageLoading(true);
      setPageError("");

      const [membershipData, applicationData, kycData] = await Promise.all([
        request("/membership/me", { token: user.token }),
        request("/loans/eligibility-application/me", { token: user.token }),
        request("/kyc/status", { token: user.token }),
      ]);

      if (!membershipData || membershipData.status !== "approved") {
        setPageError(
          "You need an approved membership application before you can complete identity verification."
        );
        return;
      }

      setMembership(membershipData);
      setApplication(applicationData || kycData?.application || null);
    } catch (err) {
      setPageError(
        err?.message || "We couldn't load your loan application details."
      );
    } finally {
      setPageLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const savings = Number(user?.savingsBalance || 0);
  const potentialLoanLimit = savings * 2;

  const verificationSteps = useMemo(
    () => [
      {
        label: "BVN verification",
        value: application?.bvnVerificationStatus,
      },
      {
        label: "Identity match",
        value: application?.identityMatchStatus,
      },
      {
        label: "Government ID",
        value:
          application?.providerVerificationStatus === "completed"
            ? "verified"
            : "pending",
      },
      {
        label: "Face & liveness",
        value: application?.faceVerificationStatus,
      },
    ],
    [application]
  );

  const verificationComplete =
    application?.providerVerificationStatus === "completed" &&
    application?.bvnVerificationStatus === "verified" &&
    application?.identityMatchStatus === "matched" &&
    application?.faceVerificationStatus === "verified";

  const startKycWidget = async () => {
    setPageError("");
    setNotice("");

    if (!DOJAH_WIDGET_URL) {
      setPageError(
        "Identity verification is temporarily unavailable. Please try again later."
      );
      return;
    }

    if (!consent) {
      setPageError("Please tick the consent box before you continue.");
      return;
    }

    try {
      setKycLoading(true);

      // The server creates the reference and remembers it for this member,
      // so a verification can only ever be claimed by the member who started it.
      const started = await request("/kyc/start", {
        method: "POST",
        token: user.token,
        body: { consent: true },
      });

      setVerificationReference(started.referenceId);
      setShowKycWidget(true);
    } catch (err) {
      setPageError(
        err?.message || "We couldn't start identity verification. Please try again."
      );
    } finally {
      setKycLoading(false);
    }
  };

  const closeWidget = () => {
    setShowKycWidget(false);
    setWidgetNotice("");
  };

  const confirmVerification = async () => {
    if (!verificationReference) return;

    try {
      setKycLoading(true);
      setPageError("");
      setNotice("");
      setWidgetNotice("");

      const result = await request("/kyc/widget-result", {
        method: "POST",
        token: user.token,
        body: { referenceId: verificationReference },
      });

      const updated = result?.application || result?.verification || null;
      if (updated) setApplication(updated);

      if (result?.submitted) {
        closeWidget();
        setVerificationReference("");
        setSubmissionSuccess(true);
      } else if (updated?.status === "rejected") {
        closeWidget();
        setVerificationReference("");
        setPageError(
          updated.rejectionReason ||
            "We could not confirm your identity verification. Please try again."
        );
      } else {
        // Not finished yet: keep the verification open so the member can continue.
        setWidgetNotice(
          result?.message ||
            "Your verification is not finished yet. Please complete all the steps, then tap the button again."
        );
      }
    } catch (err) {
      setWidgetNotice(
        `We couldn't confirm the verification yet. If you have just completed the steps, wait a moment and tap the button again.${
          err?.message ? ` (${err.message})` : ""
        }`
      );
    } finally {
      setKycLoading(false);
    }
  };

  const widgetUrl = useMemo(() => {
    if (!DOJAH_WIDGET_URL || !verificationReference) return DOJAH_WIDGET_URL;

    try {
      const url = new URL(DOJAH_WIDGET_URL);
      url.searchParams.set("reference_id", verificationReference);
      return url.toString();
    } catch {
      return DOJAH_WIDGET_URL;
    }
  }, [DOJAH_WIDGET_URL, verificationReference]);

  if (!user) {
    return (
      <div className="loan-application-page">
        <div className="loan-application-card">
          <h1>Full Loan Application</h1>
          <p>Please log in to continue.</p>
          <Link to="/login" className="btn-primary">Log In</Link>
        </div>
      </div>
    );
  }

  if (pageLoading) {
    return (
      <div className="loan-application-page">
        <div className="loan-application-card loan-loading-card">
          <div className="loan-loading-spinner" />
          <p>Loading your application...</p>
        </div>
      </div>
    );
  }

  if (pageError && !membership) {
    return (
      <div className="loan-application-page">
        <div className="loan-application-card">
          <div className="full-loan-error-icon">!</div>
          <div className="loan-application-header">
            <p className="eyebrow">Full Loan Application</p>
            <h1>We couldn't continue</h1>
          </div>
          <div className="loan-form-message error">{pageError}</div>
          <Link to="/loans" className="btn-secondary">Back to Loans</Link>
        </div>
      </div>
    );
  }

  if (application?.status === "approved") {
    return (
      <div className="loan-application-page">
        <div className="loan-application-card full-loan-success-card">
          <div className="full-loan-status-icon success">✓</div>
          <p className="eyebrow">Full Loan Application</p>
          <h1>You're loan eligible</h1>
          <p className="full-loan-lead">
            Your identity verification and eligibility review have been approved.
            You can now continue to the actual loan request.
          </p>
          <div className="full-loan-limit-card">
            <span>Current savings</span>
            <strong>₦{savings.toLocaleString()}</strong>
            <small>Potential loan limit: ₦{potentialLoanLimit.toLocaleString()}</small>
          </div>
          <button type="button" className="btn-primary full-loan-main-action" onClick={() => navigate("/loans/apply")}>
            Apply for a loan <span>→</span>
          </button>
          <Link to="/loans" className="full-loan-back-link">Back to Loans</Link>
        </div>
      </div>
    );
  }

  if (submissionSuccess && verificationComplete && application?.status === "pending") {
    return (
      <div className="loan-application-page">
        <div className="loan-application-card full-loan-submitted-card">
          <div className="full-loan-status-icon success">✓</div>
          <p className="eyebrow">Full Loan Application</p>
          <h1>Application submitted successfully</h1>
          <p className="full-loan-lead">
            Your Full Loan Application and identity verification have been submitted successfully to Exclusive Cooperative.
          </p>

          <div className="full-loan-submission-status">
            <span className="submission-status-dot" aria-hidden="true" />
            <div>
              <strong>Status: Pending Administrator Review</strong>
              <span>Your application is now with the Cooperative Administrator for review and approval.</span>
            </div>
          </div>

          <div className="full-loan-next-step">
            <strong>What happens next?</strong>
            <span>You don't need to submit anything else right now. We'll notify you when the administrator makes a decision on your application.</span>
          </div>

          <Link to="/loans" className="btn-primary full-width-button">Back to Loans</Link>
        </div>
      </div>
    );
  }

  if (verificationComplete && application?.status === "pending") {
    return (
      <div className="loan-application-page">
        <div className="loan-application-card full-loan-review-card">
          <div className="full-loan-status-icon pending">✓</div>
          <p className="eyebrow">Full Loan Application</p>
          <h1>Application under review</h1>
          <p className="full-loan-lead">
            Your identity verification is complete. The cooperative administrator
            will review your application before you can request a loan.
          </p>

          <div className="full-loan-review-banner">
            <strong>You're all set.</strong>
            <span>No further action is required from you right now.</span>
          </div>

          <div className="verification-grid compact">
            {verificationSteps.map((step) => (
              <div className="verification-step verified" key={step.label}>
                <span className="verification-step-icon">✓</span>
                <div>
                  <strong>{step.label}</strong>
                  <small>Verified</small>
                </div>
              </div>
            ))}
          </div>

          <Link to="/loans" className="btn-secondary full-width-button">Back to Loans</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="loan-application-page">
      <div className="loan-application-card full-loan-modern-card">
        <div className="full-loan-hero">
          <div className="full-loan-hero-icon">✓</div>
          <div>
            <p className="eyebrow">Full Loan Application</p>
            <h1>Complete your verification</h1>
            <p>
              Before requesting a loan, we need to verify your identity and review
              your application. This is a secure verification step — it is not a loan request.
            </p>
          </div>
        </div>

        {application?.status === "rejected" && (
          <div className="loan-form-message error">
            <strong>Verification needs attention</strong>
            <p>
              {application.rejectionReason ||
                "Your previous verification was not completed successfully."}
            </p>
          </div>
        )}

        {pageError && <div className="loan-form-message error">{pageError}</div>}
        {notice && <div className="loan-form-message success">{notice}</div>}

        <div className="full-loan-summary-grid">
          <div className="full-loan-summary-card">
            <span>Membership</span>
            <strong>{membership?.fullName || "Member"}</strong>
            <small>{membership?.membershipType === "interest-free" ? "Interest-Free Member" : "Interest-Bearing Member"}</small>
          </div>
          <div className="full-loan-summary-card">
            <span>Current savings</span>
            <strong>₦{savings.toLocaleString()}</strong>
            <small>Potential loan limit: ₦{potentialLoanLimit.toLocaleString()}</small>
          </div>
        </div>

        <div className="applicant-details-summary modern">
          <div className="section-heading-row">
            <div>
              <span className="section-kicker">Your details</span>
              <strong>Information from your approved membership</strong>
            </div>
            <Link to="/profile">Edit profile</Link>
          </div>
          <dl>
            <dt>Full name</dt><dd>{membership?.fullName || "—"}</dd>
            <dt>Date of birth</dt><dd>{membership?.dob || "—"}</dd>
            <dt>Phone</dt><dd>{membership?.phone || "—"}</dd>
            <dt>Email</dt><dd>{membership?.email || "—"}</dd>
            <dt>Address</dt><dd>{membership?.address || "—"}</dd>
            <dt>Occupation</dt><dd>{membership?.occupation || "—"}</dd>
            <dt>Next of kin</dt><dd>{membership?.kinName || "—"}</dd>
          </dl>
        </div>

        <div className="full-loan-verification-card">
          <div className="section-heading-row">
            <div>
              <span className="section-kicker">Secure verification</span>
              <h2>Identity verification</h2>
              <p>Complete the verification once. Your BVN is handled inside the secure verification flow.</p>
            </div>
            <span className="secure-pill">Secure</span>
          </div>

          <div className="verification-grid">
            {verificationSteps.map((step) => {
              const verified = step.value === "verified" || step.value === "matched";
              return (
                <div className={`verification-step ${verified ? "verified" : ""}`} key={step.label}>
                  <span className="verification-step-icon">{verified ? "✓" : "•"}</span>
                  <div>
                    <strong>{step.label}</strong>
                    <small>{verified ? "Verified" : statusLabel(step.value)}</small>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="full-loan-security-note">
            <strong>Your BVN stays protected</strong>
            <span>
              We do not display or store your full BVN in this application. Only the verification result and limited reference information are retained for your cooperative record.
            </span>
          </div>

          <label className="kyc-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              I consent to Exclusive Cooperative verifying my identity through
              Dojah using my BVN, government ID and a live selfie, so my loan
              eligibility can be reviewed.
            </span>
          </label>

          <button
            type="button"
            className="btn-primary full-loan-main-action"
            onClick={startKycWidget}
            disabled={kycLoading || !consent}
          >
            {kycLoading ? "Opening verification..." : "Start identity verification"}
            {!kycLoading && <span>→</span>}
          </button>

          <Link to="/loans" className="full-loan-cancel">Cancel and return to Loans</Link>
        </div>
      </div>

      {showKycWidget && (
        <div className="kyc-widget-overlay" role="dialog" aria-modal="true" aria-label="Identity verification">
          <div className="kyc-widget-card">
            <div className="kyc-widget-header">
              <div>
                <p className="eyebrow">Exclusive Cooperative</p>
                <h2>Secure identity verification</h2>
                <p>Complete all the steps shown to finish your verification.</p>
              </div>
              <button type="button" className="kyc-close" onClick={closeWidget}>Close</button>
            </div>
            <iframe
              title="Identity verification"
              src={widgetUrl}
              className="kyc-widget-frame"
              allow="camera; microphone; geolocation"
            />
            {widgetNotice && <div className="kyc-widget-notice">{widgetNotice}</div>}
            <div className="kyc-widget-footer">
              <button type="button" className="btn-secondary" onClick={closeWidget} disabled={kycLoading}>Return later</button>
              <button type="button" className="btn-primary" onClick={confirmVerification} disabled={kycLoading}>
                {kycLoading ? "Confirming..." : "I've completed verification"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FullLoanApplication;
