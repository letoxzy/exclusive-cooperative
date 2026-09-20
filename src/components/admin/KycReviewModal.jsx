import { useEffect, useMemo, useState } from "react";
import { FaXmark } from "react-icons/fa6";
import request from "../../utils/api";
import "../../styles/kyc-review.css";

const label = (value) =>
  String(value || "not started")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const formatDate = (value) =>
  value ? new Date(value).toLocaleString() : "—";

function MatchBadge({ value }) {
  if (value === true) return <span className="kyc-badge ok">✓ Match</span>;
  if (value === false) return <span className="kyc-badge bad">✕ Differs</span>;
  return <span className="kyc-badge muted">Can't compare</span>;
}

function CheckItem({ title, value, good }) {
  const state = good === true ? "ok" : good === false ? "bad" : "muted";
  return (
    <div className={`kyc-check ${state}`}>
      <span>{title}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PhotoTile({ title, src, onZoom }) {
  return (
    <figure className="kyc-photo">
      <div className="kyc-photo-frame">
        {src ? (
          <button
            type="button"
            className="kyc-photo-button"
            onClick={() => onZoom({ src, title })}
            aria-label={`Enlarge ${title}`}
          >
            <img src={src} alt={title} referrerPolicy="no-referrer" />
          </button>
        ) : (
          <span className="kyc-photo-empty">Not available</span>
        )}
      </div>
      <figcaption>{title}</figcaption>
    </figure>
  );
}

function KycReviewModal({ applicationId, token, onClose, onDone }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acting, setActing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [zoom, setZoom] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    request(`/admin/loan-eligibility-applications/${applicationId}/verification`, { token })
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError("");
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [applicationId, token, reloadKey]);

  const retry = () => {
    setLoading(true);
    setError("");
    setReloadKey((value) => value + 1);
  };

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      if (zoom) setZoom(null);
      else if (!acting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom, acting, onClose]);

  const view = useMemo(() => {
    if (!data) return null;

    const { application, member, snapshot, live, comparison } = data;

    // Prefer live Dojah data; fall back to what was saved at submission.
    const bvn = live?.bvn || {
      fullName: snapshot?.bvn?.fullName || "",
      dob: snapshot?.bvn?.dob || "",
      gender: snapshot?.bvn?.gender || "",
      phone: snapshot?.bvn?.phoneLast4 ? `•••••••${snapshot.bvn.phoneLast4}` : "",
      photo: "",
    };

    const id = live?.id || {
      fullName: snapshot?.id?.fullName || "",
      documentType: snapshot?.id?.documentType || "",
      documentNumber: snapshot?.id?.documentLast4 ? `••••${snapshot.id.documentLast4}` : "",
      url: "",
      backUrl: "",
    };

    const rows = [
      {
        key: "name",
        title: "Full name",
        member: member.fullName,
        bvn: bvn.fullName,
        id: id.fullName,
        idResult: comparison?.idNameMatched,
        result: comparison?.nameMatched,
      },
      {
        key: "dob",
        title: "Date of birth",
        member: member.dob,
        bvn: bvn.dob,
        id: "",
        result: comparison?.dobMatched,
      },
      {
        key: "phone",
        title: "Phone number",
        member: member.phone,
        bvn: bvn.phone,
        id: "",
        result: comparison?.phoneMatched,
      },
      {
        key: "gender",
        title: "Gender",
        member: member.gender,
        bvn: bvn.gender,
        id: "",
        result: comparison?.genderMatched,
      },
    ];

    const flags = [];
    if (comparison?.nameMatched === false) flags.push("the name differs");
    if (comparison?.dobMatched === false) flags.push("the date of birth differs");
    if (snapshot?.duplicateBvn) flags.push("this BVN was also used on another member's application");
    if (application.identityMatchStatus === "mismatch" && !flags.length) flags.push("the automatic identity comparison failed");

    return { application, member, snapshot, live, bvn, id, rows, flags };
  }, [data]);

  const act = async (action) => {
    try {
      setActing(true);
      setError("");

      await request(`/admin/loan-eligibility-applications/${applicationId}`, {
        method: "PATCH",
        token,
        body:
          action === "reject"
            ? { action, rejectionReason: reason.trim() }
            : { action, confirmMismatch: confirmed },
      });

      await onDone();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setActing(false);
    }
  };

  const application = view?.application;
  const isPending = application?.status === "pending";
  const needsConfirm = Boolean(
    isPending &&
      (application.identityMatchStatus !== "matched" || view.snapshot?.duplicateBvn)
  );
  const verificationPassed =
    application?.providerVerificationStatus === "completed" &&
    application?.bvnVerificationStatus === "verified" &&
    application?.faceVerificationStatus === "verified";
  const canApprove = isPending && verificationPassed && (!needsConfirm || confirmed);

  return (
    <div className="kyc-review-backdrop" onMouseDown={() => !acting && onClose()}>
      <div
        className="kyc-review"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kyc-review-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="kyc-review-header">
          <div>
            <p className="kyc-review-eyebrow">Full Loan Application review</p>
            <h2 id="kyc-review-title">
              {application?.user?.fullName || data?.member?.fullName || "Member"}
            </h2>
            {application && (
              <p className="kyc-review-sub">
                {application.user?.email}
                {application.verificationReference
                  ? ` · Ref ${application.verificationReference}`
                  : ""}
              </p>
            )}
          </div>
          <div className="kyc-review-header-side">
            {application && (
              <span className={`status-badge ${application.status}`}>
                {application.status === "draft" ? "In progress" : application.status}
              </span>
            )}
            <button
              type="button"
              className="kyc-review-close"
              onClick={onClose}
              disabled={acting}
              aria-label="Close"
            >
              <FaXmark />
            </button>
          </div>
        </header>

        <div className="kyc-review-body">
          {loading && <p className="kyc-review-loading">Loading verification details…</p>}

          {!loading && error && !view && (
            <div className="kyc-alert bad">
              {error}{" "}
              <button type="button" className="kyc-link" onClick={retry}>
                Try again
              </button>
            </div>
          )}

          {view && (
            <>
              {data.sandbox && (
                <div className="kyc-alert warn">
                  <strong>Sandbox mode.</strong> Dojah is returning test data, so the
                  identity details will not match real members. Switch to your live
                  Dojah keys to verify real people.
                </div>
              )}

              {data.liveError && (
                <div className="kyc-alert warn">
                  Photos could not be loaded from Dojah right now ({data.liveError}).
                  Showing the details saved at submission instead.
                </div>
              )}

              {application.status === "draft" && (
                <div className="kyc-alert info">
                  This member has not finished identity verification yet, so there
                  is nothing to approve.
                </div>
              )}

              {isPending && view.flags.length > 0 && (
                <div className="kyc-alert bad">
                  <strong>Please check before approving:</strong>{" "}
                  {view.flags.join("; ")}.
                </div>
              )}

              <section>
                <h3>Photos</h3>
                <div className="kyc-photo-grid">
                  <PhotoTile title="Membership photo" src={view.member.passportPhotoUrl} onZoom={setZoom} />
                  <PhotoTile title="BVN photo" src={view.bvn.photo} onZoom={setZoom} />
                  <PhotoTile title="ID document" src={view.id.url} onZoom={setZoom} />
                  <PhotoTile title="Live selfie" src={view.live?.selfie?.url} onZoom={setZoom} />
                </div>
                <p className="kyc-hint">
                  Dojah photo links expire after about an hour, so they are loaded
                  fresh every time you open this review.
                </p>
              </section>

              <section>
                <h3>Compare details</h3>
                <div className="kyc-table-wrap">
                  <table className="kyc-compare">
                    <thead>
                      <tr>
                        <th>Detail</th>
                        <th>Membership record</th>
                        <th>BVN record</th>
                        <th>ID document</th>
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.rows.map((row) => (
                        <tr key={row.key} className={row.result === false ? "differs" : ""}>
                          <th scope="row">{row.title}</th>
                          <td>{row.member || "—"}</td>
                          <td>{row.bvn || "—"}</td>
                          <td>
                            {row.id || "—"}
                            {row.id && row.idResult === true && <span className="kyc-tick ok"> ✓</span>}
                            {row.id && row.idResult === false && <span className="kyc-tick bad"> ✕</span>}
                          </td>
                          <td><MatchBadge value={row.result} /></td>
                        </tr>
                      ))}
                      {view.id.documentType && (
                        <tr>
                          <th scope="row">ID document</th>
                          <td>—</td>
                          <td>—</td>
                          <td>
                            {view.id.documentType}
                            {view.id.documentNumber ? ` · ${view.id.documentNumber}` : ""}
                          </td>
                          <td><span className="kyc-badge muted">For reference</span></td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h3>Verification checks</h3>
                <div className="kyc-check-grid">
                  <CheckItem
                    title="Dojah verification"
                    value={label(application.providerVerificationStatus)}
                    good={application.providerVerificationStatus === "completed"}
                  />
                  <CheckItem
                    title="BVN"
                    value={label(application.bvnVerificationStatus)}
                    good={application.bvnVerificationStatus === "verified"}
                  />
                  <CheckItem
                    title="Face & liveness"
                    value={label(application.faceVerificationStatus)}
                    good={application.faceVerificationStatus === "verified"}
                  />
                  <CheckItem
                    title="Automatic identity match"
                    value={label(application.identityMatchStatus)}
                    good={application.identityMatchStatus === "matched"}
                  />
                  <CheckItem
                    title="BVN used elsewhere"
                    value={view.snapshot?.duplicateBvn ? "Yes — another member" : "No"}
                    good={view.snapshot ? !view.snapshot.duplicateBvn : null}
                  />
                  <CheckItem
                    title="Verified from"
                    value={
                      [view.live?.location?.city, view.live?.location?.country]
                        .filter(Boolean)
                        .join(", ") || "—"
                    }
                    good={null}
                  />
                </div>
                {(view.live?.dashboardUrl || view.live?.reportUrl) && (
                  <p className="kyc-links">
                    {view.live.dashboardUrl && (
                      <a href={view.live.dashboardUrl} target="_blank" rel="noreferrer">
                        Open in Dojah dashboard
                      </a>
                    )}
                    {view.live.reportUrl && (
                      <a href={view.live.reportUrl} target="_blank" rel="noreferrer">
                        Download verification report (PDF)
                      </a>
                    )}
                  </p>
                )}
              </section>

              <section>
                <h3>Member details</h3>
                <dl className="kyc-details">
                  <div><dt>Address</dt><dd>{view.member.address || "—"}</dd></div>
                  <div><dt>Occupation</dt><dd>{view.member.occupation || "—"}</dd></div>
                  <div><dt>Employment</dt><dd>{view.member.employmentStatus || "—"}</dd></div>
                  <div><dt>Email</dt><dd>{view.member.email || "—"}</dd></div>
                  <div>
                    <dt>Next of kin</dt>
                    <dd>
                      {view.member.kinName || "—"}
                      {view.member.kinPhone ? ` (${view.member.kinPhone})` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>Savings</dt>
                    <dd>₦{Number(view.member.savingsBalance || 0).toLocaleString()}</dd>
                  </div>
                  <div><dt>Submitted</dt><dd>{formatDate(application.submittedDate)}</dd></div>
                </dl>
              </section>

              {application.status === "approved" && (
                <div className="kyc-alert ok">
                  Approved on {formatDate(application.reviewedDate)}
                  {application.reviewedBy ? ` by ${application.reviewedBy}` : ""}.
                  {application.approvedWithMismatch &&
                    " The administrator confirmed approval despite flagged differences."}
                </div>
              )}

              {application.status === "rejected" && (
                <div className="kyc-alert bad">
                  <strong>Rejected</strong>
                  {application.reviewedDate ? ` on ${formatDate(application.reviewedDate)}` : ""}
                  {application.reviewedBy ? ` by ${application.reviewedBy}` : ""}.{" "}
                  {application.rejectionReason}
                </div>
              )}
            </>
          )}
        </div>

        {view && isPending && (
          <footer className="kyc-review-footer">
            {error && <div className="kyc-alert bad">{error}</div>}

            {needsConfirm && !rejecting && (
              <label className="kyc-confirm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  disabled={acting}
                />
                <span>
                  I have reviewed the differences above and want to approve this
                  member anyway.
                </span>
              </label>
            )}

            {rejecting ? (
              <div className="kyc-reject-box">
                <label htmlFor="kyc-reject-reason">Reason shown to the member</label>
                <textarea
                  id="kyc-reject-reason"
                  rows={3}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="For example: the name on the ID does not match your membership record."
                  disabled={acting}
                  autoFocus
                />
                <div className="kyc-actions">
                  <button
                    type="button"
                    className="kyc-btn ghost"
                    onClick={() => setRejecting(false)}
                    disabled={acting}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="kyc-btn danger"
                    onClick={() => act("reject")}
                    disabled={acting || reason.trim().length < 3}
                  >
                    {acting ? "Rejecting…" : "Reject application"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="kyc-actions">
                <button
                  type="button"
                  className="kyc-btn ghost-danger"
                  onClick={() => setRejecting(true)}
                  disabled={acting}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="kyc-btn primary"
                  onClick={() => act("approve")}
                  disabled={acting || !canApprove}
                  title={
                    !verificationPassed
                      ? "Waiting for all required verification steps"
                      : needsConfirm && !confirmed
                        ? "Tick the confirmation box to approve"
                        : "Approve application"
                  }
                >
                  {acting ? "Approving…" : "Approve"}
                </button>
              </div>
            )}
          </footer>
        )}
      </div>

      {zoom && (
        <div
          className="kyc-zoom"
          role="dialog"
          aria-label={zoom.title}
          onMouseDown={(event) => {
            event.stopPropagation();
            setZoom(null);
          }}
        >
          <img src={zoom.src} alt={zoom.title} referrerPolicy="no-referrer" />
          <span>{zoom.title} — click anywhere to close</span>
        </div>
      )}
    </div>
  );
}

export default KycReviewModal;
