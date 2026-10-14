import { useCallback, useEffect, useState } from "react";
import request from "../../utils/api";
import { when } from "./adminFormat";
import "../../styles/deletion-requests.css";

const money = (value) => `₦${Number(value || 0).toLocaleString()}`;

function DeletionRequestsPanel({ token }) {
  const [requests, setRequests] = useState([]);
  const [status, setStatus] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [rejectingId, setRejectingId] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const q = status ? `?status=${status}` : "";
      const data = await request(`/admin/deletion-requests${q}`, { token });
      setRequests(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Could not load deletion requests.");
    } finally {
      setLoading(false);
    }
  }, [token, status]);

  useEffect(() => {
    load();
  }, [load]);

  const complete = async (item) => {
    const who = item.user?.fullName || item.email;
    const text = item.accountExists
      ? `Permanently delete the account for ${who}? This cannot be undone.`
      : `Mark this request as completed? No account exists for ${item.email}.`;
    if (!window.confirm(text)) return;

    setBusyId(item._id);
    setError("");
    try {
      await request(`/admin/deletion-requests/${item._id}`, {
        method: "PATCH",
        token,
        body: { action: "complete" },
      });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId("");
    }
  };

  const setAccess = async (item, action) => {
    const who = item.user?.fullName || item.email;
    const text =
      action === "grant"
        ? `Allow ${who} to withdraw ALL their savings (${money(item.savingsOwed)})? They will be able to withdraw it from the app or website now, ignoring the 40% monthly limit.`
        : `Stop ${who} from withdrawing all their savings?`;
    if (!window.confirm(text)) return;

    setBusyId(item._id);
    setError("");
    try {
      await request(`/admin/deletion-requests/${item._id}/withdrawal-access`, {
        method: "POST",
        token,
        body: { action },
      });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId("");
    }
  };

  const reject = async (item) => {
    setBusyId(item._id);
    setError("");
    try {
      await request(`/admin/deletion-requests/${item._id}`, {
        method: "PATCH",
        token,
        body: { action: "reject", note: note.trim() },
      });
      setRejectingId("");
      setNote("");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId("");
    }
  };

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="eyebrow">Members</p>
          <h1>Deletion Requests</h1>
          <p className="admin-subtitle">
            Members asking to close their account. Confirm who they are first.
            An account with savings or a loan cannot be deleted until it is
            settled. To pay out savings, press <strong>Allow full withdrawal</strong>:
            the member can then withdraw everything from the app or website, and
            once the balance is zero you can delete the account.
          </p>
        </div>
        <button type="button" className="admin-refresh-btn" onClick={load}>
          Refresh
        </button>
      </div>

      {error && <p className="form-error admin-error">{error}</p>}

      <div className="del-toolbar">
        <h3>Requests ({requests.length})</h3>
        <select
          className="del-select"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter requests"
        >
          <option value="pending">Waiting</option>
          <option value="completed">Completed</option>
          <option value="rejected">Declined</option>
          <option value="">All</option>
        </select>
      </div>

      {requests.length === 0 ? (
        <section className="admin-card">
          <p className="empty-state">
            {loading ? "Loading…" : "No deletion requests."}
          </p>
        </section>
      ) : (
        <div className="del-list">
          {requests.map((item) => {
            const pending = item.status === "pending";
            const blockers = pending ? item.currentBlockers || [] : [];
            const granted = Boolean(item.fullWithdrawal?.active);
            const name = item.user?.fullName || item.fullName || "Unknown member";
            const initial = (name.trim()[0] || "?").toUpperCase();
            const busy = busyId === item._id;
            const canDelete =
              !item.accountExists || (item.currentBlockers || []).length === 0;

            return (
              <article className={`del-card ${item.status}`} key={item._id}>
                <header className="del-head">
                  <div className="del-avatar">{initial}</div>
                  <div className="del-who">
                    <strong>{name}</strong>
                    <span>{item.email}</span>
                  </div>
                  <div className="del-meta">
                    <span className="del-chip">{item.source === "app" ? "From app" : "From website"}</span>
                    <span className={`del-badge ${item.status}`}>
                      {item.status === "rejected" ? "declined" : item.status}
                    </span>
                  </div>
                </header>

                <p className="del-when">Requested {when(item.createdAt)}</p>

                {pending && item.accountExists && (
                  <div className="del-stats">
                    <div>
                      <span>Savings balance</span>
                      <strong>{money(item.user?.savingsBalance)}</strong>
                    </div>
                    <div className="highlight">
                      <span>Still owed to member</span>
                      <strong>{money(item.savingsOwed)}</strong>
                    </div>
                    <div>
                      <span>Full withdrawal</span>
                      <strong className={granted ? "on" : ""}>
                        {granted ? `Open until ${when(item.fullWithdrawal.expiresAt)}` : "Not allowed"}
                      </strong>
                    </div>
                  </div>
                )}

                {pending && !item.accountExists && (
                  <p className="del-note">No account matches this email.</p>
                )}

                <div className="del-section">
                  <span className="del-label">Reason given</span>
                  <p>{item.reason || "No reason given."}</p>
                </div>

                {blockers.length > 0 && (
                  <div className="del-section">
                    <span className="del-label">Still blocking deletion</span>
                    <ul className="del-blockers">
                      {blockers.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {item.adminNote && (
                  <div className="del-section">
                    <span className="del-label">Office note</span>
                    <p>{item.adminNote}</p>
                  </div>
                )}

                {item.handledBy?.fullName && (
                  <p className="del-when">
                    Handled by {item.handledBy.fullName}, {when(item.handledAt)}
                  </p>
                )}

                {pending &&
                  (rejectingId === item._id ? (
                    <div className="del-reject">
                      <label htmlFor={`note-${item._id}`}>Reason shown to the member</label>
                      <textarea
                        id={`note-${item._id}`}
                        rows={3}
                        placeholder="Explain why the request cannot go ahead"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        maxLength={500}
                      />
                      <div className="del-actions">
                        <button
                          type="button"
                          className="del-btn danger"
                          disabled={busy || note.trim().length < 3}
                          onClick={() => reject(item)}
                        >
                          Decline request
                        </button>
                        <button
                          type="button"
                          className="del-btn ghost"
                          onClick={() => {
                            setRejectingId("");
                            setNote("");
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="del-actions">
                      {item.accountExists && Number(item.savingsOwed) > 0 && (
                        <button
                          type="button"
                          className={`del-btn ${granted ? "ghost" : "primary"}`}
                          disabled={busy}
                          onClick={() => setAccess(item, granted ? "revoke" : "grant")}
                        >
                          {granted ? "Stop full withdrawal" : "Allow full withdrawal"}
                        </button>
                      )}
                      <button
                        type="button"
                        className="del-btn outline"
                        disabled={busy || !canDelete}
                        title={canDelete ? "" : "Settle the items listed above first"}
                        onClick={() => complete(item)}
                      >
                        {item.accountExists ? "Delete account" : "Close request"}
                      </button>
                      <button
                        type="button"
                        className="del-btn danger-outline"
                        disabled={busy}
                        onClick={() => {
                          setRejectingId(item._id);
                          setNote("");
                        }}
                      >
                        Decline
                      </button>
                    </div>
                  ))}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

export default DeletionRequestsPanel;
