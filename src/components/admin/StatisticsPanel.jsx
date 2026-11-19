import { useState, useEffect, useMemo, useCallback } from "react";
import request from "../../utils/api";
import { useAuth } from "../../context/AuthContext";
import { hasPermission } from "../../utils/adminAccess";
import "../../styles/admin-statistics.css";

/* ================================
   HELPERS
================================= */

const PALETTE = [
  "#075c3b", // brand green
  "#c9a227", // brand gold
  "#2f6fed", // blue
  "#d6455d", // red
  "#7a4fd1", // purple
  "#1aa6a6", // teal
  "#e8833a", // orange
  "#8a94a6", // grey
];

const naira = (value) => `₦${Math.round(Number(value) || 0).toLocaleString()}`;

const compactNaira = (value) => {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  if (abs >= 1e9) return `₦${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `₦${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `₦${(n / 1e3).toFixed(0)}K`;
  return `₦${Math.round(n)}`;
};

const num = (value) => Number(value) || 0;
const sum = (rows, pick) => rows.reduce((total, row) => total + num(pick(row)), 0);
const pct = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);

const label = (value, fallback = "Not set") =>
  String(value || fallback)
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

const monthKey = (date) => {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// The last `count` months, oldest first, as { key, name }.
const lastMonths = (count) => {
  const now = new Date();
  const months = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      name: d.toLocaleString("en-GB", { month: "short" }),
      full: d.toLocaleString("en-GB", { month: "long", year: "numeric" }),
    });
  }
  return months;
};

// Count rows into pie slices: [{ name, value }]
const countBy = (rows, pick, nameOf = label) => {
  const map = new Map();
  rows.forEach((row) => {
    const key = pick(row) ?? "";
    map.set(key, (map.get(key) || 0) + 1);
  });
  return [...map.entries()].map(([key, value]) => ({ name: nameOf(key), value }));
};

// Sum an amount into pie slices.
const sumBy = (rows, pick, amountOf, nameOf = label) => {
  const map = new Map();
  rows.forEach((row) => {
    const key = pick(row) ?? "";
    map.set(key, (map.get(key) || 0) + num(amountOf(row)));
  });
  return [...map.entries()].map(([key, value]) => ({ name: nameOf(key), value }));
};

// Add the monthly total of `rows` (by `dateOf`, adding `amountOf`) to the month list.
const monthlyTotals = (months, rows, dateOf, amountOf) => {
  const totals = Object.fromEntries(months.map((m) => [m.key, 0]));
  rows.forEach((row) => {
    const key = monthKey(dateOf(row));
    if (key in totals) totals[key] += amountOf ? num(amountOf(row)) : 1;
  });
  return months.map((m) => totals[m.key]);
};

/* ================================
   CHARTS (plain SVG, no extra packages)
================================= */

function EmptyChart({ text = "No data yet" }) {
  return <div className="stats-empty">{text}</div>;
}

function Legend({ items, format }) {
  return (
    <ul className="stats-legend">
      {items.map((item) => (
        <li key={item.name}>
          <span className="stats-dot" style={{ background: item.color }} />
          <span className="stats-legend-name">{item.name}</span>
          <strong>{format(item.value)}</strong>
        </li>
      ))}
    </ul>
  );
}

