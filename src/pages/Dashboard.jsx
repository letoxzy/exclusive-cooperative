import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import { useAuth } from "../context/AuthContext";
import request from "../utils/api";
import "../styles/dashboard.css";
import "../styles/dashboard-refresh.css";

function Dashboard() {
  const { user, logout, refreshUser } = useAuth();

  const [amount, setAmount] = useState("");
  const [requests, setRequests] = useState([]);
  const [membershipApp, setMembershipApp] = useState(undefined);
  const [contributionStatus, setContributionStatus] = useState(null);
  const [loans, setLoans] = useState([]);

  const [repaymentAmount, setRepaymentAmount] = useState("");
  const [repayments, setRepayments] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [transactionsLoading, setTransactionsLoading] = useState(true);
  const [transactionsError, setTransactionsError] = useState("");
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [showAllTransactions, setShowAllTransactions] = useState(false);
  const [showAllRequests, setShowAllRequests] = useState(false);
  const [repaymentLoading, setRepaymentLoading] = useState(false);
  const [repaymentError, setRepaymentError] = useState("");
  const [repaymentSuccess, setRepaymentSuccess] = useState("");
  const [repaymentReceipt, setRepaymentReceipt] = useState(null);
  const [repaymentReceiptPreview, setRepaymentReceiptPreview] = useState("");
  const [copyAccountMessage, setCopyAccountMessage] = useState("");
  const [cooperativeSettings, setCooperativeSettings] = useState({
    loanMultiplier: 2,
    repaymentAccountName: "Exclusive Cooperative Multipurpose Society Limited",
    repaymentBank: "UBA",
    repaymentAccountNumber: "0123456789",
  });
  const repaymentGalleryInputRef = useRef(null);
  const repaymentCameraInputRef = useRef(null);

  const [showBalances, setShowBalances] = useState(true);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [payLoading, setPayLoading] = useState(false);
  const [loanLoading, setLoanLoading] = useState(true);

  const eligibleLoan =
    Number(user?.savingsBalance || 0) *
    Number(cooperativeSettings.loanMultiplier || 2);

  // Prefer the freshly-fetched membership application status over
  // the cached `user.isApprovedMember` flag from AuthContext, which
  // only updates on login/logout — not when an admin approves the
  // member mid-session. Falls back to the cached flag only while
  // membershipApp hasn't loaded yet.
  const isApproved =
    membershipApp !== undefined
      ? membershipApp?.status === "approved"
      : user?.isApprovedMember;

  /*
   * ================================
   * FORMAT MONEY
   * ================================
   */
  const money = (value) => {
    return `₦${Number(value || 0).toLocaleString()}`;
  };

  // When hidden, shows dots instead of the real figure — same idea as a
  // bank app hiding your balance until you tap to reveal it.
  const displayMoney = (value) => (showBalances ? money(value) : "••••••");

  const formatDate = (value) => {
    if (!value) return "—";

    return new Date(value).toLocaleDateString("en-NG", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Africa/Lagos",
    });
  };

  const formatTime = (value) => {
    if (!value) return "—";

    return new Date(value).toLocaleTimeString("en-NG", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Africa/Lagos",
    });
  };

  /*
   * ================================
   * LOAD SAVINGS REQUESTS
   * ================================
   */
  const loadRequests = useCallback(async () => {
    if (!user?.token) return;

    try {
      const data = await request("/users/me/savings-requests", {
        token: user.token,
      });

      setRequests(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message);
    }
  }, [user?.token]);

  /*
   * ================================
   * LOAD MEMBER LOANS
   * ================================
   */
  /*
   * ================================
   * LOAD TRANSACTIONS
   * ================================
   */
  const loadTransactions = useCallback(
    async (silent = false) => {
      if (!user?.token) {
        setTransactionsLoading(false);
        return;
      }

      try {
        if (!silent) setTransactionsLoading(true);
        setTransactionsError("");

        const data = await request("/users/me/transactions", {
          token: user.token,
        });

        setTransactions(Array.isArray(data) ? data : []);
      } catch (err) {
        setTransactionsError(err.message);
        setTransactions([]);
      } finally {
        if (!silent) setTransactionsLoading(false);
      }
    },
    [user?.token],
  );

  const loadLoans = useCallback(
    async (silent = false) => {
      if (!user?.token) {
        setLoanLoading(false);
        return;
      }

      try {
        if (!silent) setLoanLoading(true);

        const data = await request("/loans/my-loans", {
          token: user.token,
        });

        console.log("MEMBER LOANS:", data);

        setLoans(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("LOAD LOANS ERROR:", err);
        setError(err.message);
        setLoans([]);
      } finally {
        if (!silent) setLoanLoading(false);
      }
    },
    [user?.token],
  );

  /*
   * ================================
   * LOAD MEMBERSHIP + DASHBOARD DATA
   * ================================
   *
   * IMPORTANT:
   * The dashboard must always use the latest
   * member balance from the backend. The AuthContext
   * can contain an older cached user object when a
   * member tops up from another device.
   *
   * We refresh the authenticated user once when the
   * dashboard loads. This updates user.savingsBalance
   * from the database without changing the loan-fetch
   * flow, so the loan card remains stable.
   */
  useEffect(() => {
    if (!user?.token) return;

    loadRequests();
    loadLoans();
    loadTransactions();

    request("/membership/me", {
      token: user.token,
    })
      .then((data) => {
        setMembershipApp(data);
      })
      .catch(() => {
        setMembershipApp(null);
      });

    request("/payments/contribution-status", { token: user.token })
      .then((data) => setContributionStatus(data))
      .catch(() => setContributionStatus(null));

    request("/loans/cooperative-config", { token: user.token })
      .then((data) =>
        setCooperativeSettings({
          loanMultiplier: Number(data?.loanMultiplier ?? 2),
          repaymentAccountName:
            data?.repaymentAccountName ||
            "Exclusive Cooperative Multipurpose Society Limited",
          repaymentBank: data?.repaymentBank || "UBA",
          repaymentAccountNumber:
            data?.repaymentAccountNumber || "0123456789",
        }),
      )
      .catch((err) => {
        console.error("COOPERATIVE CONFIG LOAD ERROR:", err);
      });

    // Refresh the cached member record so savings balance
    // and loan eligibility always reflect MongoDB.
    // Do not add refreshUser to this effect's dependency list:
    // AuthContext implementations commonly recreate it when
    // user state changes, which can cause repeated requests.
    refreshUser().catch((err) => {
      console.error("DASHBOARD USER REFRESH ERROR:", err);
    });
  }, [user?.token, loadRequests, loadLoans, loadTransactions]);

  /*
   * ================================
   * KEEP LOAN BALANCE IN SYNC
   * ================================
   *
   * Repayment confirmation happens in the admin dashboard, so the member
   * dashboard must re-read the loan from the backend instead of relying on
   * the copy that was loaded when the page first opened. Refresh on tab focus
   * and periodically while the dashboard is open.
   */
  useEffect(() => {
    if (!user?.token) return;

    const refreshLoanData = () => {
      void loadLoans(true);
      void loadTransactions(true);
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        refreshLoanData();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    const interval = window.setInterval(refreshLoanData, 15000);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.clearInterval(interval);
    };
  }, [user?.token, loadLoans, loadTransactions]);

  useEffect(() => {
    const modalOpen = Boolean(
      selectedTransaction || showAllTransactions || showAllRequests,
    );
    if (!modalOpen) return;

    const handleKeyDown = (event) => {
      if (event.key !== "Escape") return;
      setSelectedTransaction(null);
      setShowAllTransactions(false);
      setShowAllRequests(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedTransaction, showAllTransactions, showAllRequests]);

  // Keep the page underneath a transaction/history modal from scrolling.
  // This also prevents the dashboard from visibly jumping when a modal opens.
  useEffect(() => {
    const modalOpen = Boolean(
      selectedTransaction || showAllTransactions || showAllRequests,
    );
    if (!modalOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedTransaction, showAllTransactions, showAllRequests]);

  /*
   * ================================
   * LOAD REPAYMENT HISTORY FOR ACTIVE LOAN
   * ================================
   */
  const loadRepayments = useCallback(
    async (loanId) => {
      if (!user?.token || !loanId) return;
      try {
        const data = await request(`/loans/${loanId}/repayments`, {
          token: user.token,
        });
        setRepayments(Array.isArray(data) ? data : []);
      } catch (err) {
        setRepaymentError(err.message);
      }
    },
    [user?.token],
  );

  useEffect(() => {
    const active = loans.find((loan) => loan.status === "active");
    if (active) loadRepayments(active._id);
  }, [loans, loadRepayments]);

  const handleRepaymentReceiptChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setRepaymentReceipt(file);
    setRepaymentReceiptPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return URL.createObjectURL(file);
    });
    setRepaymentError("");
    setRepaymentSuccess("");
  };

  useEffect(() => {
    return () => {
      if (repaymentReceiptPreview) URL.revokeObjectURL(repaymentReceiptPreview);
    };
  }, [repaymentReceiptPreview]);

  const copyRepaymentAccount = async () => {
    try {
      await navigator.clipboard.writeText(cooperativeSettings.repaymentAccountNumber);
      setCopyAccountMessage("Copied");
      window.setTimeout(() => setCopyAccountMessage(""), 1800);
    } catch {
      setCopyAccountMessage("Copy failed");
    }
  };

  const handleRepaymentSubmit = async (e, loanId) => {
    e.preventDefault();
    setRepaymentError("");
    setRepaymentSuccess("");

    const value = Number(repaymentAmount);
    const outstanding = Number(currentLoan?.outstandingBalance || 0);

    if (!value || value <= 0) {
      setRepaymentError("Enter a valid repayment amount.");
      return;
    }

    if (value > outstanding) {
      setRepaymentError(
        `Repayment cannot exceed your outstanding balance of ${money(outstanding)}.`,
      );
      return;
    }

    if (!repaymentReceipt) {
      setRepaymentError(
        "Please upload your transfer receipt before submitting.",
      );
      return;
    }

    setRepaymentLoading(true);
    try {
      const apiBaseUrl =
        import.meta.env.VITE_API_URL ||
        "https://exclusive-cooperative-api.onrender.com/api";
      const formData = new FormData();
      formData.append("amount", String(value));
      formData.append("receipt", repaymentReceipt);

      const response = await fetch(`${apiBaseUrl}/loans/${loanId}/repayments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${user.token}` },
        body: formData,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          data.message || data.error || "Failed to submit repayment.",
        );
      }

      setRepaymentAmount("");
      setRepaymentReceipt(null);
      setRepaymentReceiptPreview("");
      if (repaymentGalleryInputRef.current)
        repaymentGalleryInputRef.current.value = "";
      if (repaymentCameraInputRef.current)
        repaymentCameraInputRef.current.value = "";
      setRepaymentSuccess(
        "Repayment submitted — an admin will review your transfer receipt and confirm it shortly.",
      );
      await loadRepayments(loanId);
      await Promise.all([loadLoans(), loadTransactions()]);
    } catch (err) {
      setRepaymentError(err.message || "Failed to submit repayment.");
    } finally {
      setRepaymentLoading(false);
    }
  };

  /*
   * ================================
   * PAYSTACK SAVINGS PAYMENT
   * ================================
   */
  const handlePaystackPay = async () => {
    setError("");

    const value = Number(amount);

    if (!value || value <= 0) {
      setError("Enter a valid amount.");
      return;
    }

    setPayLoading(true);

    try {
      const data = await request("/payments/paystack/initialize", {
        method: "POST",
        token: user.token,
        body: {
          amount: value,
        },
      });

      window.location.href = data.authorizationUrl;
    } catch (err) {
      setError(err.message);
      setPayLoading(false);
    }
  };

  /*
   * ================================
   * FIND CURRENT LOAN
   *
   * Priority:
   * 1. Active
   * 2. Approved
   * 3. Pending
   * ================================
   */
  const activeLoan = loans.find((loan) =>
    ["active", "overdue"].includes(loan.status),
  );

  const approvedLoan = loans.find((loan) => loan.status === "approved");

  const pendingLoan = loans.find((loan) => loan.status === "pending");

  const currentLoan = activeLoan || approvedLoan;

  // How much of the total repayable amount has been paid, for the progress bar.
  const loanRepaidPercent =
    currentLoan && Number(currentLoan.totalRepayment) > 0
      ? Math.min(
          100,
          Math.max(
            0,
            Math.round(
              (Number(currentLoan.amountPaid || 0) /
                Number(currentLoan.totalRepayment)) *
                100,
            ),
          ),
        )
      : 0;

  const outstandingLoanAmount = activeLoan
    ? Math.max(0, Number(activeLoan.outstandingBalance || 0))
    : 0;

  /*
   * ================================
   * LOAN HISTORY
   * ================================
   */
  const loanHistory = loans.filter(
    (loan) => !["active", "approved", "pending"].includes(loan.status),
  );

  return (
    <div className="dashboard-page dashboard-refresh">
      {/* =====================================
          DASHBOARD HEADER
      ====================================== */}

      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Welcome back</p>

          <h1>{user?.fullName}</h1>
        </div>

        <button className="logout-btn" onClick={logout}>
          Log Out
        </button>
      </header>

      {/* =====================================
          MEMBERSHIP MESSAGES
      ====================================== */}

      {membershipApp === null && (
        <div className="membership-banner">
          <span>You haven't completed your membership application yet.</span>

          <Link to="/membership" className="banner-link">
            Complete it now →
          </Link>
        </div>
      )}

      {membershipApp && membershipApp.status === "pending" && (
        <div className="membership-banner pending">
          <span>
            Your membership application is pending admin review. Savings
            deposits unlock once it's approved.
          </span>
        </div>
      )}

      {membershipApp && membershipApp.status === "rejected" && (
        <div className="membership-banner rejected">
          <span>
            Your membership application was not approved. Contact the
            cooperative for details.
          </span>
        </div>
      )}

      {/* =====================================
          SAVINGS + LOAN ELIGIBILITY
      ====================================== */}

      <section className="dashboard-grid">
        <div className="dash-card">
          <div className="dash-card-top">
            <span className="dash-label">Locked Savings</span>
            <button
              type="button"
              className="eye-toggle"
              onClick={() => setShowBalances((prev) => !prev)}
              aria-label={showBalances ? "Hide balances" : "Show balances"}
            >
              {showBalances ? <FaEyeSlash /> : <FaEye />}
            </button>
          </div>

          <span className="dash-figure">
            {displayMoney(user?.savingsBalance)}
          </span>
        </div>

        <div className="dash-card">
          <span className="dash-label">Shareholding</span>

          <span className="dash-figure gold">
            {displayMoney(user?.shareholding)}
          </span>
        </div>

        <div className="dash-card">
          <span className="dash-label">Loan Eligibility (2x savings)</span>

          <span className="dash-figure gold">{displayMoney(eligibleLoan)}</span>
        </div>

        <div className="dash-card">
          <span className="dash-label">Outstanding Loan</span>

          <span className="dash-figure">
            {displayMoney(outstandingLoanAmount)}
          </span>
        </div>
      </section>

      {/* =====================================
          PAGE LAYOUT
          Side column: savings actions. Main column: loan, history,
          transactions, deposit requests. On phones the actions come first.
      ====================================== */}

      <div className="dashboard-layout">
        <aside className="dashboard-side" aria-label="Savings actions">
          {/* =====================================
          TOP UP SAVINGS
      ====================================== */}

          <section className="dash-form-card topup-card">
            <h2>Top Up Savings</h2>

            {!isApproved ? (
              <p className="locked-notice">
                Deposits unlock once your membership application is approved by
                an admin.
              </p>
            ) : (
              <>
                <p className="dash-note">
                  {contributionStatus?.frequency || "Monthly"} contribution
                  plan. You can make one regular contribution per selected
                  period, with a minimum of ₦10,000. Withdrawals are monthly for
                  all members.
                </p>

                <div className="quick-amounts">
                  {[10000, 20000, 50000, 100000].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={`quick-amount-chip ${
                        Number(amount) === preset ? "active" : ""
                      }`}
                      onClick={() => setAmount(String(preset))}
                    >
                      ₦{preset.toLocaleString()}
                    </button>
                  ))}
                </div>

                <form
                  onSubmit={(e) => e.preventDefault()}
                  className="topup-form"
                >
                  <input
                    type="number"
                    min="10000"
                    placeholder="Minimum ₦10,000"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />

                  <button
                    type="button"
                    className="topup-btn"
                    onClick={handlePaystackPay}
                    disabled={
                      payLoading || contributionStatus?.canContribute === false
                    }
                  >
                    {payLoading ? "Redirecting..." : "Top Up Now"}
                  </button>
                </form>

                {error && <p className="form-error">{error}</p>}
                {contributionStatus?.canContribute === false && (
                  <p className="form-error">
                    Your {contributionStatus.frequency?.toLowerCase()}{" "}
                    contribution for this period has already been made.
                  </p>
                )}
                {success && <p className="form-success">{success}</p>}
              </>
            )}
          </section>

          {/* =====================================
          WITHDRAWALS
      ====================================== */}

          <section className="dash-form-card withdrawal-dashboard-card">
            <div className="withdrawal-dashboard-copy">
              <div>
                <p className="eyebrow">Savings</p>
                <h2>Withdraw your savings</h2>
                <p className="dash-note">
                  Each contribution places 60% into locked savings and 40% into
                  the current month's withdrawal pool. Savings withdrawals are
                  available once per month and are unavailable while you have an
                  outstanding loan.
                </p>
              </div>
              <Link to="/withdrawals" className="withdraw-dashboard-btn">
                Withdraw Funds
              </Link>
            </div>
          </section>
        </aside>

        <div className="dashboard-main">
          {/* =====================================
          LOAN SECTION
      ====================================== */}

          {loanLoading ? (
            <section className="loan-card">
              <div className="loan-card-header">
                <p className="loan-card-eyebrow">Your Loan</p>

                <h2 className="loan-card-title">Loading loan information...</h2>
              </div>
            </section>
          ) : currentLoan ? (
            /*
             * =====================================
             * ACTIVE / APPROVED LOAN
             * =====================================
             */
            <section className="loan-card">
              <div className="loan-card-header">
                <p className="loan-card-eyebrow">Your Loan</p>

                <h2 className="loan-card-title">
                  {currentLoan.status === "active"
                    ? "Active Loan"
                    : "Approved Loan"}
                </h2>

                <span className={`loan-status ${currentLoan.status}`}>
                  {currentLoan.status}
                </span>
              </div>

              {/* LOAN SUMMARY */}

              <div className="loan-summary">
                <div className="loan-summary-item">
                  <span className="loan-summary-label">Original Loan</span>

                  <span className="loan-summary-value">
                    {money(currentLoan.amount)}
                  </span>
                </div>

                <div className="loan-summary-item">
                  <span className="loan-summary-label">Total Repayable</span>

                  <span className="loan-summary-value">
                    {money(currentLoan.totalRepayment)}
                  </span>
                </div>

                <div className="loan-summary-item">
                  <span className="loan-summary-label">Amount Paid</span>

                  <span className="loan-summary-value paid">
                    {money(currentLoan.amountPaid)}
                  </span>
                </div>

                <div className="loan-summary-item">
                  <span className="loan-summary-label">Amount Owing</span>

                  <span className="loan-summary-value owing">
                    {money(currentLoan.outstandingBalance)}
                  </span>
                </div>
              </div>

              {/* REPAYMENT PROGRESS */}

              {currentLoan.status === "active" &&
                Number(currentLoan.totalRepayment) > 0 && (
                  <div
                    className="loan-progress"
                    role="progressbar"
                    aria-label="Loan repaid"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={loanRepaidPercent}
                  >
                    <div className="loan-progress-track">
                      <span style={{ width: `${loanRepaidPercent}%` }} />
                    </div>

                    <div className="loan-progress-meta">
                      <strong>{loanRepaidPercent}% repaid</strong>
                      <span>
                        {money(currentLoan.outstandingBalance)} left to pay
                      </span>
                    </div>
                  </div>
                )}

              {/* LOAN DETAILS */}

              <div className="loan-details">
                <div className="loan-detail">
                  <span className="loan-detail-label">Loan Type</span>

                  <span className="loan-detail-value">
                    {currentLoan.loanType
                      ? currentLoan.loanType.charAt(0).toUpperCase() +
                        currentLoan.loanType.slice(1)
                      : "-"}
                  </span>
                </div>

                <div className="loan-detail">
                  <span className="loan-detail-label">Term</span>

                  <span className="loan-detail-value">
                    {currentLoan.termMonths
                      ? `${currentLoan.termMonths} months`
                      : "-"}
                  </span>
                </div>

                <div className="loan-detail">
                  <span className="loan-detail-label">Interest Rate</span>

                  <span className="loan-detail-value">
                    {Number(currentLoan.interestRate || 0)}%
                  </span>
                </div>

                {Number(currentLoan.overdueChargeTotal || 0) > 0 && (
                  <div className="loan-detail">
                    <span className="loan-detail-label">Overdue increases</span>
                    <span className="loan-detail-value">
                      {money(currentLoan.overdueChargeTotal)}
                    </span>
                  </div>
                )}

                {currentLoan.repaymentSchedule?.length > 0 && (
                  <div className="loan-detail">
                    <span className="loan-detail-label">
                      Final repayment date
                    </span>
                    <span className="loan-detail-value">
                      {new Date(
                        currentLoan.repaymentSchedule[
                          currentLoan.repaymentSchedule.length - 1
                        ].dueDate,
                      ).toLocaleDateString()}
                    </span>
                  </div>
                )}

                <div className="loan-detail">
                  <span className="loan-detail-label">Application Date</span>

                  <span className="loan-detail-value">
                    {currentLoan.applicationDate
                      ? new Date(
                          currentLoan.applicationDate,
                        ).toLocaleDateString()
                      : "-"}
                  </span>
                </div>

                {currentLoan.approvedDate && (
                  <div className="loan-detail">
                    <span className="loan-detail-label">Approved Date</span>

                    <span className="loan-detail-value">
                      {new Date(currentLoan.approvedDate).toLocaleDateString()}
                    </span>
                  </div>
                )}

                {currentLoan.disbursedDate && (
                  <div className="loan-detail">
                    <span className="loan-detail-label">Disbursed Date</span>

                    <span className="loan-detail-value">
                      {new Date(currentLoan.disbursedDate).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>

              {/* LOAN NOTICE */}

              <div className="loan-notice">
                {currentLoan.status === "overdue" && (
                  <strong>
                    Loan overdue — an additional 2% is added every 7 days while
                    the balance remains unpaid.
                  </strong>
                )}
                {Number(currentLoan.outstandingBalance || 0) > 0 ? (
                  <>
                    You currently owe{" "}
                    <strong>{money(currentLoan.outstandingBalance)}</strong>
                    .
                    <br />
                    Please keep up with your repayment schedule.
                  </>
                ) : (
                  <>
                    <strong>Your loan has been fully repaid.</strong>
                    <br />
                    Thank you for completing your repayment.
                  </>
                )}
              </div>

              {currentLoan.status === "active" &&
                currentLoan.outstandingBalance > 0 && (
                  <div className="repayment-section">
                    <div className="repayment-heading">
                      <div>
                        <p className="repayment-eyebrow">Loan repayment</p>
                        <h3>Make a repayment</h3>
                        <p className="dash-note">
                          Transfer your repayment to the cooperative account,
                          then upload the transfer receipt for admin
                          confirmation.
                        </p>
                      </div>
                      <div className="repayment-outstanding">
                        <span>Outstanding</span>
                        <strong>{money(currentLoan.outstandingBalance)}</strong>
                      </div>
                    </div>

                    <div className="repayment-bank-card">
                      <div className="repayment-bank-icon">▥</div>
                      <div className="repayment-bank-content">
                        <p className="repayment-bank-label">
                          Transfer repayment to
                        </p>
                        <strong>{cooperativeSettings.repaymentAccountName}</strong>
                        <div className="repayment-bank-row">
                          <span>Bank</span>
                          <b>{cooperativeSettings.repaymentBank}</b>
                        </div>
                        <div className="repayment-bank-row repayment-account-row">
                          <span>Account number</span>
                          <div>
                            <b>{cooperativeSettings.repaymentAccountNumber}</b>
                            <button
                              type="button"
                              className="copy-account-btn"
                              onClick={copyRepaymentAccount}
                              aria-label="Copy repayment account number"
                            >
                              {copyAccountMessage || "Copy"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <form
                      className="repayment-form-new"
                      onSubmit={(e) =>
                        handleRepaymentSubmit(e, currentLoan._id)
                      }
                    >
                      <label
                        className="repayment-field-label"
                        htmlFor="repayment-amount"
                      >
                        Repayment amount
                      </label>
                      <div className="repayment-amount-input-wrap">
                        <span>₦</span>
                        <input
                          id="repayment-amount"
                          type="number"
                          min="1"
                          max={currentLoan.outstandingBalance}
                          step="1"
                          placeholder="0.00"
                          value={repaymentAmount}
                          onChange={(e) => setRepaymentAmount(e.target.value)}
                        />
                      </div>

                      <div className="repayment-field-label receipt-label">
                        Transfer receipt
                      </div>
                      <div
                        className={`repayment-upload-card ${repaymentReceipt ? "has-receipt" : ""}`}
                      >
                        {repaymentReceiptPreview ? (
                          <div className="receipt-preview-wrap">
                            <img
                              src={repaymentReceiptPreview}
                              alt="Transfer receipt preview"
                              className="receipt-preview"
                            />
                            <div className="receipt-file-name">
                              {repaymentReceipt.name}
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="repayment-upload-icon">▤</div>
                            <strong>Upload your transfer receipt</strong>
                            <p>
                              Use a clear screenshot or photo showing the
                              payment details.
                            </p>
                          </>
                        )}

                        <div className="repayment-upload-actions">
                          <button
                            type="button"
                            onClick={() =>
                              repaymentGalleryInputRef.current?.click()
                            }
                          >
                            Gallery
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              repaymentCameraInputRef.current?.click()
                            }
                          >
                            Camera
                          </button>
                        </div>
                        <input
                          ref={repaymentGalleryInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleRepaymentReceiptChange}
                          hidden
                        />
                        <input
                          ref={repaymentCameraInputRef}
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={handleRepaymentReceiptChange}
                          hidden
                        />
                      </div>

                      {repaymentError && (
                        <p className="form-error">{repaymentError}</p>
                      )}
                      {repaymentSuccess && (
                        <p className="form-success">{repaymentSuccess}</p>
                      )}

                      <button
                        className="repayment-submit-btn"
                        type="submit"
                        disabled={repaymentLoading}
                      >
                        {repaymentLoading
                          ? "Submitting..."
                          : "Submit Repayment"}
                      </button>
                    </form>

                    {repayments.length > 0 && (
                      <div className="repayment-history-block">
                        <h4>Repayment history</h4>
                        <ul className="requests-ul repayment-history">
                          {repayments.map((r) => (
                            <li key={r._id}>
                              <span>{money(r.amount)}</span>
                              <span className={`status-badge ${r.status}`}>
                                {r.status}
                              </span>
                              <span className="req-date">
                                {new Date(r.createdAt).toLocaleDateString()}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
            </section>
          ) : pendingLoan ? (
            /*
             * =====================================
             * PENDING LOAN APPLICATION
             * =====================================
             */
            <section className="loan-card">
              <div className="loan-card-header">
                <p className="loan-card-eyebrow">Your Loan</p>

                <h2 className="loan-card-title">Loan Application</h2>

                <span className="loan-status pending">Pending</span>
              </div>

              <div className="loan-summary">
                <div className="loan-summary-item">
                  <span className="loan-summary-label">Amount Requested</span>

                  <span className="loan-summary-value">
                    {money(pendingLoan.amount)}
                  </span>
                </div>

                <div className="loan-summary-item">
                  <span className="loan-summary-label">Eligible Amount</span>

                  <span className="loan-summary-value">
                    {money(pendingLoan.eligibleAmount)}
                  </span>
                </div>

                <div className="loan-summary-item">
                  <span className="loan-summary-label">Term</span>

                  <span className="loan-summary-value">
                    {pendingLoan.termMonths
                      ? `${pendingLoan.termMonths} months`
                      : "-"}
                  </span>
                </div>

                <div className="loan-summary-item">
                  <span className="loan-summary-label">Status</span>

                  <span className="loan-summary-value">Awaiting Review</span>
                </div>
              </div>

              <div className="loan-details">
                <div className="loan-detail">
                  <span className="loan-detail-label">Loan Type</span>

                  <span className="loan-detail-value">
                    {pendingLoan.loanType
                      ? pendingLoan.loanType.charAt(0).toUpperCase() +
                        pendingLoan.loanType.slice(1)
                      : "-"}
                  </span>
                </div>

                <div className="loan-detail">
                  <span className="loan-detail-label">Application Date</span>

                  <span className="loan-detail-value">
                    {pendingLoan.applicationDate
                      ? new Date(
                          pendingLoan.applicationDate,
                        ).toLocaleDateString()
                      : "-"}
                  </span>
                </div>
              </div>

              <div className="loan-notice">
                Your loan application is currently waiting for admin review. You
                will be notified once a decision has been made.
              </div>
            </section>
          ) : (
            /*
             * =====================================
             * NO CURRENT LOAN
             * =====================================
             */
            <section className="loan-card">
              <div className="loan-card-header">
                <p className="loan-card-eyebrow">Your Loan</p>

                <h2 className="loan-card-title">No Active Loan</h2>
              </div>

              <div className="loan-notice">
                You currently do not have an active or pending loan.
              </div>
            </section>
          )}

          {/* =====================================
          LOAN HISTORY
      ====================================== */}

          {!loanLoading && loanHistory.length > 0 && (
            <section className="dash-form-card requests-list">
              <h2>Loan History</h2>

              <ul className="requests-ul">
                {loanHistory.map((loan) => (
                  <li key={loan._id}>
                    <span>
                      {money(loan.amount)}

                      <span className="method-tag">{loan.loanType}</span>
                    </span>

                    <span className={`status-badge ${loan.status}`}>
                      {loan.status}
                    </span>

                    <span className="req-date">
                      {loan.applicationDate
                        ? new Date(loan.applicationDate).toLocaleDateString()
                        : "-"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* =====================================
          TRANSACTIONS
      ====================================== */}

          <section className="dash-form-card transactions-card">
            <div className="transactions-header">
              <div>
                <h2>Transactions</h2>
                <p className="dash-note">
                  Your recent savings, loans, repayments, withdrawals, and
                  dividends.
                </p>
              </div>

              <div className="transactions-header-actions">
                <button
                  type="button"
                  className="transaction-refresh-btn"
                  onClick={loadTransactions}
                  disabled={transactionsLoading}
                >
                  {transactionsLoading ? "Refreshing..." : "Refresh"}
                </button>

                {transactions.length > 5 && (
                  <button
                    type="button"
                    className="transaction-view-all-btn"
                    onClick={() => setShowAllTransactions(true)}
                  >
                    View All
                  </button>
                )}
              </div>
            </div>

            {transactionsError && (
              <p className="form-error">{transactionsError}</p>
            )}

            {transactionsLoading ? (
              <p className="dash-note">Loading your transactions...</p>
            ) : transactions.length === 0 ? (
              <p className="dash-note">No transactions recorded yet.</p>
            ) : (
              <div className="transactions-table-wrap">
                <table className="transactions-table">
                  <thead>
                    <tr>
                      <th>Date &amp; Time</th>
                      <th>Description</th>
                      <th>Status</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.slice(0, 5).map((transaction) => (
                      <tr
                        key={transaction.id}
                        className="transaction-clickable-row"
                        onClick={() => setSelectedTransaction(transaction)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedTransaction(transaction);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-label={`View ${transaction.type} transaction details`}
                      >
                        <td>
                          <strong>{formatDate(transaction.date)}</strong>
                          <span>{formatTime(transaction.date)}</span>
                        </td>
                        <td>
                          <strong>{transaction.type}</strong>
                          <span>{transaction.description}</span>
                        </td>
                        <td>
                          <span
                            className={`status-badge ${transaction.status}`}
                          >
                            {transaction.status}
                          </span>
                        </td>
                        <td
                          className={`transaction-amount ${transaction.direction}`}
                        >
                          {transaction.direction === "debit" ? "−" : "+"}
                          {money(transaction.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {transactions.length > 5 && (
              <button
                type="button"
                className="dashboard-list-link"
                onClick={() => setShowAllTransactions(true)}
              >
                View all transactions →
              </button>
            )}
          </section>

          {/* =====================================
          SAVINGS REQUESTS
      ====================================== */}

          <section className="dash-form-card requests-list">
            <div className="requests-header">
              <div>
                <h2>Your Deposit Requests</h2>
                <p className="dash-note">Recent savings deposit activity.</p>
              </div>

              {requests.length > 5 && (
                <button
                  type="button"
                  className="transaction-view-all-btn"
                  onClick={() => setShowAllRequests(true)}
                >
                  View All
                </button>
              )}
            </div>

            {requests.length === 0 ? (
              <p className="dash-note">No requests yet.</p>
            ) : (
              <ul className="requests-ul">
                {requests.slice(0, 5).map((r) => (
                  <li key={r._id}>
                    <div className="request-main-info">
                      <strong>{money(r.amount)}</strong>
                      <span className="request-type">Savings Deposit</span>
                    </div>

                    <span className={`status-badge ${r.status}`}>
                      {r.status}
                    </span>

                    <span className="req-date">
                      <strong>{formatDate(r.createdAt)}</strong>
                      <span>{formatTime(r.createdAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {requests.length > 5 && (
              <button
                type="button"
                className="dashboard-list-link"
                onClick={() => setShowAllRequests(true)}
              >
                View all deposit requests →
              </button>
            )}
          </section>
        </div>
      </div>

      {/* =====================================
          TRANSACTION DETAILS
      ====================================== */}

      {selectedTransaction && (
        <div
          className="dashboard-modal-backdrop"
          onClick={() => setSelectedTransaction(null)}
        >
          <div
            className="dashboard-modal transaction-details-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="transaction-details-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dashboard-modal-header">
              <div>
                <p className="modal-eyebrow">Transaction</p>
                <h2 id="transaction-details-title">
                  {selectedTransaction.type}
                </h2>
              </div>

              <button
                type="button"
                className="dashboard-modal-close"
                onClick={() => setSelectedTransaction(null)}
                aria-label="Close transaction details"
              >
                ×
              </button>
            </div>

            <div className="transaction-detail-amount">
              <span>Amount</span>
              <strong className={selectedTransaction.direction}>
                {selectedTransaction.direction === "debit" ? "−" : "+"}
                {money(selectedTransaction.amount)}
              </strong>
            </div>

            <div className="transaction-detail-grid">
              <div>
                <span>Status</span>
                <strong>
                  <span
                    className={`status-badge ${selectedTransaction.status}`}
                  >
                    {selectedTransaction.status}
                  </span>
                </strong>
              </div>

              <div>
                <span>Date</span>
                <strong>{formatDate(selectedTransaction.date)}</strong>
              </div>

              <div>
                <span>Time</span>
                <strong>{formatTime(selectedTransaction.date)}</strong>
              </div>

              <div>
                <span>Payment Method</span>
                <strong>Online Payment</strong>
              </div>

              <div className="transaction-detail-full">
                <span>Description</span>
                <strong>{selectedTransaction.description || "—"}</strong>
              </div>

              <div className="transaction-detail-full">
                <span>Reference</span>
                <strong>{selectedTransaction.reference || "—"}</strong>
              </div>
            </div>

            <div className="transaction-support">
              <strong>Need help with this transaction?</strong>
              <p>
                Our customer service team can help you with transaction
                questions.
              </p>
              <Link
                to="/contact"
                className="transaction-support-btn"
                onClick={() => setSelectedTransaction(null)}
              >
                Contact Customer Service →
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* =====================================
          ALL TRANSACTIONS
      ====================================== */}

      {showAllTransactions && (
        <div
          className="dashboard-modal-backdrop"
          onClick={() => setShowAllTransactions(false)}
        >
          <div
            className="dashboard-modal dashboard-wide-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="all-transactions-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dashboard-modal-header">
              <div>
                <p className="modal-eyebrow">History</p>
                <h2 id="all-transactions-title">All Transactions</h2>
              </div>
              <button
                type="button"
                className="dashboard-modal-close"
                onClick={() => setShowAllTransactions(false)}
                aria-label="Close all transactions"
              >
                ×
              </button>
            </div>

            <div className="modal-table-wrap">
              <table className="transactions-table">
                <thead>
                  <tr>
                    <th>Date &amp; Time</th>
                    <th>Description</th>
                    <th>Status</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((transaction) => (
                    <tr
                      key={transaction.id}
                      className="transaction-clickable-row"
                      onClick={() => {
                        setShowAllTransactions(false);
                        setSelectedTransaction(transaction);
                      }}
                    >
                      <td>
                        <strong>{formatDate(transaction.date)}</strong>
                        <span>{formatTime(transaction.date)}</span>
                      </td>
                      <td>
                        <strong>{transaction.type}</strong>
                        <span>{transaction.description}</span>
                      </td>
                      <td>
                        <span className={`status-badge ${transaction.status}`}>
                          {transaction.status}
                        </span>
                      </td>
                      <td
                        className={`transaction-amount ${transaction.direction}`}
                      >
                        {transaction.direction === "debit" ? "−" : "+"}
                        {money(transaction.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =====================================
          ALL DEPOSIT REQUESTS
      ====================================== */}

      {showAllRequests && (
        <div
          className="dashboard-modal-backdrop"
          onClick={() => setShowAllRequests(false)}
        >
          <div
            className="dashboard-modal dashboard-wide-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="all-requests-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dashboard-modal-header">
              <div>
                <p className="modal-eyebrow">History</p>
                <h2 id="all-requests-title">All Deposit Requests</h2>
              </div>
              <button
                type="button"
                className="dashboard-modal-close"
                onClick={() => setShowAllRequests(false)}
                aria-label="Close all deposit requests"
              >
                ×
              </button>
            </div>

            <ul className="requests-ul modal-requests-list">
              {requests.map((r) => (
                <li key={r._id}>
                  <div className="request-main-info">
                    <strong>{money(r.amount)}</strong>
                    <span className="request-type">Savings Deposit</span>
                  </div>

                  <span className={`status-badge ${r.status}`}>{r.status}</span>

                  <span className="req-date">
                    <strong>{formatDate(r.createdAt)}</strong>
                    <span>{formatTime(r.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
