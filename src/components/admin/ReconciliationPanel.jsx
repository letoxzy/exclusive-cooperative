import { useState } from "react";
import request from "../../utils/api";
import { naira, when } from "./adminFormat";

const toInput = (d) => d.toISOString().slice(0, 10);

function ReconciliationPanel({ token }) {
  const today = new Date();
  const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [from, setFrom] = useState(toInput(monthAgo));
  const [to, setTo] = useState(toInput(today));
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [crediting, setCrediting] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const run = async () => {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      // End of the chosen day so "today" includes today's payments.
      const toDate = new Date(`${to}T23:59:59`);
      const q = new URLSearchParams({
        from: new Date(`${from}T00:00:00`).toISOString(),
        to: toDate.toISOString(),
      });
      setResult(await request(`/admin/reconciliation/paystack?${q}`, { token }));
    } catch (err) {
      setError(err.message || "Could not reconcile.");
    } finally {
      setLoading(false);
    }
  };

  const credit = async (reference) => {
    const ok = window.confirm(
      `Re-check payment ${reference} with Paystack and credit it to the member?`
    );
    if (!ok) return;
    setCrediting(reference);
    setError("");
    try {
      const r = await request("/admin/reconciliation/paystack/credit", {
        method: "POST",
        token,
        body: { reference },
      });
      setNotice(
        r.status === "credited"
          ? `Credited ${naira(r.amount)} for ${reference}.`
          : `${reference} was already credited.`
      );
      await run();
    } catch (err) {
      setError(err.message || "Could not credit this payment.");
    } finally {
      setCrediting("");
    }
  };

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="eyebrow">Control</p>
          <h1>Paystack Reconciliation</h1>
          <p className="admin-subtitle">
            Compares what Paystack collected with what the system recorded, and
            flags anything that does not match.
          </p>
        </div>
      </div>

      <section className="admin-card">
        <div className="admin-card-header">
          <label>
            From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button type="button" className="admin-primary-btn" disabled={loading} onClick={run}>
            {loading ? "Checking…" : "Run reconciliation"}
          </button>
        </div>
        <p className="admin-subtitle">Up to 92 days at a time.</p>
      </section>

      {error && <p className="form-error admin-error">{error}</p>}
      {notice && <p className="admin-subtitle">{notice}</p>}

      {result && (
        <>
          {result.truncated && (
            <p className="form-error admin-error">
              Paystack returned more transactions than one run can check. Choose
              a shorter window to see everything.
            </p>
          )}

          <div className="admin-stat-grid">
            <div className="admin-stat-card">
              <div>
                <span>Paystack member payments</span>
                <strong>{naira(result.paystackMemberTotal)}</strong>
              </div>
            </div>
            <div className="admin-stat-card">
              <div>
                <span>Matched</span>
                <strong>{result.matched}</strong>
              </div>
            </div>
            <div className="admin-stat-card">
              <div>
                <span>Missing in system</span>
                <strong>{result.missingInSystem.length}</strong>
              </div>
            </div>
            <div className="admin-stat-card">
              <div>
                <span>Amount mismatches</span>
                <strong>{result.amountMismatch.length}</strong>
              </div>
            </div>
          </div>

          <section className="admin-card">
            <div className="admin-card-header">
              <h3>Paid on Paystack but not credited here</h3>
            </div>
            {result.missingInSystem.length === 0 ? (
              <p className="empty-state">Nothing missing.</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Paid</th>
                      <th>Email</th>
                      <th>Reference</th>
                      <th>Amount</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {result.missingInSystem.map((m) => (
                      <tr key={m.reference}>
                        <td>{when(m.paidAt)}</td>
                        <td>{m.email}</td>
                        <td>{m.reference}</td>
                        <td>{naira(m.amount)}</td>
                        <td>
                          <button
                            type="button"
                            className="admin-secondary-btn"
                            disabled={crediting === m.reference}
                            onClick={() => credit(m.reference)}
                          >
                            {crediting === m.reference ? "Crediting…" : "Verify & credit"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="admin-card">
            <div className="admin-card-header">
              <h3>Amount differs</h3>
            </div>
            {result.amountMismatch.length === 0 ? (
              <p className="empty-state">No differences.</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Paystack</th>
                      <th>Recorded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.amountMismatch.map((m) => (
                      <tr key={m.reference}>
                        <td>{m.reference}</td>
                        <td>{naira(m.paystackAmount)}</td>
                        <td>{naira(m.recordedAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="admin-card">
            <div className="admin-card-header">
              <h3>Recorded here but not found on Paystack (check manually)</h3>
            </div>
            {result.notInPaystack.length === 0 ? (
              <p className="empty-state">None.</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Recorded</th>
                      <th>Reference</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.notInPaystack.map((m) => (
                      <tr key={m.reference}>
                        <td>{when(m.recordedAt)}</td>
                        <td>{m.reference}</td>
                        <td>{naira(m.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

export default ReconciliationPanel;