function DonutChart({ data, money = false, centerLabel = "Total" }) {
  const slices = data.filter((d) => d.value > 0);
  const total = sum(slices, (d) => d.value);
  const format = (v) => (money ? compactNaira(v) : v.toLocaleString());
  const [hover, setHover] = useState(null);

  if (!total) return <EmptyChart />;

  const colored = slices.map((d, i) => ({ ...d, color: PALETTE[i % PALETTE.length] }));
  const R = 70;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const active = hover !== null ? colored[hover] : null;

  return (
    <div className="stats-donut-wrap">
      <svg viewBox="0 0 200 200" className="stats-donut" role="img">
        <g transform="rotate(-90 100 100)">
          {colored.length === 1 ? (
            <circle cx="100" cy="100" r={R} fill="none" stroke={colored[0].color} strokeWidth="30" />
          ) : (
            colored.map((slice, i) => {
              const length = (slice.value / total) * C;
              const circle = (
                <circle
                  key={slice.name}
                  cx="100"
                  cy="100"
                  r={R}
                  fill="none"
                  stroke={slice.color}
                  strokeWidth={hover === i ? 36 : 30}
                  strokeDasharray={`${length} ${C - length}`}
                  strokeDashoffset={-offset}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  style={{ transition: "stroke-width .15s" }}
                >
                  <title>{`${slice.name}: ${format(slice.value)} (${pct(slice.value, total).toFixed(1)}%)`}</title>
                </circle>
              );
              offset += length;
              return circle;
            })
          )}
        </g>
        <text x="100" y="94" textAnchor="middle" className="stats-donut-top">
          {active ? active.name : centerLabel}
        </text>
        <text x="100" y="116" textAnchor="middle" className="stats-donut-value">
          {format(active ? active.value : total)}
        </text>
      </svg>
      <Legend
        items={colored}
        format={(v) => `${format(v)} · ${pct(v, total).toFixed(0)}%`}
      />
    </div>
  );
}

const niceMax = (max) => {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const n = max / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
};

