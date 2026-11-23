import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import request from "../../utils/api";
import { useAuth } from "../../context/AuthContext";
import { hasPermission } from "../../utils/adminAccess";
import "../../styles/admin-manual-savings.css";

/* ================================
   HELPERS
================================= */

const naira = (value) =>
  `₦${Number(value || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;

const todayKey = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const prettyDate = (key) => {
  const [y, m, d] = String(key || "").split("-").map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : key || "";
};

const sameMonth = (key) => String(key).slice(0, 7) === todayKey().slice(0, 7);

const MAX_ROWS = 300;

// Splits one CSV line, keeping commas that sit inside quotes ("50,000").
function splitCsvLine(line, delimiter) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Turns rows copied from Excel (tab separated) or a CSV file into
 * { identifier, amount, date, reference, note } rows.
 * Column order: Email or phone | Amount | Date | Reference | Note
 */
function parseRows(text) {
  const lines = String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => line.trim() !== "");
  if (lines.length === 0) return [];

  const delimiter = lines.some((line) => line.includes("\t")) ? "\t" : ",";
  let rows = lines.map((line) => splitCsvLine(line, delimiter));

  // Skip a heading row such as "Email, Amount, Date".
  const first = rows[0].join(" ").toLowerCase();
  if (/(email|phone|member|name|amount|date)/.test(first) && !/\d{3,}/.test(rows[0][1] || "")) {
    rows = rows.slice(1);
  }

  return rows.map(([identifier, amount, date, reference, note]) => ({
    identifier: identifier || "",
    amount: amount || "",
    date: date || "",
    reference: reference || "",
    note: note || "",
  }));
}

const TEMPLATE_CSV =
  "Email or phone,Amount,Date paid,Reference (optional),Note (optional)\n" +
  "member@example.com,50000,05/11/2026,RCT-001,Paid in cash\n" +
  "08031234567,20000,12/10/2026,,\n";

/* ================================
   RECORD ONE
================================= */

function RecordOne({ token, onDone }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [member, setMember] = useState(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayKey());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    if (member || query.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const data = await request(
          `/admin/manual-contributions/members?q=${encodeURIComponent(query.trim())}`,
          { token },
        );
        setResults(Array.isArray(data?.members) ? data.members : []);
      } catch {
        setResults([]);
      }
    }, 300);
    return () => clearTimeout(timer.current);
  }, [query, member, token]);

  const amountNumber = Number(String(amount).replace(/,/g, ""));
  const validAmount = Number.isFinite(amountNumber) && amountNumber > 0;
  const withdrawable = validAmount && date && sameMonth(date) ? amountNumber * 0.4 : 0;

  const submit = async (event) => {
    event.preventDefault();
    setMessage(null);
    if (!member) return setMessage({ type: "error", text: "Choose a member first." });
    if (!validAmount) return setMessage({ type: "error", text: "Enter a valid amount." });
    if (!date) return setMessage({ type: "error", text: "Choose the date it was paid." });

    const ok = window.confirm(
      `Record ${naira(amountNumber)} for ${member.fullName}?\n\nDate paid: ${prettyDate(date)}\n` +
        `It will be added to their savings balance now.` +
        (notify ? "\nThe member will be notified." : ""),
    );
    if (!ok) return;

    setBusy(true);
    try {
      const data = await request("/admin/manual-contributions", {
        method: "POST",
        token,
        body: { memberId: member._id, amount: amountNumber, date, reference, note, notify },
      });
      setMessage({
        type: "ok",
        text: `${data.message} Their savings balance is now ${naira(data.savingsBalance)}.${
          data.withdrawableThisMonth ? " It counts toward this month's withdrawal." : ""
        }`,
      });
      setMember(null);
      setQuery("");
      setAmount("");
      setReference("");
      setNote("");
      onDone();
    } catch (err) {
      setMessage({ type: "error", text: err.message || "Could not record this contribution." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="admin-card ms-card">
      <div className="admin-card-header">
        <div>
          <p className="eyebrow">One member</p>
          <h2>Record a Contribution</h2>
        </div>
      </div>

      <form onSubmit={submit} className="ms-form">
        <div className="ms-field ms-wide">
          <label htmlFor="ms-member">Member</label>
          {member ? (
            <div className="ms-chosen">
              <div>
                <strong>{member.fullName}</strong>
                <span>
                  {member.email}
                  {member.phone ? ` · ${member.phone}` : ""} · Balance {naira(member.savingsBalance)}
                </span>
                {!member.isApprovedMember && (
                  <span className="ms-warn-text">
                    Not an approved member yet. The balance shows once they are approved.
                  </span>
                )}
              </div>
              <button type="button" className="ms-link" onClick={() => setMember(null)}>
                Change
              </button>
            </div>
          ) : (
            <>
              <input
                id="ms-member"
                type="text"
                autoComplete="off"
                placeholder="Search by name, email or phone"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {results.length > 0 && (
                <ul className="ms-results">
                  {results.map((m) => (
                    <li key={m._id}>
                      <button type="button" onClick={() => setMember(m)}>
                        <strong>{m.fullName}</strong>
                        <span>
                          {m.email}
                          {m.phone ? ` · ${m.phone}` : ""} · {naira(m.savingsBalance)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="ms-field">
          <label htmlFor="ms-amount">Amount (₦)</label>
          <input
            id="ms-amount"
            type="text"
            inputMode="decimal"
            placeholder="50,000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <div className="ms-field">
          <label htmlFor="ms-date">Date paid</label>
          <input
            id="ms-date"
            type="date"
            max={todayKey()}
            min="2015-01-01"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        <div className="ms-field">
          <label htmlFor="ms-ref">Receipt / register no. (optional)</label>
          <input
            id="ms-ref"
            type="text"
            maxLength={60}
            placeholder="e.g. RCT-014"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>

        <div className="ms-field">
          <label htmlFor="ms-note">Note (optional)</label>
          <input
            id="ms-note"
            type="text"
            maxLength={200}
            placeholder="e.g. Paid in cash at the office"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {validAmount && date ? (
          <p className={`ms-hint ${withdrawable ? "good" : ""}`}>
            {withdrawable
              ? `Dated this month, so ${naira(withdrawable)} (40%) of it can be withdrawn this month.`
              : "Dated before this month, so it adds to the savings balance but not to this month's withdrawal."}
          </p>
        ) : null}

        <label className="ms-check ms-wide">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Notify the member in the app (no SMS is sent)
        </label>

        {message ? <div className={`ms-alert ${message.type}`}>{message.text}</div> : null}

        <div className="ms-wide">
          <button type="submit" className="ms-primary" disabled={busy}>
            {busy ? "Recording..." : "Record contribution"}
          </button>
        </div>
      </form>
    </section>
  );
}

/* ================================
   IMPORT FROM EXCEL
================================= */

const STATUS_LABEL = {
  ok: "Ready",
  saved: "Saved",
  duplicate: "Already recorded",
  error: "Problem",
  failed: "Failed",
};

function ImportFromExcel({ token, onDone }) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const rows = useMemo(() => parseRows(text), [text]);

  const reset = () => {
    setPreview(null);
    setOutcome(null);
    setError("");
  };

  const onFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result || ""));
      reset();
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "manual-contributions-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const checkRows = async () => {
    reset();
    if (rows.length === 0) return setError("Paste some rows first.");
    if (rows.length > MAX_ROWS) {
      return setError(
        `You have ${rows.length} rows. Please do ${MAX_ROWS} or fewer at a time and repeat for the rest.`,
      );
    }
    setBusy("check");
    try {
      setPreview(await request("/admin/manual-contributions/import/preview", { method: "POST", token, body: { rows } }));
    } catch (err) {
      setError(err.message || "Could not check these rows.");
    } finally {
      setBusy("");
    }
  };

  const runImport = async () => {
    if (!preview?.summary?.ok) return;
    const s = preview.summary;
    const ok = window.confirm(
      `Import ${s.ok} contribution${s.ok === 1 ? "" : "s"} for ${s.members} member${s.members === 1 ? "" : "s"}, ` +
        `${naira(s.totalAmount)} in total?\n\nTheir savings balances will go up now.` +
        (s.duplicates || s.errors ? `\n\n${s.duplicates + s.errors} row(s) will be skipped.` : "") +
        (notify ? "\nMembers will be notified." : ""),
    );
    if (!ok) return;

    setBusy("import");
    setError("");
    try {
      const data = await request("/admin/manual-contributions/import", { method: "POST", token, body: { rows, notify } });
      setOutcome(data);
      setPreview(null);
      setText("");
      setFileName("");
      onDone();
    } catch (err) {
      setError(err.message || "Could not import these rows.");
    } finally {
      setBusy("");
    }
  };

  const shown = outcome || preview;

  return (
    <section className="admin-card ms-card">
      <div className="admin-card-header">
        <div>
          <p className="eyebrow">Many members</p>
          <h2>Import from Excel</h2>
        </div>
      </div>

      <p className="ms-help">
        Copy the rows from your Excel sheet and paste them below, or upload a CSV file. Columns in
        this order: <strong>Email or phone</strong>, <strong>Amount</strong>, <strong>Date paid</strong>,{" "}
        <strong>Receipt no.</strong> (optional), <strong>Note</strong> (optional). Dates like 05/11/2026
        mean 5 November. Nothing is saved until you press Import, and the same row is never recorded twice.
      </p>

      <div className="ms-import-actions">
        <label className="ms-secondary">
          Upload CSV file
          <input type="file" accept=".csv,text/csv,text/plain" onChange={onFile} hidden />
        </label>
        <button type="button" className="ms-secondary" onClick={downloadTemplate}>
          Download template
        </button>
        {fileName ? <span className="ms-file">{fileName}</span> : null}
      </div>

      <textarea
        className="ms-textarea"
        rows={7}
        placeholder={"member@example.com\t50000\t05/11/2026\tRCT-001\tPaid in cash\n08031234567\t20000\t12/10/2026"}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          reset();
        }}
      />

      <div className="ms-import-row">
        <span className="ms-count">{rows.length} row{rows.length === 1 ? "" : "s"} found</span>
        <button type="button" className="ms-primary" onClick={checkRows} disabled={busy !== "" || rows.length === 0}>
          {busy === "check" ? "Checking..." : "Check rows"}
        </button>
      </div>

      {error ? <div className="ms-alert error">{error}</div> : null}

      {shown ? (
        <>
          <div className={`ms-summary ${outcome ? "done" : ""}`}>
            {outcome ? <strong>Import finished.</strong> : <strong>Check complete. Nothing is saved yet.</strong>}
            <span>
              {outcome ? "Saved" : "Ready"}: <b>{shown.summary.ok}</b> · Already recorded:{" "}
              <b>{shown.summary.duplicates}</b> · Problems: <b>{shown.summary.errors}</b> · Total:{" "}
              <b>{naira(shown.summary.totalAmount)}</b> for <b>{shown.summary.members}</b> member
              {shown.summary.members === 1 ? "" : "s"}
            </span>
            {shown.summary.withdrawableThisMonth > 0 ? (
              <span>
                Dated this month: {naira(shown.summary.withdrawableThisMonth)} (up to{" "}
                {naira(shown.summary.withdrawableThisMonth * 0.4)} can be withdrawn this month).
              </span>
            ) : null}
          </div>

          <div className="ms-table-wrap">
            <table className="ms-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Member</th>
                  <th>Amount</th>
                  <th>Date paid</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {shown.rows.map((r) => (
                  <tr key={r.row} className={`row-${r.status}`}>
                    <td>{r.row}</td>
                    <td>
                      {r.memberName || r.identifier || "-"}
                      {r.approvedMember === false ? <small className="ms-warn-text">Not approved yet</small> : null}
                    </td>
                    <td>{r.amount != null ? naira(r.amount) : "-"}</td>
                    <td>{r.date ? prettyDate(r.date) : "-"}</td>
                    <td>
                      <span className={`ms-badge ${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span>
                      {r.message ? <small>{r.message}</small> : null}
                      {r.status === "saved" && r.savingsBalance != null ? (
                        <small>New balance {naira(r.savingsBalance)}</small>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preview && !outcome ? (
            <div className="ms-import-confirm">
              <label className="ms-check">
                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                Notify members in the app (one message per member, no SMS)
              </label>
              <button
                type="button"
                className="ms-primary"
                onClick={runImport}
                disabled={busy !== "" || preview.summary.ok === 0}
              >
                {busy === "import" ? "Importing..." : `Import ${preview.summary.ok} contribution${preview.summary.ok === 1 ? "" : "s"}`}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/* ================================
   RECORDED LIST
================================= */

function RecordedList({ token, canReverse, refreshKey }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState(null);

  const load = useCallback(
    async (before) => {
      setLoading(true);
      try {
        const data = await request(
          `/admin/manual-contributions?limit=50${before ? `&before=${before}` : ""}`,
          { token },
        );
        const list = Array.isArray(data?.entries) ? data.entries : [];
        setEntries((current) => (before ? [...current, ...list] : list));
        setMore(list.length === 50);
      } catch (err) {
        setMessage({ type: "error", text: err.message || "Could not load the list." });
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const reverse = async (entry) => {
    const reason = window.prompt(
      `Reverse ${naira(entry.amount)} for ${entry.member?.fullName}?\n\nThis takes the amount back out of their savings balance. Why is it being reversed?`,
    );
    if (reason === null) return;
    if (reason.trim().length < 5) {
      setMessage({ type: "error", text: "Please give a reason of at least 5 characters." });
      return;
    }

    setBusyId(entry._id);
    setMessage(null);
    try {
      const data = await request(`/admin/manual-contributions/${entry._id}/reverse`, {
        method: "POST",
        token,
        body: { reason: reason.trim() },
      });
      setMessage({ type: "ok", text: `${data.message} New balance ${naira(data.savingsBalance)}.` });
      load();
    } catch (err) {
      setMessage({ type: "error", text: err.message || "Could not reverse this entry." });
    } finally {
      setBusyId("");
    }
  };

  return (
    <section className="admin-card ms-card">
      <div className="admin-card-header">
        <div>
          <p className="eyebrow">History</p>
          <h2>Recorded Contributions</h2>
        </div>
      </div>

      {message ? <div className={`ms-alert ${message.type}`}>{message.text}</div> : null}

      {entries.length === 0 && !loading ? (
        <p className="ms-empty">Nothing has been recorded by hand yet.</p>
      ) : (
        <div className="ms-table-wrap">
          <table className="ms-table">
            <thead>
              <tr>
                <th>Date paid</th>
                <th>Member</th>
                <th>Amount</th>
                <th>Note</th>
                <th>Recorded by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e._id} className={e.reversed ? "row-reversed" : ""}>
                  <td>{prettyDate(e.date)}</td>
                  <td>
                    {e.member?.fullName || "-"}
                    <small>{e.member?.email}</small>
                  </td>
                  <td>
                    {naira(e.amount)}
                    {e.withdrawableThisMonth ? <small>Counts for this month's withdrawal</small> : null}
                  </td>
                  <td>{e.note.replace("Manual contribution recorded by the office: ", "").replace("Manual contribution recorded by the office", "") || "-"}</td>
                  <td>
                    {e.recordedBy || "-"}
                    <small>{new Date(e.recordedAt).toLocaleString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" })}</small>
                  </td>
                  <td>
                    {e.reversed ? (
                      <span className="ms-badge failed" title={e.reversalReason}>Reversed</span>
                    ) : canReverse ? (
                      <button type="button" className="ms-link danger" disabled={busyId === e._id} onClick={() => reverse(e)}>
                        {busyId === e._id ? "..." : "Reverse"}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loading ? <p className="ms-empty">Loading...</p> : null}
      {more && !loading ? (
        <button type="button" className="ms-secondary" onClick={() => load(entries[entries.length - 1]?._id)}>
          Load more
        </button>
      ) : null}
    </section>
  );
}

/* ================================
   PAGE
================================= */

function ManualContributionsPanel({ token }) {
  const { user } = useAuth();
  const canRecord = hasPermission(user, "manualsavings.record");
  const canReverse = hasPermission(user, "manualsavings.reverse");
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((n) => n + 1);

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="eyebrow">Manual contributions</p>
          <h1>Manual Contributions</h1>
          <p className="admin-subtitle">
            Record contributions members paid by hand before online payments went live, so their
            balances show in their accounts.
          </p>
        </div>
      </div>

      <div className="ms-info">
        <strong>How it works</strong>
        <ul>
          <li>Each contribution is recorded on the date it was really paid and added to the member's savings balance.</li>
          <li>It appears in the member's transaction history like any other contribution.</li>
          <li>
            Withdrawals follow the normal rule: <b>40% of the contributions dated this month</b> can be
            withdrawn, once a month. Earlier months add to the balance (the locked 60% and older
            savings) only.
          </li>
          <li>A row that was already recorded is skipped, so uploading a file twice never credits anyone twice.</li>
        </ul>
      </div>

      {canRecord ? (
        <>
          <RecordOne token={token} onDone={refresh} />
          <ImportFromExcel token={token} onDone={refresh} />
        </>
      ) : (
        <div className="ms-alert warn">You can view recorded contributions but not add new ones.</div>
      )}

      <RecordedList token={token} canReverse={canReverse} refreshKey={refreshKey} />
    </>
  );
}

export default ManualContributionsPanel;
