import { useCallback, useEffect, useState } from "react";
import request from "../../utils/api";
import { when } from "./adminFormat";

const PAGE_SIZE = 25;

function AuditLogPanel({ token }) {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams({ page, limit: PAGE_SIZE });
      if (action.trim()) q.set("action", action.trim());
      const data = await request(`/admin/audit-logs?${q}`, { token });
      setLogs(data.logs || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message || "Could not load the audit log.");
    } finally {
      setLoading(false);
    }
  }, [token, page, action]);

  useEffect(() => {
    load();
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="eyebrow">Control</p>
          <h1>Audit Log</h1>
          <p className="admin-subtitle">
            Who did what, and when. Records cannot be edited or deleted.
          </p>
        </div>
        <button type="button" className="admin-refresh-btn" onClick={load}>
          Refresh
        </button>
      </div>

      {error && <p className="form-error admin-error">{error}</p>}

      <section className="admin-card">
        <div className="admin-card-header">
          <h3>Activity ({total.toLocaleString()})</h3>
          <select
            value={action}
            onChange={(e) => {
              setPage(1);
              setAction(e.target.value);
            }}
          >
            <option value="">All actions</option>
            <option value="savings.approve">Savings approved</option>
            <option value="loan.disburse">Loan disbursed</option>
            <option value="loan-repayment.approve">Repayment approved</option>
            <option value="dividend.calculate">Dividend calculated</option>
            <option value="dividend.approve">Dividend approved</option>
            <option value="dividend.pay-entry">Dividend paid (one)</option>
            <option value="dividend.pay-all">Dividend paid (all)</option>
            <option value="reconciliation.credit">Reconciliation credit</option>
            <option value="member.shareholding">Shareholding changed</option>
            <option value="member.delete">Member deleted</option>
          </select>
        </div>

        {logs.length === 0 ? (
          <p className="empty-state">{loading ? "Loading…" : "No activity recorded yet."}</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Administrator</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l._id}>
                    <td>{when(l.createdAt)}</td>
                    <td>{l.actorEmail || "—"}</td>
                    <td>{l.action}</td>
                    <td>
                      {l.targetType} {l.targetId}
                    </td>
                    <td>{JSON.stringify(l.details || {})}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="admin-card-header">
            <button
              type="button"
              className="admin-refresh-btn"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span>
              Page {page} of {pages}
            </span>
            <button
              type="button"
              className="admin-refresh-btn"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        )}
      </section>
    </>
  );
}

export default AuditLogPanel;