// Vertical grouped bars. series: [{ name, color, values[] }], labels: string[]
function BarChart({ labels, series, money = false }) {
  const all = series.flatMap((s) => s.values);
  if (!all.some((v) => v > 0)) return <EmptyChart />;

  const W = 560;
  const H = 240;
  const pad = { top: 14, right: 12, bottom: 28, left: money ? 56 : 40 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const max = niceMax(Math.max(...all));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => max * t);
  const format = (v) => (money ? compactNaira(v) : Math.round(v).toLocaleString());

  const groupW = innerW / labels.length;
  const barW = Math.min(28, (groupW * 0.7) / series.length);

  return (
    <div className="stats-chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="stats-svg" role="img">
        {ticks.map((t) => {
          const y = pad.top + innerH - (t / max) * innerH;
          return (
            <g key={t}>
              <line x1={pad.left} x2={W - pad.right} y1={y} y2={y} className="stats-gridline" />
              <text x={pad.left - 6} y={y + 3} textAnchor="end" className="stats-axis">
                {format(t)}
              </text>
            </g>
          );
        })}
        {labels.map((name, i) => {
          const gx = pad.left + groupW * i + groupW / 2;
          return (
            <g key={`${name}-${i}`}>
              {series.map((s, si) => {
                const h = (s.values[i] / max) * innerH;
                const x = gx - (barW * series.length) / 2 + barW * si;
                return (
                  <rect
                    key={s.name}
                    x={x}
                    y={pad.top + innerH - h}
                    width={barW - 2}
                    height={Math.max(h, 0)}
                    rx="3"
                    fill={s.color}
                  >
                    <title>{`${s.name} · ${name}: ${money ? naira(s.values[i]) : s.values[i]}`}</title>
                  </rect>
                );
              })}
              <text x={gx} y={H - 8} textAnchor="middle" className="stats-axis">
                {name}
              </text>
            </g>
          );
        })}
      </svg>
      {series.length > 1 || series[0]?.name ? (
        <div className="stats-series-key">
          {series.map((s) => (
            <span key={s.name}>
              <i className="stats-dot" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Smooth-free line/area chart. Same inputs as BarChart.
function LineChart({ labels, series, money = false }) {
  const all = series.flatMap((s) => s.values);
  if (!all.some((v) => v > 0)) return <EmptyChart />;

  const W = 560;
  const H = 240;
  const pad = { top: 14, right: 14, bottom: 28, left: money ? 56 : 40 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const max = niceMax(Math.max(...all));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => max * t);
  const format = (v) => (money ? compactNaira(v) : Math.round(v).toLocaleString());
  const stepX = labels.length > 1 ? innerW / (labels.length - 1) : 0;
  const px = (i) => pad.left + (labels.length > 1 ? stepX * i : innerW / 2);
  const py = (v) => pad.top + innerH - (v / max) * innerH;

  return (
    <div className="stats-chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="stats-svg" role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={py(t)} y2={py(t)} className="stats-gridline" />
            <text x={pad.left - 6} y={py(t) + 3} textAnchor="end" className="stats-axis">
              {format(t)}
            </text>
          </g>
        ))}
        {series.map((s, si) => {
          const points = s.values.map((v, i) => `${px(i)},${py(v)}`).join(" ");
          const area = `${px(0)},${py(0)} ${points} ${px(s.values.length - 1)},${py(0)}`;
          return (
            <g key={s.name}>
              {si === 0 && <polygon points={area} fill={s.color} opacity="0.1" />}
              <polyline points={points} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" />
              {s.values.map((v, i) => (
                <circle key={i} cx={px(i)} cy={py(v)} r="3.5" fill="#fff" stroke={s.color} strokeWidth="2">
                  <title>{`${s.name} · ${labels[i]}: ${money ? naira(v) : v}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
        {labels.map((name, i) => (
          <text key={`${name}-${i}`} x={px(i)} y={H - 8} textAnchor="middle" className="stats-axis">
            {name}
          </text>
        ))}
      </svg>
      <div className="stats-series-key">
        {series.map((s) => (
          <span key={s.name}>
            <i className="stats-dot" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

// Horizontal ranking bars: items [{ name, value }]
function RankBars({ items, money = false }) {
  if (!items.length) return <EmptyChart />;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="stats-rank">
      {items.map((item, i) => (
        <li key={`${item.name}-${i}`}>
          <div className="stats-rank-row">
            <span className="stats-rank-name">
              <b>{i + 1}</b> {item.name}
            </span>
            <strong>{money ? naira(item.value) : item.value.toLocaleString()}</strong>
          </div>
          <div className="stats-rank-track">
            <div
              className="stats-rank-fill"
              style={{ width: `${(item.value / max) * 100}%`, background: PALETTE[i % PALETTE.length] }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ChartCard({ eyebrow, title, children, wide = false }) {
  return (
    <section className={`admin-card stats-card ${wide ? "stats-wide" : ""}`}>
      <div className="admin-card-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

function Kpi({ title, value, hint, tone }) {
  return (
    <div className={`admin-stat-card stats-kpi ${tone ? `tone-${tone}` : ""}`}>
      <div>
        <span>{title}</span>
        <strong>{value}</strong>
        {hint ? <small>{hint}</small> : null}
      </div>
    </div>
  );
}

/* ================================
   PANEL
================================= */

const SOURCES = [
  { key: "members", path: "/admin/users", perms: ["members.view"] },
  { key: "savings", path: "/admin/savings-requests", perms: ["savings.view", "savings.review"] },
  { key: "applications", path: "/admin/membership", perms: ["membership.review", "membership.view"] },
  { key: "loans", path: "/admin/loans", perms: ["loans.view"] },
  { key: "repayments", path: "/admin/loan-repayments", perms: ["repayments.view", "repayments.review"] },
  { key: "withdrawals", path: "/admin/withdrawals", perms: ["withdrawals.view"] },
  { key: "dividends", path: "/admin/dividends", perms: ["dividends.view"] },
];

const EMPTY = Object.fromEntries(SOURCES.map((s) => [s.key, []]));

function StatisticsPanel({ token }) {
  const { user } = useAuth();
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState([]);
  const [range, setRange] = useState(6);
  const [updatedAt, setUpdatedAt] = useState(null);

  const allowed = useMemo(
    () => Object.fromEntries(SOURCES.map((s) => [s.key, hasPermission(user, ...s.perms)])),
    [user],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const active = SOURCES.filter((s) => allowed[s.key]);
    const results = await Promise.allSettled(active.map((s) => request(s.path, { token })));

    const next = { ...EMPTY };
    const errors = [];
    results.forEach((result, i) => {
      const { key } = active[i];
      if (result.status === "fulfilled" && Array.isArray(result.value)) {
        next[key] = result.value;
      } else {
        errors.push(key);
      }
    });

    // Administrator and staff accounts are not members.
    next.members = next.members.filter((m) => m.role !== "admin");

    setData(next);
    setFailed(errors);
    setUpdatedAt(new Date());
    setLoading(false);
  }, [token, allowed]);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    const { members, savings, applications, loans, repayments, withdrawals, dividends } = data;
    const months = lastMonths(range);
    const labels = months.map((m) => m.name);

    const approvedSavings = savings.filter((s) => s.status === "approved");
    const approvedRepayments = repayments.filter((r) => r.status === "approved");
    const paidWithdrawals = withdrawals.filter((w) => w.status === "success");
    const disbursedLoans = loans.filter((l) => l.disbursedDate);

    const totalSavings = sum(members, (m) => m.savingsBalance);
    const totalDeposits = sum(approvedSavings, (s) => s.amount);
    const loansDisbursed = sum(disbursedLoans, (l) => l.amount);
    const outstanding = sum(
      disbursedLoans.filter((l) => num(l.outstandingBalance) > 0),
      (l) => l.outstandingBalance,
    );
    const totalDue = sum(disbursedLoans, (l) => l.totalRepayment);
    const repaid = sum(approvedRepayments, (r) => r.amount);
    const withdrawn = sum(paidWithdrawals, (w) => w.amount);
    const dividendsPaid = sum(dividends, (d) => d.paidAmount);
    const interestPaid = sum(approvedRepayments, (r) => r.interestPortion);

    const pending =
      savings.filter((s) => s.status === "pending").length +
      applications.filter((a) => a.status === "pending").length +
      loans.filter((l) => l.status === "pending").length +
      repayments.filter((r) => r.status === "pending").length;

    const badLoans = loans.filter((l) => ["overdue", "defaulted"].includes(l.status));

    const topSavers = [...members]
      .filter((m) => num(m.savingsBalance) > 0)
      .sort((a, b) => num(b.savingsBalance) - num(a.savingsBalance))
      .slice(0, 5)
      .map((m) => ({ name: m.fullName || m.email || "Member", value: num(m.savingsBalance) }));

    const topBorrowers = [...disbursedLoans]
      .sort((a, b) => num(b.outstandingBalance) - num(a.outstandingBalance))
      .filter((l) => num(l.outstandingBalance) > 0)
      .slice(0, 5)
      .map((l) => ({ name: l.user?.fullName || "Member", value: num(l.outstandingBalance) }));

    const dividendYears = [...dividends]
      .sort((a, b) => num(a.financialYear) - num(b.financialYear))
      .slice(-6);

    return {
      months,
      labels,
      counts: {
        members: members.length,
        approvedMembers: members.filter((m) => m.isApprovedMember).length,
        blocked: members.filter((m) => m.isBlocked).length,
        loanEligible: members.filter((m) => m.isLoanEligible).length,
      },
      totals: {
        totalSavings,
        totalDeposits,
        loansDisbursed,
        outstanding,
        repaid,
        withdrawn,
        dividendsPaid,
        interestPaid,
        pending,
      },
      ratios: {
        avgSavings: members.length ? totalSavings / members.length : 0,
        avgLoan: disbursedLoans.length ? loansDisbursed / disbursedLoans.length : 0,
        repaymentRate: pct(sum(disbursedLoans, (l) => l.amountPaid), totalDue),
        badLoanRate: pct(badLoans.length, loans.filter((l) => l.disbursedDate).length || 0),
        loanToSavings: pct(outstanding, totalSavings),
        approvalRate: pct(
          applications.filter((a) => a.status === "approved").length,
          applications.length,
        ),
      },
      pies: {
        memberType: countBy(members, (m) => m.membershipType, (v) => label(v, "Unassigned")),
        memberStatus: [
          { name: "Active", value: members.filter((m) => m.isApprovedMember && !m.isBlocked).length },
          { name: "Not yet approved", value: members.filter((m) => !m.isApprovedMember && !m.isBlocked).length },
          { name: "Blocked", value: members.filter((m) => m.isBlocked).length },
        ],
        frequency: countBy(members, (m) => m.contributionFrequency, (v) => label(v, "Not set")),
        applicationStatus: countBy(applications, (a) => a.status),
        gender: countBy(applications, (a) => String(a.gender || "").toLowerCase(), (v) => label(v, "Not stated")),
        savingsStatus: countBy(savings, (s) => s.status),
        savingsMethod: sumBy(approvedSavings, (s) => s.method, (s) => s.amount),
        loanStatus: countBy(loans, (l) => l.status),
        loanType: sumBy(disbursedLoans, (l) => l.loanType, (l) => l.amount),
        repaymentStatus: countBy(repayments, (r) => r.status),
        withdrawalStatus: countBy(withdrawals, (w) => w.status),
        withdrawalSource: sumBy(paidWithdrawals, (w) => w.source, (w) => w.amount),
        portfolio: [
          { name: "Repaid", value: sum(disbursedLoans, (l) => l.amountPaid) },
          { name: "Outstanding", value: outstanding },
        ],
      },
      monthly: {
        deposits: monthlyTotals(months, approvedSavings, (s) => s.createdAt, (s) => s.amount),
        disbursed: monthlyTotals(months, disbursedLoans, (l) => l.disbursedDate, (l) => l.amount),
        repaid: monthlyTotals(months, approvedRepayments, (r) => r.approvedAt || r.createdAt, (r) => r.amount),
        withdrawn: monthlyTotals(months, paidWithdrawals, (w) => w.paidAt || w.createdAt, (w) => w.amount),
        newMembers: monthlyTotals(months, members, (m) => m.createdAt),
        applications: monthlyTotals(months, applications, (a) => a.createdAt),
        loanRequests: monthlyTotals(months, loans, (l) => l.applicationDate || l.createdAt),
      },
      topSavers,
      topBorrowers,
      dividendYears,
    };
  }, [data, range]);

  const { counts, totals, ratios, pies, monthly, labels } = stats;
  const show = (key) => allowed[key];
  const stamp = updatedAt
    ? updatedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="eyebrow">Statistics</p>
          <h1>Statistics</h1>
          <p className="admin-subtitle">
            Charts and figures for members, savings, loans, repayments, withdrawals and dividends.
            {stamp ? ` Updated ${stamp}.` : ""}
          </p>
        </div>
        <div className="admin-page-heading-actions stats-actions">
          <select
            className="stats-range"
            value={range}
            onChange={(e) => setRange(Number(e.target.value))}
            aria-label="Trend period"
          >
            <option value={3}>Last 3 months</option>
            <option value={6}>Last 6 months</option>
            <option value={12}>Last 12 months</option>
          </select>
          <button type="button" className="admin-refresh-btn" onClick={load} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {failed.length > 0 && (
        <div className="stats-warning">
          Some data could not be loaded ({failed.join(", ")}). Figures that depend on it may be
          incomplete. Try Refresh.
        </div>
      )}

      {/* KPI cards */}
      <div className="stats-kpi-grid">
        {show("members") && <Kpi title="Total Members" value={counts.members.toLocaleString()} hint={`${counts.approvedMembers} approved`} />}
        {show("members") && <Kpi title="Total Savings" value={naira(totals.totalSavings)} hint={`Avg ${naira(ratios.avgSavings)} per member`} />}
        {show("loans") && <Kpi title="Loans Disbursed" value={naira(totals.loansDisbursed)} hint={`Avg ${naira(ratios.avgLoan)} per loan`} />}
        {show("loans") && <Kpi title="Outstanding Loans" value={naira(totals.outstanding)} tone="warn" hint={`${ratios.loanToSavings.toFixed(0)}% of total savings`} />}
        {show("repayments") && <Kpi title="Repayments Received" value={naira(totals.repaid)} hint={`${ratios.repaymentRate.toFixed(0)}% of amount due`} />}
        {show("repayments") && <Kpi title="Interest Earned" value={naira(totals.interestPaid)} />}
        {show("withdrawals") && <Kpi title="Withdrawals Paid" value={naira(totals.withdrawn)} />}
        {show("dividends") && <Kpi title="Dividends Paid" value={naira(totals.dividendsPaid)} />}
        <Kpi title="Pending Items" value={totals.pending.toLocaleString()} tone="warn" hint="Awaiting a decision" />
        {show("members") && <Kpi title="Blocked Accounts" value={counts.blocked.toLocaleString()} tone={counts.blocked ? "bad" : undefined} />}
      </div>

      {/* Trends */}
      <div className="stats-grid">
        {(show("savings") || show("loans") || show("repayments")) && (
          <ChartCard eyebrow="Money in & out" title="Monthly Cash Flow" wide>
            <BarChart
              labels={labels}
              money
              series={[
                show("savings") && { name: "Savings deposits", color: PALETTE[0], values: monthly.deposits },
                show("repayments") && { name: "Repayments", color: PALETTE[1], values: monthly.repaid },
                show("loans") && { name: "Loans disbursed", color: PALETTE[2], values: monthly.disbursed },
                show("withdrawals") && { name: "Withdrawals", color: PALETTE[3], values: monthly.withdrawn },
              ].filter(Boolean)}
            />
          </ChartCard>
        )}

        {show("members") && (
          <ChartCard eyebrow="Growth" title="New Members per Month">
            <LineChart labels={labels} series={[{ name: "New members", color: PALETTE[0], values: monthly.newMembers }]} />
          </ChartCard>
        )}

        {show("loans") && (
          <ChartCard eyebrow="Demand" title="Loan Requests per Month">
            <LineChart labels={labels} series={[{ name: "Loan requests", color: PALETTE[2], values: monthly.loanRequests }]} />
          </ChartCard>
        )}

        {show("applications") && (
          <ChartCard eyebrow="Demand" title="Membership Applications per Month">
            <BarChart labels={labels} series={[{ name: "Applications", color: PALETTE[1], values: monthly.applications }]} />
          </ChartCard>
        )}

        {show("savings") && (
          <ChartCard eyebrow="Savings" title="Deposits per Month">
            <LineChart labels={labels} money series={[{ name: "Deposits", color: PALETTE[0], values: monthly.deposits }]} />
          </ChartCard>
        )}
      </div>

      {/* Pie charts */}
      <div className="stats-grid stats-grid-pies">
        {show("members") && (
          <>
            <ChartCard eyebrow="Members" title="Membership Type">
              <DonutChart data={pies.memberType} centerLabel="Members" />
            </ChartCard>
            <ChartCard eyebrow="Members" title="Account Status">
              <DonutChart data={pies.memberStatus} centerLabel="Members" />
            </ChartCard>
            <ChartCard eyebrow="Members" title="Contribution Frequency">
              <DonutChart data={pies.frequency} centerLabel="Members" />
            </ChartCard>
          </>
        )}

        {show("applications") && (
          <>
            <ChartCard eyebrow="Applications" title="Membership Applications">
              <DonutChart data={pies.applicationStatus} centerLabel="Applications" />
            </ChartCard>
            <ChartCard eyebrow="Applications" title="Gender of Applicants">
              <DonutChart data={pies.gender} centerLabel="Applicants" />
            </ChartCard>
          </>
        )}

        {show("savings") && (
          <>
            <ChartCard eyebrow="Savings" title="Deposit Requests">
              <DonutChart data={pies.savingsStatus} centerLabel="Requests" />
            </ChartCard>
            <ChartCard eyebrow="Savings" title="Deposits by Method">
              <DonutChart data={pies.savingsMethod} money centerLabel="Deposited" />
            </ChartCard>
          </>
        )}

        {show("loans") && (
          <>
            <ChartCard eyebrow="Loans" title="Loans by Status">
              <DonutChart data={pies.loanStatus} centerLabel="Loans" />
            </ChartCard>
            <ChartCard eyebrow="Loans" title="Disbursed by Loan Type">
              <DonutChart data={pies.loanType} money centerLabel="Disbursed" />
            </ChartCard>
            <ChartCard eyebrow="Loans" title="Loan Portfolio">
              <DonutChart data={pies.portfolio} money centerLabel="Total due" />
            </ChartCard>
          </>
        )}

        {show("repayments") && (
          <ChartCard eyebrow="Repayments" title="Repayment Records">
            <DonutChart data={pies.repaymentStatus} centerLabel="Records" />
          </ChartCard>
        )}

        {show("withdrawals") && (
          <>
            <ChartCard eyebrow="Withdrawals" title="Withdrawal Status">
              <DonutChart data={pies.withdrawalStatus} centerLabel="Requests" />
            </ChartCard>
            <ChartCard eyebrow="Withdrawals" title="Paid Out by Source">
              <DonutChart data={pies.withdrawalSource} money centerLabel="Paid out" />
            </ChartCard>
          </>
        )}
      </div>

      {/* Rankings + dividends + ratios */}
      <div className="stats-grid">
        {show("members") && (
          <ChartCard eyebrow="Members" title="Top 5 Savers">
            <RankBars items={stats.topSavers} money />
          </ChartCard>
        )}

        {show("loans") && (
          <ChartCard eyebrow="Loans" title="Largest Outstanding Balances">
            <RankBars items={stats.topBorrowers} money />
          </ChartCard>
        )}

        {show("dividends") && (
          <ChartCard eyebrow="Dividends" title="Dividend Pool vs Paid by Year">
            {stats.dividendYears.length ? (
              <BarChart
                money
                labels={stats.dividendYears.map((d) => String(d.financialYear))}
                series={[
                  { name: "Pool", color: PALETTE[1], values: stats.dividendYears.map((d) => num(d.pool)) },
                  { name: "Paid", color: PALETTE[0], values: stats.dividendYears.map((d) => num(d.paidAmount)) },
                ]}
              />
            ) : (
              <EmptyChart text="No dividend records yet" />
            )}
          </ChartCard>
        )}

        <ChartCard eyebrow="Health" title="Key Ratios">
          <div className="stats-ratios">
            {show("repayments") && show("loans") && (
              <div><span>Repayment rate</span><strong>{ratios.repaymentRate.toFixed(1)}%</strong></div>
            )}
            {show("loans") && (
              <div><span>Overdue / defaulted loans</span><strong>{ratios.badLoanRate.toFixed(1)}%</strong></div>
            )}
            {show("members") && show("loans") && (
              <div><span>Outstanding vs savings</span><strong>{ratios.loanToSavings.toFixed(1)}%</strong></div>
            )}
            {show("applications") && (
              <div><span>Application approval rate</span><strong>{ratios.approvalRate.toFixed(1)}%</strong></div>
            )}
            {show("members") && (
              <div><span>Loan-eligible members</span><strong>{counts.loanEligible.toLocaleString()}</strong></div>
            )}
            {show("members") && (
              <div><span>Average savings per member</span><strong>{naira(ratios.avgSavings)}</strong></div>
            )}
          </div>
        </ChartCard>
      </div>
    </>
  );
}

export default StatisticsPanel;
