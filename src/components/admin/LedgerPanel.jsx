import { useCallback, useEffect, useState } from "react";
import request from "../../utils/api";
import { naira, when } from "./adminFormat";

const PAGE_SIZE = 25;

function LedgerPanel({ token }) {
  const [trial, setTrial] = useState(null);
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [tb, list] = await Promise.all([
        request("/admin/ledger/trial-balance", { token }),
        request(`/admin/ledger/entries?page=${page}&limit=${PAGE_SIZE}`, { token }),
      ]);
      setTrial(tb);
      setEntries(list.entries || []);
      setTotal(list.total || 0);
    } catch (err) {
      setError(err.message || "Could not load the ledger.");
    } finally {
      setLoading(false);
    }
  }, [token, page]);

  useEffect(() => {
    load();
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="eyebrow">Finance</p>
          <h1>Ledger &amp; Trial Balance</h1>
          <p className="admin-subtitle">
            Every money movement is recorded as a balanced double-entry. Entries
            cannot be edited or deleted.
          </p>
        </div>
        <button type="button" className="admin-refresh-btn" onClick={load}>
          Refresh
        </button>
      </div>

      {error && <p className="form-error admin-error">{error}</p>}

      {trial && (
        <div className="admin-stat-grid">
          <div className="admin-stat-card">
            <div>
              <span>Total debits</span>
              <strong>{naira(trial.totalDebit)}</strong>
            </div>
          </div>
          <div className="admin-stat-card">
            <div>
              <span>Total credits</span>
              <strong>{naira(trial.totalCredit)}</strong>
            </div>
          </div>
          <div className="admin-stat-card">
            <div>
              <span>Books</span>
              <strong>{trial.balanced ? "Balanced" : "OUT OF BALANCE"}</strong>
            </div>
          </div>
        </div>
      )}

      <section className="admin-card">
        <div className="admin-card-header">
          <h3>Trial balance</h3>
        </div>
        {!trial || trial.accounts.length === 0 ? (
          <p className="empty-state">
            {loading
              ? "Loading…"
              : "The ledger is empty. Set LEDGER_ENABLED=true on the server and run the backfill to start recording."}
          </p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Account</th>
                  <th>Type</th>
                  <th>Debit</th>
                  <th>Credit</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {trial.accounts.map((a) => (
                  <tr key={a.code}>
                    <td>{a.code}</td>
                    <td>{a.name}</td>
                    <td>{a.type}</td>
                    <td>{naira(a.debit)}</td>
                    <td>{naira(a.credit)}</td>
                    <td>{naira(a.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-card">
        <div className="admin-card-header">
          <h3>Journal entries ({total.toLocaleString()})</h3>
        </div>
        {entries.length === 0 ? (
          <p className="empty-state">{loading ? "Loading…" : "No entries yet."}</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Posted</th>
                  <th>Description</th>
                  <th>Reference</th>
                  <th>Lines</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e._id}>
                    <td>{when(e.postedAt)}</td>
                    <td>{e.description}</td>
                    <td>{e.reference}</td>
                    <td>
                      {e.lines.map((l, i) => (
                        <div key={i}>
                          {l.debit > 0 ? "Dr" : "Cr"} {l.account}{" "}
                          {naira(l.debit > 0 ? l.debit : l.credit)}
                        </div>
                      ))}
                    </td>
                    <td>{naira(e.total)}</td>
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

export default LedgerPanel;
