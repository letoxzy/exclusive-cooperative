import { useCallback, useEffect, useState } from "react";
import request from "../../utils/api";
import { when } from "./adminFormat";

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
            Members asking to close their account. Confirm who they are before
            deleting. An account with savings or a loan cannot be deleted until
            it is settled. To pay out savings, press "Allow full withdrawal":
            the member can then withdraw everything from the app or website, and
            once the balance is zero you can delete the account.
          </p>
        </div>
        <button type="button" className="admin-refresh-btn" onClick={load}>
          Refresh
        </button>
      </div>

      {error && <p className="form-error admin-error">{error}</p>}

      <section className="admin-card">
        <div className="admin-card-header">
          <h3>Requests ({requests.length})</h3>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="pending">Waiting</option>
            <option value="completed">Completed</option>
            <option value="rejected">Declined</option>
            <option value="">All</option>
          </select>
        </div>

        {requests.length === 0 ? (
          <p className="empty-state">
            {loading ? "Loading…" : "No deletion requests."}
          </p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Requested</th>
                  <th>Who</th>
                  <th>From</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((item) => (
                  <tr key={item._id}>
                    <td>{when(item.createdAt)}</td>
                    <td>
                      <strong>{item.user?.fullName || item.fullName || "—"}</strong>
                      <br />
                      {item.email}
                      {item.status === "pending" && !item.accountExists && (
                        <>
                          <br />
                          <em>No matching account</em>
                        </>
                      )}
                      {item.user && (
                        <>
                          <br />
                          Savings: {money(item.user.savingsBalance)}
                        </>
                      )}
                      {item.status === "pending" && item.accountExists && (
                        <>
                          <br />
                          Still owed to member: <strong>{money(item.savingsOwed)}</strong>
                          {item.fullWithdrawal?.active && (
                            <>
                              <br />
                              <em>Full withdrawal open until {when(item.fullWithdrawal.expiresAt)}</em>
                            </>
                          )}
                        </>
                      )}
                    </td>
                    <td>{item.source === "app" ? "App" : "Website"}</td>
                    <td>
                      {item.reason || "—"}
                      {item.status === "pending" && item.currentBlockers?.length > 0 && (
                        <>
                          <br />
                          <em>Still blocking: {item.currentBlockers.join("; ")}</em>
                        </>
                      )}
                      {item.adminNote && (
                        <>
                          <br />
                          <em>Note: {item.adminNote}</em>
                        </>
                      )}
                    </td>
                    <td>
                      <span className={`status-badge ${item.status}`}>
                        {item.status === "rejected" ? "declined" : item.status}
                      </span>
                      {item.handledBy?.fullName && (
                        <>
                          <br />
                          <small>
                            {item.handledBy.fullName}, {when(item.handledAt)}
                          </small>
                        </>
                      )}
                    </td>
                    <td>
                      {item.status === "pending" &&
                        (rejectingId === item._id ? (
                          <div>
                            <textarea
                              rows={2}
                              placeholder="Reason shown to the member"
                              value={note}
                              onChange={(e) => setNote(e.target.value)}
                              maxLength={500}
                            />
                            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                              <button
                                type="button"
                                className="admin-refresh-btn"
                                disabled={busyId === item._id || note.trim().length < 3}
                                onClick={() => reject(item)}
                              >
                                Decline
                              </button>
                              <button
                                type="button"
                                className="admin-refresh-btn"
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
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {item.accountExists && Number(item.savingsOwed) > 0 && (
                              <button
                                type="button"
                                className="admin-refresh-btn"
                                disabled={busyId === item._id}
                                onClick={() =>
                                  setAccess(item, item.fullWithdrawal?.active ? "revoke" : "grant")
                                }
                              >
                                {item.fullWithdrawal?.active
                                  ? "Stop full withdrawal"
                                  : "Allow full withdrawal"}
                              </button>
                            )}
                            <button
                              type="button"
                              className="admin-refresh-btn"
                              disabled={
                                busyId === item._id ||
                                (item.accountExists && item.currentBlockers?.length > 0)
                              }
                              title={
                                item.currentBlockers?.length > 0
                                  ? "Settle the items listed first"
                                  : ""
                              }
                              onClick={() => complete(item)}
                            >
                              {item.accountExists ? "Delete account" : "Close request"}
                            </button>
                            <button
                              type="button"
                              className="admin-refresh-btn"
                              disabled={busyId === item._id}
                              onClick={() => {
                                setRejectingId(item._id);
                                setNote("");
                              }}
                            >
                              Decline
                            </button>
                          </div>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export default DeletionRequestsPanel;
