import { useState, useEffect, useCallback, Fragment } from "react";
import { useAuth } from "../context/AuthContext";
import request from "../utils/api";

import "../styles/admin.css";
import "../styles/admin-components.css";

import { FaUsers, FaHandHoldingDollar, FaClock, FaBell } from "react-icons/fa6";

import AdminSidebar from "../components/admin/AdminSidebar";
import MembershipModal from "../components/admin/MembershipModal";
import AddExistingMemberModal from "../components/admin/AddExistingMemberModal";
import AdminNotifications from "../components/admin/AdminNotifications";

function AdminDashboard() {
  const { user, logout } = useAuth();

  const [activeSection, setActiveSection] = useState("overview");

  const [requests, setRequests] = useState([]);
  const [members, setMembers] = useState([]);
  const [applications, setApplications] = useState([]);
  const [loans, setLoans] = useState([]);
  const [loanEligibilityApplications, setLoanEligibilityApplications] =
    useState([]);
  const [loanRepayments, setLoanRepayments] = useState([]);
  const [dividends, setDividends] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [selectedDividendId, setSelectedDividendId] = useState(null);
  const [selectedDividend, setSelectedDividend] = useState(null);
  const [dividendEntries, setDividendEntries] = useState([]);
  const [showCreateDividendForm, setShowCreateDividendForm] = useState(false);
  const [dividendForm, setDividendForm] = useState({
    financialYear: new Date().getFullYear(),
    pool: "",
    periodStartDate: "",
    periodEndDate: "",
    distributionDate: "",
  });
  const [dividendActionLoading, setDividendActionLoading] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [readNotificationIds, setReadNotificationIds] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("adminReadNotifications") || "[]");
    } catch {
      return [];
    }
  });

  const [viewingApplication, setViewingApplication] = useState(null);
  const [openInEditMode, setOpenInEditMode] = useState(false);
  const [expandedEligibilityId, setExpandedEligibilityId] = useState(null);
  const [showAddExistingMember, setShowAddExistingMember] = useState(false);

  /* ================================
     LOAD DATA
  ================================= */

  const loadRequests = useCallback(async () => {
    const data = await request("/admin/savings-requests", {
      token: user.token,
    });

    setRequests(data);
  }, [user.token]);

  const loadMembers = useCallback(async () => {
    const data = await request("/admin/users", {
      token: user.token,
    });

    setMembers(data);
  }, [user.token]);

  const updateNotifications = useCallback((applications) => {
    const newNotifications = applications
      .filter((application) => application.status === "pending")
      .map((application) => ({
        id: application._id,
        type: "membership",
        title: "New Membership Application",
        body: `${application.user?.fullName || "A member"} submitted a membership application.`,
        createdAt:
          application.createdAt ||
          application.submittedDate ||
          new Date().toISOString(),
        application,
      }));

    setNotifications(newNotifications);
  }, []);

  const loadApplications = useCallback(async () => {
    const data = await request("/admin/membership", {
      token: user.token,
    });

    setApplications(data);
    updateNotifications(data);
  }, [user.token, updateNotifications]);

  // Automatically check for new membership applications
  useEffect(() => {
    if (!user?.token) return;

    const checkForNewApplications = async () => {
      try {
        await loadApplications();
      } catch (err) {
        console.error("Notification polling error:", err);
      }
    };

    // Check immediately, then every 10 seconds.
    checkForNewApplications();

    const interval = setInterval(checkForNewApplications, 10000);

    return () => clearInterval(interval);
  }, [user?.token, loadApplications]);

  const loadLoans = useCallback(async () => {
    const data = await request("/admin/loans", {
      token: user.token,
    });

    setLoans(data);
  }, [user.token]);

  const loadLoanEligibilityApplications = useCallback(async () => {
    const data = await request("/admin/loan-eligibility-applications", {
      token: user.token,
    });

    setLoanEligibilityApplications(data);
  }, [user.token]);

  const loadDividends = useCallback(async () => {
    const data = await request("/admin/dividends", {
      token: user.token,
    });

    setDividends(data);
  }, [user.token]);

  const loadLoanRepayments = useCallback(async () => {
    const data = await request("/admin/loan-repayments", {
      token: user.token,
    });

    setLoanRepayments(data);
  }, [user.token]);

  const loadWithdrawals = useCallback(async () => {
    const data = await request("/admin/withdrawals", {
      token: user.token,
    });

    setWithdrawals(data);
  }, [user.token]);
  /* ================================
     LOAD DATA WHEN SECTION CHANGES
  ================================= */

  useEffect(() => {
    if (activeSection === "overview") {
      Promise.all([
        loadRequests(),
        loadMembers(),
        loadApplications(),
        loadLoans(),
        loadLoanEligibilityApplications(),
        loadLoanRepayments(),
        loadWithdrawals(),
      ]).catch((err) => {
        setError(err.message);
      });

      return;
    }

    setError("");
    setLoading(true);

    let loader;

    if (activeSection === "savings") {
      loader = loadRequests;
    } else if (activeSection === "members") {
      loader = loadMembers;
    } else if (activeSection === "membership") {
      loader = loadApplications;
    } else if (activeSection === "loan-requests") {
      loader = loadLoans;
    } else if (activeSection === "loan-eligibility") {
      loader = loadLoanEligibilityApplications;
    } else if (activeSection === "repayments") {
      loader = loadLoanRepayments;
    } else if (activeSection === "dividends") {
      loader = loadDividends;
    } else if (activeSection === "withdrawals") {
      loader = loadWithdrawals;
    }

    if (!loader) {
      setLoading(false);
      return;
    }

    loader()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [
    activeSection,
    loadRequests,
    loadMembers,
    loadApplications,
    loadLoans,
    loadLoanEligibilityApplications,
    loadLoanRepayments,
    loadDividends,
    loadWithdrawals,
  ]);

  /* ================================
     SAVINGS REQUEST ACTION
  ================================= */

  const handleRequestAction = async (id, action) => {
    try {
      setError("");

      await request(`/admin/savings-requests/${id}`, {
        method: "PATCH",
        token: user.token,
        body: { action },
      });

      await loadRequests();
    } catch (err) {
      setError(err.message);
    }
  };

  /* ================================
     EXISTING MEMBER ACCOUNT
  ================================= */

  const handleCreateExistingMember = async (memberData) => {
    try {
      setError("");

      const formData = new FormData();

      Object.entries(memberData).forEach(([key, value]) => {
        if (value === null || value === undefined || value === "") return;

        if (value instanceof File) {
          formData.append(key, value);
        } else {
          formData.append(key, value);
        }
      });

      const result = await request("/admin/members/existing", {
        method: "POST",
        token: user.token,
        body: formData,
        isFormData: true,
      });

      await loadMembers();
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  /* ================================
     MEMBERSHIP ACTION
  ================================= */

  const handleApplicationStatus = async (id, status) => {
    try {
      setError("");

      const updated = await request(`/admin/membership/${id}`, {
        method: "PATCH",
        token: user.token,
        body: { status },
      });

      await loadApplications();
      // Keep the open modal (if any) showing the fresh status immediately.
      setViewingApplication((prev) =>
        prev && prev._id === id ? updated : prev,
      );
    } catch (err) {
      setError(err.message);
    }
  };

  const handleApplicationSave = async (id, updatedFields) => {
    const updated = await request(`/admin/membership/${id}`, {
      method: "PATCH",
      token: user.token,
      body: updatedFields,
    });

    await loadApplications();
    setViewingApplication(updated);
  };

  /* ================================
   LOAN ACTION
================================ */

  const handleLoanAction = async (id, action) => {
    try {
      setError("");

      let rejectionReason = "";

      if (action === "reject") {
        rejectionReason =
          window.prompt("Enter the reason for rejecting this loan:") || "";

        if (!rejectionReason.trim()) {
          return;
        }
      }

      await request(`/admin/loans/${id}`, {
        method: "PATCH",
        token: user.token,
        body: {
          action,
          rejectionReason,
        },
      });

      await loadLoans();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDisburseLoan = async (id) => {
    try {
      setError("");

      await request(`/admin/loans/${id}/disburse`, {
        method: "PATCH",
        token: user.token,
      });

      await loadLoans();
    } catch (err) {
      setError(err.message);
    }
  };

  /* ================================
   LOAN ELIGIBILITY APPLICATION ACTION
================================ */

  const handleLoanEligibilityAction = async (id, action) => {
    try {
      setError("");

      let rejectionReason = "";

      if (action === "reject") {
        rejectionReason =
          window.prompt(
            "Enter the reason for rejecting this full loan application:",
          ) || "";

        if (!rejectionReason.trim()) {
          return;
        }
      }

      await request(`/admin/loan-eligibility-applications/${id}`, {
        method: "PATCH",
        token: user.token,
        body: {
          action,
          rejectionReason,
        },
      });

      await loadLoanEligibilityApplications();
    } catch (err) {
      setError(err.message);
    }
  };

  /* ================================
   DIVIDEND ACTIONS
================================ */

  const openDividendDetail = async (id) => {
    try {
      setError("");
      setDividendActionLoading(true);
      setSelectedDividendId(id);

      const data = await request(`/admin/dividends/${id}`, {
        token: user.token,
      });

      setSelectedDividend(data.distribution);
      setDividendEntries(data.entries);
    } catch (err) {
      setError(err.message);
    } finally {
      setDividendActionLoading(false);
    }
  };

  const closeDividendDetail = () => {
    setSelectedDividendId(null);
    setSelectedDividend(null);
    setDividendEntries([]);
  };

  const handleCreateDividend = async (e) => {
    e.preventDefault();

    try {
      setError("");
      setDividendActionLoading(true);

      await request("/admin/dividends", {
        method: "POST",
        token: user.token,
        body: {
          financialYear: Number(dividendForm.financialYear),
          pool: Number(dividendForm.pool),
          periodStartDate: dividendForm.periodStartDate,
          periodEndDate: dividendForm.periodEndDate,
          distributionDate: dividendForm.distributionDate,
        },
      });

      setShowCreateDividendForm(false);
      setDividendForm({
        financialYear: new Date().getFullYear(),
        pool: "",
        periodStartDate: "",
        periodEndDate: "",
        distributionDate: "",
      });

      await loadDividends();
    } catch (err) {
      setError(err.message);
    } finally {
      setDividendActionLoading(false);
    }
  };

  const handleCalculateDividends = async (id) => {
    try {
      setError("");
      setDividendActionLoading(true);

      const data = await request(`/admin/dividends/${id}/calculate`, {
        method: "POST",
        token: user.token,
      });

      setSelectedDividend(data.distribution);
      setDividendEntries(data.entries);

      await loadDividends();
    } catch (err) {
      setError(err.message);
    } finally {
      setDividendActionLoading(false);
    }
  };

  const handleMarkEntryPaid = async (distributionId, entryId) => {
    try {
      setError("");

      await request(`/admin/dividends/${distributionId}/entries/${entryId}`, {
        method: "PATCH",
        token: user.token,
      });

      await openDividendDetail(distributionId);
      await loadDividends();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleMarkAllDividendsPaid = async (id) => {
    try {
      setError("");
      setDividendActionLoading(true);

      const data = await request(`/admin/dividends/${id}/pay-all`, {
        method: "PATCH",
        token: user.token,
      });

      setSelectedDividend(data.distribution);
      setDividendEntries(data.entries);

      await loadDividends();
    } catch (err) {
      setError(err.message);
    } finally {
      setDividendActionLoading(false);
    }
  };

  /* ================================
   LOAN REPAYMENT ACTION
================================ */

  const handleRepaymentAction = async (id, action) => {
    try {
      setError("");

      await request(`/admin/loan-repayments/${id}`, {
        method: "PATCH",
        token: user.token,
        body: { action },
      });

      await loadLoanRepayments();
    } catch (err) {
      setError(err.message);
    }
  };

  /* ================================
     DASHBOARD STATISTICS
  ================================= */

  const totalSavings = members.reduce(
    (total, member) => total + Number(member.savingsBalance || 0),
    0,
  );

  const pendingSavingsRequests = requests.filter(
    (requestItem) => requestItem.status === "pending",
  ).length;

  const pendingApplications = applications.filter(
    (application) => application.status === "pending",
  ).length;

  const pendingRepayments = loanRepayments.filter(
    (repayment) => repayment.status === "pending",
  ).length;

  const totalLoanEligibility = members.reduce(
    (total, member) => total + Number(member.savingsBalance || 0) * 2,
    0,
  );

  /* ================================
     RENDER OVERVIEW
  ================================= */

  const renderOverview = () => {
    return (
      <>
        <div className="admin-page-heading">
          <div>
            <p className="eyebrow">Dashboard</p>
            <h1>Overview</h1>
            <p className="admin-subtitle">
              Here's what's happening with your cooperative today.
            </p>
          </div>
        </div>

        <div className="admin-stat-grid">
          <div className="admin-stat-card">
            <div className="admin-stat-icon savings-icon">₦</div>

            <div>
              <span>Total Savings</span>
              <strong>₦{totalSavings.toLocaleString()}</strong>
            </div>
          </div>

          <div className="admin-stat-card">
            <div className="admin-stat-icon members-icon">
              <FaUsers />
            </div>

            <div>
              <span>Total Members</span>
              <strong>{members.length}</strong>
            </div>
          </div>

          <div className="admin-stat-card">
            <div className="admin-stat-icon loan-icon">
              <FaHandHoldingDollar />
            </div>

            <div>
              <span>Loan Eligibility</span>
              <strong>₦{totalLoanEligibility.toLocaleString()}</strong>
            </div>
          </div>

          <div className="admin-stat-card">
            <div className="admin-stat-icon pending-icon">
              <FaClock />
            </div>

            <div>
              <span>Pending Requests</span>
              <strong>
                {pendingSavingsRequests +
                  pendingApplications +
                  pendingRepayments}
              </strong>
            </div>
          </div>
        </div>

        <div className="admin-overview-grid">
          <section className="admin-card">
            <div className="admin-card-header">
              <div>
                <p className="eyebrow">Savings</p>
                <h2>Savings Overview</h2>
              </div>

              <button
                className="admin-link-btn"
                onClick={() => setActiveSection("savings")}
              >
                View Requests
              </button>
            </div>

            <div className="admin-big-number">
              ₦{totalSavings.toLocaleString()}
            </div>

            <p className="admin-muted">
              Total savings currently recorded across members.
            </p>

            <div className="admin-progress">
              <div
                className="admin-progress-bar"
                style={{
                  width:
                    members.length > 0
                      ? `${Math.min((totalSavings / 1000000) * 100, 100)}%`
                      : "0%",
                }}
              />
            </div>
          </section>

          <section className="admin-card">
            <div className="admin-card-header">
              <div>
                <p className="eyebrow">Membership</p>
                <h2>Applications</h2>
              </div>

              <button
                className="admin-link-btn"
                onClick={() => setActiveSection("membership")}
              >
                Review
              </button>
            </div>

            <div className="admin-big-number">{pendingApplications}</div>

            <p className="admin-muted">
              Membership applications waiting for review.
            </p>

            <div className="admin-mini-stat">
              <span>Total applications</span>
              <strong>{applications.length}</strong>
            </div>
          </section>
        </div>

        <section className="admin-card admin-recent-section">
          <div className="admin-card-header">
            <div>
              <p className="eyebrow">Activity</p>
              <h2>Recent Savings Requests</h2>
            </div>

            <button
              className="admin-link-btn"
              onClick={() => setActiveSection("savings")}
            >
              View All
            </button>
          </div>

          {requests.length === 0 ? (
            <p className="empty-state">No savings requests yet.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Amount</th>
                    <th>Method</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>

                <tbody>
                  {requests.slice(0, 5).map((r) => (
                    <tr key={r._id}>
                      <td>
                        <strong>{r.user?.fullName || "—"}</strong>
                        <br />
                        <span className="muted">{r.user?.email}</span>
                      </td>

                      <td>₦{Number(r.amount || 0).toLocaleString()}</td>

                      <td>{r.method === "paystack" ? "Paystack" : "Manual"}</td>

                      <td>
                        <span className={`status-badge ${r.status}`}>
                          {r.status}
                        </span>
                      </td>

                      <td>{new Date(r.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </>
    );
  };

  /* ================================
     SAVINGS REQUESTS
  ================================= */

  const renderSavings = () => {
    return (
      <>
        <div className="admin-page-heading">
          <div>
            <p className="eyebrow">Savings</p>
            <h1>Savings & Deposits</h1>
            <p className="admin-subtitle">
              Review and manage member savings requests.
            </p>
          </div>
        </div>

        <section className="admin-card">
          {requests.length === 0 ? (
            <p className="empty-state">No savings requests yet.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Amount</th>
                    <th>Method</th>
                    <th>Status</th>
                    <th>Requested</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {requests.map((r) => (
                    <tr key={r._id}>
                      <td>
                        {r.user?.fullName || "—"}
                        <br />
                        <span className="muted">{r.user?.email}</span>
                      </td>

                      <td>₦{Number(r.amount || 0).toLocaleString()}</td>

                      <td>{r.method === "paystack" ? "Paystack" : "Manual"}</td>

                      <td>
                        <span className={`status-badge ${r.status}`}>
                          {r.status}
                        </span>
                      </td>

                      <td>{new Date(r.createdAt).toLocaleDateString()}</td>

                      <td className="actions-cell">
                        {r.status === "pending" && (
                          <>
                            <button
                              className="approve-btn"
                              onClick={() =>
                                handleRequestAction(r._id, "approve")
                              }
                            >
                              Approve
                            </button>

                            <button
                              className="reject-btn"
                              onClick={() =>
                                handleRequestAction(r._id, "reject")
                              }
                            >
                              Reject
                            </button>
                          </>
                        )}
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
  };

  /* ================================
   LOAN REQUESTS
================================ */

  const renderLoans = () => {
    return (
      <>
        <div className="admin-page-heading">
          <div>
            <p className="eyebrow">Loans</p>
            <h1>Loan Requests</h1>
            <p className="admin-subtitle">
              Review, approve, or reject member loan applications.
            </p>
          </div>
        </div>

        <section className="admin-card">
          {loans.length === 0 ? (
            <p className="empty-state">No loan applications yet.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Loan Type</th>
                    <th>Amount</th>
                    <th>Outstanding</th>
                    <th>Savings</th>
                    <th>Eligible</th>
                    <th>Term</th>
                    <th>Status</th>
                    <th>Application Date</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {loans.map((loan) => (
                    <tr key={loan._id}>
                      <td>
                        <strong>{loan.user?.fullName || "—"}</strong>
                        <br />
                        <span className="muted">{loan.user?.email || "—"}</span>
                      </td>

                      <td>
                        <span className="loan-type-badge">{loan.loanType}</span>
                      </td>

                      <td>₦{Number(loan.amount || 0).toLocaleString()}</td>

                      <td>
                        ₦{Number(loan.outstandingBalance || 0).toLocaleString()}
                      </td>

                      <td>
                        ₦
                        {Number(
                          loan.savingsAtApplication || 0,
                        ).toLocaleString()}
                      </td>

                      <td>
                        ₦{Number(loan.eligibleAmount || 0).toLocaleString()}
                      </td>

                      <td>{loan.termMonths} months</td>

                      <td>
                        <span className={`status-badge ${loan.status}`}>
                          {loan.status}
                        </span>
                      </td>

                      <td>
                        {loan.applicationDate
                          ? new Date(loan.applicationDate).toLocaleDateString()
                          : "—"}
                      </td>

                      <td className="actions-cell">
                        {loan.status === "pending" && (
                          <>
                            <button
                              className="approve-btn"
                              onClick={() =>
                                handleLoanAction(loan._id, "approve")
                              }
                            >
                              Approve
                            </button>

                            <button
                              className="reject-btn"
                              onClick={() =>
                                handleLoanAction(loan._id, "reject")
                              }
                            >
                              Reject
                            </button>
                          </>
                        )}

                        {loan.status === "approved" && (
                          <button
                            className="approve-btn"
                            onClick={() => handleDisburseLoan(loan._id)}
                          >
                            Disburse Loan
                          </button>
                        )}

                        {loan.status === "rejected" && (
                          <span className="muted">Rejected</span>
                        )}
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
  };

  /* ================================
     LOAN REPAYMENTS
  ================================= */

  const renderRepayments = () => {
    return (
      <>
        <div className="admin-page-heading">
          <div>
            <p className="eyebrow">Repayments</p>
            <h1>Loan Repayments</h1>
            <p className="admin-subtitle">
              Confirm repayments members have recorded against active loans.
            </p>
          </div>
        </div>

        <section className="admin-card">
          {loanRepayments.length === 0 ? (
            <p className="empty-state">No repayment requests yet.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Loan Type</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Submitted</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {loanRepayments.map((r) => (
                    <tr key={r._id}>
                      <td>
                        {r.user?.fullName || "—"}
                        <br />
                        <span className="muted">{r.user?.email}</span>
                      </td>

                      <td>
                        <span className="loan-type-badge">
                          {r.loan?.loanType || "—"}
                        </span>
                      </td>

                      <td>₦{Number(r.amount || 0).toLocaleString()}</td>

                      <td>
                        <span className={`status-badge ${r.status}`}>
                          {r.status}
                        </span>
                      </td>

                      <td>{new Date(r.createdAt).toLocaleDateString()}</td>

                      <td className="actions-cell">
                        {r.status === "pending" && (
                          <>
                            <button
                              className="approve-btn"
                              onClick={() =>
                                handleRepaymentAction(r._id, "approve")
                              }
                            >
                              Approve
                            </button>

                            <button
                              className="reject-btn"
                              onClick={() =>
                                handleRepaymentAction(r._id, "reject")
                              }
                            >
                              Reject
                            </button>
                          </>
                        )}
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
  };

  /* ================================
     WITHDRAWALS
  ================================= */

  const handleWithdrawalSync = async (id) => {
    try {
      setError("");

      const result = await request(`/admin/withdrawals/${id}/sync`, {
        method: "POST",
        token: user.token,
      });

      console.log("WITHDRAWAL SYNC RESULT:", result);

      await loadWithdrawals();

      alert(
        `Withdrawal status: ${
          result.status ||
          result.data?.status ||
          result.withdrawal?.status ||
          "unknown"
        }`,
      );
    } catch (err) {
      console.error("WITHDRAWAL SYNC ERROR:", err);

      setError(err.message);

      alert(`Sync failed: ${err.message}`);
    }
  };

  const renderWithdrawals = () => {
    const processing = withdrawals.filter(
      (item) => item.status === "processing",
    );
    const successful = withdrawals.filter((item) => item.status === "success");
    const totalPaid = successful.reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0,
    );

    return (
      <>
        <div className="admin-page-heading">
          <div>
            <p className="eyebrow">Finance</p>
            <h1>Withdrawals</h1>
            <p className="admin-subtitle">
              Monitor member withdrawal requests and Paystack transfer status.
              Withdrawals are paid automatically after the member confirms with
              their password.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={loadWithdrawals}
          >
            Refresh
          </button>
        </div>

        <div className="admin-stat-grid">
          <div className="admin-stat-card">
            <div>
              <span>Processing</span>
              <strong>{processing.length}</strong>
            </div>
          </div>
          <div className="admin-stat-card">
            <div>
              <span>Paid Withdrawals</span>
              <strong>{successful.length}</strong>
            </div>
          </div>
          <div className="admin-stat-card">
            <div>
              <span>Total Paid</span>
              <strong>₦{totalPaid.toLocaleString()}</strong>
            </div>
          </div>
          <div className="admin-stat-card">
            <div>
              <span>Total Records</span>
              <strong>{withdrawals.length}</strong>
            </div>
          </div>
        </div>

        <section className="admin-card">
          {withdrawals.length === 0 ? (
            <p className="empty-state">No withdrawal records yet.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Amount</th>
                    <th>Bank</th>
                    <th>Account</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {withdrawals.map((item) => (
                    <tr key={item._id}>
                      <td>
                        <strong>{item.user?.fullName || "—"}</strong>
                        <br />
                        <span className="muted">{item.user?.email || "—"}</span>
                      </td>
                      <td>₦{Number(item.amount || 0).toLocaleString()}</td>
                      <td>{item.bankName}</td>
                      <td>
                        {item.accountName}
                        <br />
                        <span className="muted">
                          ····{item.accountNumberLast4}
                        </span>
                      </td>
                      <td>
                        <span className={`status-badge ${item.status}`}>
                          {item.status}
                        </span>
                      </td>
                      <td>
                        {item.createdAt
                          ? new Date(item.createdAt).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="actions-cell">
                        {item.status === "processing" ? (
                          <button
                            className="view-btn"
                            onClick={() => handleWithdrawalSync(item._id)}
                          >
                            Sync Status
                          </button>
                        ) : (
                          <span className="muted">—</span>
                        )}
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
  };

  /* ================================
     DIVIDENDS
  ================================= */

  const renderDividends = () => {
    if (selectedDividendId) {
      return (
        <>
          <div className="admin-page-heading">
            <div>
              <p className="eyebrow">Dividends</p>
              <h1>
                {selectedDividend
                  ? `${selectedDividend.financialYear} Dividend Distribution`
                  : "Dividend Distribution"}
              </h1>
              <p className="admin-subtitle">
                Only interest-bearing members with fully settled loans in the
                selected period are eligible. Shares are based on the loan
                interest actually paid by each member.
              </p>
            </div>

            <button
              type="button"
              className="btn-secondary"
              onClick={closeDividendDetail}
            >
              Back to Dividends
            </button>
          </div>

          {selectedDividend && (
            <section className="admin-card dividend-summary-card">
              <div>
                <strong>Pool</strong>
                <span>₦{Number(selectedDividend.pool).toLocaleString()}</span>
              </div>

              <div>
                <strong>Status</strong>
                <span className={`status-badge ${selectedDividend.status}`}>
                  {selectedDividend.status}
                </span>
              </div>

              <div>
                <strong>Total Eligible Interest</strong>
                <span>
                  ₦
                  {Number(
                    selectedDividend.totalEligibleInterest || 0,
                  ).toLocaleString()}
                </span>
              </div>

              <div>
                <strong>Distribution Date</strong>
                <span>{selectedDividend.distributionDate || "—"}</span>
              </div>

              <div className="dividend-summary-actions">
                {selectedDividend.status !== "completed" && (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={dividendActionLoading}
                    onClick={() =>
                      handleCalculateDividends(selectedDividend._id)
                    }
                  >
                    {selectedDividend.status === "draft"
                      ? "Calculate Dividends"
                      : "Recalculate Dividends"}
                  </button>
                )}

                {selectedDividend.status === "calculated" &&
                  dividendEntries.length > 0 && (
                    <button
                      type="button"
                      className="approve-btn"
                      disabled={dividendActionLoading}
                      onClick={() =>
                        handleMarkAllDividendsPaid(selectedDividend._id)
                      }
                    >
                      Mark All Paid
                    </button>
                  )}
              </div>
            </section>
          )}

          <section className="admin-card">
            {dividendEntries.length === 0 ? (
              <p className="empty-state">
                {selectedDividend?.status === "draft"
                  ? 'Not calculated yet — click "Calculate Dividends" to generate each member\'s share.'
                  : "No eligible members found for this distribution."}
              </p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Interest Paid</th>
                      <th>Dividend</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>

                  <tbody>
                    {dividendEntries.map((entry) => (
                      <tr key={entry._id}>
                        <td>
                          <strong>{entry.user?.fullName || "—"}</strong>
                          <br />
                          <span className="muted">
                            {entry.user?.email || "—"}
                          </span>
                        </td>

                        <td>
                          ₦
                          {Number(
                            entry.qualifyingInterest || entry.contribution || 0,
                          ).toLocaleString()}
                        </td>

                        <td>
                          ₦{Number(entry.dividendAmount || 0).toLocaleString()}
                        </td>

                        <td>
                          <span className={`status-badge ${entry.status}`}>
                            {entry.status}
                          </span>
                        </td>

                        <td className="actions-cell">
                          {entry.status === "pending" && (
                            <button
                              className="approve-btn"
                              onClick={() =>
                                handleMarkEntryPaid(
                                  selectedDividendId,
                                  entry._id,
                                )
                              }
                            >
                              Mark Paid
                            </button>
                          )}
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

    return (
      <>
        <div className="admin-page-heading">
          <div>
            <p className="eyebrow">Dividends</p>
            <h1>Dividends</h1>
            <p className="admin-subtitle">
              Create a dividend pool from the cooperative's accumulated interest
              and distribute it among interest-bearing members based on
              qualifying loan interest actually paid during the selected period.
            </p>
          </div>

          <button
            type="button"
            className="btn-primary"
            onClick={() => setShowCreateDividendForm((prev) => !prev)}
          >
            {showCreateDividendForm ? "Cancel" : "Create Dividend"}
          </button>
        </div>

        {showCreateDividendForm && (
          <section className="admin-card">
            <form
              className="dividend-create-form"
              onSubmit={handleCreateDividend}
            >
              <div className="form-group">
                <label htmlFor="financialYear">Financial Year</label>
                <input
                  id="financialYear"
                  type="number"
                  min="2000"
                  required
                  value={dividendForm.financialYear}
                  onChange={(e) =>
                    setDividendForm((prev) => ({
                      ...prev,
                      financialYear: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="form-group">
                <label htmlFor="pool">
                  Dividend Pool from Accumulated Interest (₦)
                </label>
                <input
                  id="pool"
                  type="number"
                  min="1"
                  required
                  placeholder="e.g. 7000000"
                  value={dividendForm.pool}
                  onChange={(e) =>
                    setDividendForm((prev) => ({
                      ...prev,
                      pool: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="form-group">
                <label htmlFor="periodStartDate">Interest Period Start</label>
                <input
                  id="periodStartDate"
                  type="date"
                  required
                  value={dividendForm.periodStartDate}
                  onChange={(e) =>
                    setDividendForm((prev) => ({
                      ...prev,
                      periodStartDate: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="form-group">
                <label htmlFor="periodEndDate">Interest Period End</label>
                <input
                  id="periodEndDate"
                  type="date"
                  required
                  value={dividendForm.periodEndDate}
                  onChange={(e) =>
                    setDividendForm((prev) => ({
                      ...prev,
                      periodEndDate: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="form-group">
                <label htmlFor="distributionDate">Distribution Date</label>
                <input
                  id="distributionDate"
                  type="date"
                  value={dividendForm.distributionDate}
                  onChange={(e) =>
                    setDividendForm((prev) => ({
                      ...prev,
                      distributionDate: e.target.value,
                    }))
                  }
                />
              </div>

              <button
                type="submit"
                className="btn-primary"
                disabled={dividendActionLoading}
              >
                {dividendActionLoading ? "Creating..." : "Save Dividend"}
              </button>
            </form>
          </section>
        )}

        <section className="admin-card">
          {dividends.length === 0 ? (
            <p className="empty-state">No dividend distributions yet.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Financial Year</th>
                    <th>Pool</th>
                    <th>Status</th>
                    <th>Distribution Date</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {dividends.map((d) => (
                    <tr key={d._id}>
                      <td>{d.financialYear}</td>

                      <td>₦{Number(d.pool || 0).toLocaleString()}</td>

                      <td>
                        <span className={`status-badge ${d.status}`}>
                          {d.status}
                        </span>
                      </td>

                      <td>{d.distributionDate || "—"}</td>

                      <td className="actions-cell">
                        <button
                          className="view-btn"
                          onClick={() => openDividendDetail(d._id)}
                        >
                          View
                        </button>
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
  };

  /* ================================
     MEMBERS
  ================================= */

  const renderMembers = () => {
    return (
      <>
        <div className="admin-page-heading">
          <div>
            <p className="eyebrow">Members</p>
            <h1>Members</h1>
            <p className="admin-subtitle">
              View cooperative members and their savings.
            </p>
          </div>

          <button
            type="button"
            className="admin-primary-btn"
            onClick={() => setShowAddExistingMember(true)}
          >
            + Add Existing Member
          </button>
        </div>

        <section className="admin-card">
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Membership Type</th>
                  <th>Savings Balance</th>
                  <th>Loan Eligibility</th>
                  <th>Account Setup</th>
                  <th>Joined</th>
                </tr>
              </thead>

              <tbody>
                {members.map((m) => (
                  <tr key={m._id}>
                    <td>{m.fullName}</td>
                    <td>{m.email}</td>

                    <td>
                      <span
                        className={`status-badge ${
                          m.role === "admin" ? "approved" : "pending"
                        }`}
                      >
                        {m.role}
                      </span>
                    </td>

                    <td>
                      {m.membershipType ? (
                        <span className="loan-type-badge">
                          {m.membershipType === "interest-free"
                            ? "Interest-Free"
                            : "Interest-Bearing"}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>

                    <td>₦{Number(m.savingsBalance || 0).toLocaleString()}</td>

                    <td>
                      ₦{(Number(m.savingsBalance || 0) * 2).toLocaleString()}
                    </td>

                    <td>
                      <span
                        className={`status-badge ${m.mustChangePassword ? "pending" : "approved"}`}
                      >
                        {m.mustChangePassword ? "Password Pending" : "Ready"}
                      </span>
                    </td>

                    <td>{new Date(m.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </>
    );
  };

  /* ================================
     MEMBERSHIP APPLICATIONS
  ================================= */

  const renderMembership = () => {
    return (
      <>
        <div className="admin-page-heading">
          <div>
            <p className="eyebrow">Membership</p>
            <h1>Membership Applications</h1>
            <p className="admin-subtitle">
              Review applications submitted by new members.
            </p>
          </div>
        </div>

        <section className="admin-card">
          {applications.length === 0 ? (
            <p className="empty-state">No membership applications yet.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Applicant</th>
                    <th>Phone</th>
                    <th>Category</th>
                    <th>Type</th>
                    <th>Proposed Amount</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {applications.map((a) => (
                    <tr key={a._id}>
                      <td>
                        {a.fullName}
                        <br />
                        <span className="muted">{a.email}</span>
                      </td>

                      <td>{a.phone}</td>

                      <td>{a.membershipCategory}</td>

                      <td>
                        <span className="loan-type-badge">
                          {a.membershipType === "interest-free"
                            ? "Interest-Free"
                            : "Interest-Bearing"}
                        </span>
                      </td>

                      <td>₦{Number(a.proposedAmount || 0).toLocaleString()}</td>

                      <td>
                        <span className={`status-badge ${a.status}`}>
                          {a.status}
                        </span>
                      </td>

                      <td className="actions-cell">
                        <button
                          className="view-btn"
                          onClick={() => {
                            setOpenInEditMode(false);
                            setViewingApplication(a);
                          }}
                        >
                          View
                        </button>

                        <button
                          className="update-btn"
                          onClick={() => {
                            setOpenInEditMode(true);
                            setViewingApplication(a);
                          }}
                        >
                          Update
                        </button>

                        {a.status === "pending" && (
                          <>
                            <button
                              className="approve-btn"
                              onClick={() =>
                                handleApplicationStatus(a._id, "approved")
                              }
                            >
                              Approve
                            </button>

                            <button
                              className="reject-btn"
                              onClick={() =>
                                handleApplicationStatus(a._id, "rejected")
                              }
                            >
                              Reject
                            </button>
                          </>
                        )}
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
  };

  /* ================================
     LOAN ELIGIBILITY APPLICATIONS
     (Full Loan Application: BVN + bio-data review)
  ================================= */

  const renderLoanEligibility = () => {
    return (
      <>
        <div className="admin-page-heading">
          <div>
            <p className="eyebrow">Loans</p>
            <h1>Full Loan Applications</h1>
            <p className="admin-subtitle">
              Review a member's BVN and bio-data before they're allowed to apply
              for an actual loan. Approving here sets them as loan eligible.
            </p>
          </div>
        </div>

        <section className="admin-card">
          {loanEligibilityApplications.length === 0 ? (
            <p className="empty-state">No full loan applications yet.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>BVN</th>
                    <th>Occupation</th>
                    <th>Status</th>
                    <th>Submitted</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {loanEligibilityApplications.map((application) => (
                    <Fragment key={application._id}>
                      <tr>
                        <td>
                          <strong>{application.user?.fullName || "—"}</strong>
                          <br />
                          <span className="muted">
                            {application.user?.email || "—"}
                          </span>
                        </td>

                        <td>{application.bvn}</td>

                        <td>
                          {application.applicantDetails?.occupation || "—"}
                        </td>

                        <td>
                          <span
                            className={`status-badge ${application.status}`}
                          >
                            {application.status}
                          </span>
                        </td>

                        <td>
                          {application.submittedDate
                            ? new Date(
                                application.submittedDate,
                              ).toLocaleDateString()
                            : "—"}
                        </td>

                        <td className="actions-cell">
                          <button
                            className="view-btn"
                            onClick={() =>
                              setExpandedEligibilityId((prev) =>
                                prev === application._id
                                  ? null
                                  : application._id,
                              )
                            }
                          >
                            {expandedEligibilityId === application._id
                              ? "Hide"
                              : "View"}
                          </button>

                          {application.status === "pending" && (
                            <>
                              <button
                                className="approve-btn"
                                onClick={() =>
                                  handleLoanEligibilityAction(
                                    application._id,
                                    "approve",
                                  )
                                }
                              >
                                Approve
                              </button>

                              <button
                                className="reject-btn"
                                onClick={() =>
                                  handleLoanEligibilityAction(
                                    application._id,
                                    "reject",
                                  )
                                }
                              >
                                Reject
                              </button>
                            </>
                          )}
                        </td>
                      </tr>

                      {expandedEligibilityId === application._id && (
                        <tr className="loan-details-row">
                          <td colSpan={6}>
                            <div className="full-application-details">
                              <div>
                                <strong>Phone</strong>
                                <span>
                                  {application.applicantDetails?.phone || "—"}
                                </span>
                              </div>

                              <div>
                                <strong>Email</strong>
                                <span>
                                  {application.applicantDetails?.email || "—"}
                                </span>
                              </div>

                              <div>
                                <strong>Address</strong>
                                <span>
                                  {application.applicantDetails?.address || "—"}
                                </span>
                              </div>

                              <div>
                                <strong>Employment Status</strong>
                                <span>
                                  {application.applicantDetails
                                    ?.employmentStatus || "—"}
                                </span>
                              </div>

                              <div>
                                <strong>Next of Kin</strong>
                                <span>
                                  {application.applicantDetails?.kinName || "—"}
                                  {application.applicantDetails?.kinPhone
                                    ? ` (${application.applicantDetails.kinPhone})`
                                    : ""}
                                </span>
                              </div>

                              {application.status === "rejected" &&
                                application.rejectionReason && (
                                  <div className="full-application-purpose">
                                    <strong>Rejection Reason</strong>
                                    <span>{application.rejectionReason}</span>
                                  </div>
                                )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </>
    );
  };

  /* ================================
     LOANS
  ================================= */

  const renderLoansManagement = () => {
    const activeLoans = loans.filter((loan) =>
      ["approved", "disbursed", "active"].includes(
        String(loan.status).toLowerCase(),
      ),
    );
    const totalDisbursed = loans.reduce(
      (sum, loan) =>
        sum +
        (["approved", "disbursed", "active"].includes(
          String(loan.status).toLowerCase(),
        )
          ? Number(loan.amount || 0)
          : 0),
      0,
    );
    const outstanding = loans.reduce(
      (sum, loan) => sum + Number(loan.outstandingBalance || 0),
      0,
    );

    return (
      <>
        <div className="admin-page-heading">
          <div>
            <p className="eyebrow">Loans</p>
            <h1>Loans</h1>
            <p className="admin-subtitle">
              Monitor approved, disbursed, and active cooperative loans.
            </p>
          </div>
          <button type="button" className="btn-secondary" onClick={loadLoans}>
            Refresh
          </button>
        </div>

        <div className="admin-stat-grid">
          <div className="admin-stat-card">
            <div>
              <span>Active Loans</span>
              <strong>{activeLoans.length}</strong>
            </div>
          </div>
          <div className="admin-stat-card">
            <div>
              <span>Total Disbursed</span>
              <strong>₦{totalDisbursed.toLocaleString()}</strong>
            </div>
          </div>
          <div className="admin-stat-card">
            <div>
              <span>Outstanding</span>
              <strong>₦{outstanding.toLocaleString()}</strong>
            </div>
          </div>
          <div className="admin-stat-card">
            <div>
              <span>Total Loan Records</span>
              <strong>{loans.length}</strong>
            </div>
          </div>
        </div>

        <section className="admin-card">
          {loans.length === 0 ? (
            <p className="empty-state">No loan records found.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Outstanding</th>
                    <th>Term</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {loans.map((loan) => (
                    <tr key={loan._id}>
                      <td>
                        <strong>{loan.user?.fullName || "—"}</strong>
                        <br />
                        <span className="muted">{loan.user?.email || "—"}</span>
                      </td>
                      <td>
                        <span className="loan-type-badge">
                          {loan.loanType || "—"}
                        </span>
                      </td>
                      <td>₦{Number(loan.amount || 0).toLocaleString()}</td>
                      <td>
                        ₦{Number(loan.outstandingBalance || 0).toLocaleString()}
                      </td>
                      <td>
                        {loan.termMonths ? `${loan.termMonths} months` : "—"}
                      </td>
                      <td>
                        <span className={`status-badge ${loan.status}`}>
                          {loan.status || "—"}
                        </span>
                      </td>
                      <td>
                        {loan.applicationDate
                          ? new Date(loan.applicationDate).toLocaleDateString()
                          : "—"}
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
  };

  /* ================================
     TRANSACTIONS
  ================================= */

  const renderTransactions = () => {
    const transactions = [
      ...requests.map((item) => ({
        id: `s-${item._id}`,
        date: item.createdAt,
        member: item.user?.fullName || "—",
        type: "Savings",
        direction: "Money In",
        amount: Number(item.amount || 0),
        status: item.status,
        reference: item.reference || item._id,
      })),
      ...loanRepayments.map((item) => ({
        id: `r-${item._id}`,
        date: item.createdAt,
        member: item.user?.fullName || "—",
        type: "Loan Repayment",
        direction: "Money In",
        amount: Number(item.amount || 0),
        status: item.status,
        reference: item.reference || item._id,
      })),
      ...loans
        .filter((item) =>
          ["disbursed", "active"].includes(String(item.status).toLowerCase()),
        )
        .map((item) => ({
          id: `l-${item._id}`,
          date: item.disbursementDate || item.applicationDate || item.createdAt,
          member: item.user?.fullName || "—",
          type: "Loan Disbursement",
          direction: "Money Out",
          amount: Number(item.amount || 0),
          status: item.status,
          reference: item.reference || item._id,
        })),
    ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    const moneyIn = transactions
      .filter(
        (item) => item.direction === "Money In" && item.status === "approved",
      )
      .reduce((sum, item) => sum + item.amount, 0);

    const moneyOut = transactions
      .filter(
        (item) => item.direction === "Money Out" && item.status !== "rejected",
      )
      .reduce((sum, item) => sum + item.amount, 0);

    return (
      <>
        <div className="admin-page-heading">
          <div>
            <p className="eyebrow">Finance</p>
            <h1>Transactions</h1>
            <p className="admin-subtitle">
              View financial activity recorded in the cooperative system.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              Promise.all([loadRequests(), loadLoanRepayments(), loadLoans()])
            }
          >
            Refresh
          </button>
        </div>

        <div className="admin-stat-grid">
          <div className="admin-stat-card">
            <div>
              <span>Money In</span>
              <strong>₦{moneyIn.toLocaleString()}</strong>
            </div>
          </div>
          <div className="admin-stat-card">
            <div>
              <span>Money Out</span>
              <strong>₦{moneyOut.toLocaleString()}</strong>
            </div>
          </div>
          <div className="admin-stat-card">
            <div>
              <span>Transactions</span>
              <strong>{transactions.length}</strong>
            </div>
          </div>
          <div className="admin-stat-card">
            <div>
              <span>Net Movement</span>
              <strong>₦{(moneyIn - moneyOut).toLocaleString()}</strong>
            </div>
          </div>
        </div>

        <section className="admin-card">
          {transactions.length === 0 ? (
            <p className="empty-state">No transactions found.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Member</th>
                    <th>Type</th>
                    <th>Reference</th>
                    <th>Direction</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((transaction) => (
                    <tr key={transaction.id}>
                      <td>
                        {transaction.date
                          ? new Date(transaction.date).toLocaleDateString()
                          : "—"}
                      </td>
                      <td>{transaction.member}</td>
                      <td>{transaction.type}</td>
                      <td>{transaction.reference}</td>
                      <td>{transaction.direction}</td>
                      <td>₦{transaction.amount.toLocaleString()}</td>
                      <td>
                        <span className={`status-badge ${transaction.status}`}>
                          {transaction.status}
                        </span>
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
  };

  /* ================================
     REPORTS
  ================================= */

  const renderReports = () => {
    const approvedMembers = members.filter((member) => member.role !== "admin");
    const totalSavingsReport = approvedMembers.reduce(
      (sum, member) => sum + Number(member.savingsBalance || 0),
      0,
    );
    const totalLoanAmount = loans.reduce(
      (sum, loan) => sum + Number(loan.amount || 0),
      0,
    );
    const totalOutstanding = loans.reduce(
      (sum, loan) => sum + Number(loan.outstandingBalance || 0),
      0,
    );
    const totalRepayments = loanRepayments
      .filter((item) => item.status === "approved")
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const totalDividendPaid = dividends.reduce(
      (sum, item) => sum + Number(item.paidAmount || 0),
      0,
    );

    return (
      <>
        <div className="admin-page-heading">
          <div>
            <p className="eyebrow">Reports</p>
            <h1>Reports</h1>
            <p className="admin-subtitle">
              Financial and membership summaries based on current records.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              Promise.all([
                loadMembers(),
                loadLoans(),
                loadLoanRepayments(),
                loadDividends(),
                loadRequests(),
              ])
            }
          >
            Refresh Data
          </button>
        </div>

        <div className="admin-stat-grid">
          <div className="admin-stat-card">
            <div>
              <span>Members</span>
              <strong>{approvedMembers.length}</strong>
            </div>
          </div>
          <div className="admin-stat-card">
            <div>
              <span>Total Savings</span>
              <strong>₦{totalSavingsReport.toLocaleString()}</strong>
            </div>
          </div>
          <div className="admin-stat-card">
            <div>
              <span>Total Loans</span>
              <strong>₦{totalLoanAmount.toLocaleString()}</strong>
            </div>
          </div>
          <div className="admin-stat-card">
            <div>
              <span>Outstanding Loans</span>
              <strong>₦{totalOutstanding.toLocaleString()}</strong>
            </div>
          </div>
        </div>

        <section className="admin-card">
          <div className="admin-card-header">
            <div>
              <p className="eyebrow">Financial Summary</p>
              <h2>Cooperative Report</h2>
            </div>
          </div>

          <div className="admin-mini-stat">
            <span>Approved Repayments</span>
            <strong>₦{totalRepayments.toLocaleString()}</strong>
          </div>
          <div className="admin-mini-stat">
            <span>Dividend Records</span>
            <strong>{dividends.length}</strong>
          </div>
          <div className="admin-mini-stat">
            <span>Recorded Dividend Paid Amount</span>
            <strong>₦{totalDividendPaid.toLocaleString()}</strong>
          </div>
          <div className="admin-mini-stat">
            <span>Membership Applications</span>
            <strong>{applications.length}</strong>
          </div>
          <div className="admin-mini-stat">
            <span>Loan Applications</span>
            <strong>{loans.length}</strong>
          </div>
        </section>
      </>
    );
  };

  /* ================================
     SETTINGS
  ================================= */

  const renderSettings = () => {
    return (
      <>
        <div className="admin-page-heading">
          <div>
            <p className="eyebrow">Administration</p>
            <h1>Settings</h1>
            <p className="admin-subtitle">
              Manage administrator and cooperative configuration.
            </p>
          </div>
        </div>

        <section className="admin-card">
          <div className="admin-card-header">
            <div>
              <p className="eyebrow">Administrator</p>
              <h2>Account Information</h2>
            </div>
          </div>

          <div className="admin-mini-stat">
            <span>Name</span>
            <strong>{user?.fullName || "—"}</strong>
          </div>
          <div className="admin-mini-stat">
            <span>Email</span>
            <strong>{user?.email || "—"}</strong>
          </div>
          <div className="admin-mini-stat">
            <span>Role</span>
            <strong>{user?.role || "Administrator"}</strong>
          </div>
        </section>

        <section className="admin-card">
          <div className="admin-card-header">
            <div>
              <p className="eyebrow">System</p>
              <h2>Current Dashboard Status</h2>
            </div>
          </div>

          <div className="admin-mini-stat">
            <span>Members loaded</span>
            <strong>{members.length}</strong>
          </div>
          <div className="admin-mini-stat">
            <span>Loan records loaded</span>
            <strong>{loans.length}</strong>
          </div>
          <div className="admin-mini-stat">
            <span>Dividend distributions loaded</span>
            <strong>{dividends.length}</strong>
          </div>
        </section>
      </>
    );
  };

  /* ================================
     SELECT CONTENT
  ================================= */

  const renderContent = () => {
    switch (activeSection) {
      case "overview":
        return renderOverview();

      case "members":
        return renderMembers();

      case "membership":
        return renderMembership();

      case "savings":
        return renderSavings();

      case "loans":
        return renderLoansManagement();

      case "loan-eligibility":
        return renderLoanEligibility();

      case "loan-requests":
        return renderLoans();

      case "repayments":
        return renderRepayments();

      case "dividends":
        return renderDividends();

      case "transactions":
        return renderTransactions();

      case "withdrawals":
        return renderWithdrawals();

      case "reports":
        return renderReports();

      case "settings":
        return renderSettings();

      default:
        return renderOverview();
    }
  };

  return (
    <div className="admin-layout">
      <AdminSidebar
        activeSection={activeSection}
        onNavigate={setActiveSection}
        onLogout={logout}
      />

      <main className="admin-main">
        <header className="admin-topbar">
          <div>
            <p className="admin-topbar-label">Exclusive Cooperative</p>
            <h2>Administration</h2>
          </div>

          <div className="admin-topbar-actions">
            <AdminNotifications
              applications={applications}
              requests={requests}
              loans={loans}
              loanEligibilityApplications={loanEligibilityApplications}
              loanRepayments={loanRepayments}
              withdrawals={withdrawals}
              onNavigate={setActiveSection}
            />

            <div className="admin-user">
              <div className="admin-user-avatar">
                {user?.fullName?.charAt(0)?.toUpperCase() || "A"}
              </div>

              <div className="admin-user-info">
                <strong>{user?.fullName}</strong>
                <span>Administrator</span>
              </div>
            </div>
          </div>
        </header>

        <div className="admin-content">
          {error && <div className="form-error admin-error">{error}</div>}

          {loading && <div className="admin-loading">Loading...</div>}

          {!loading && renderContent()}
        </div>
      </main>

      <AddExistingMemberModal
        open={showAddExistingMember}
        onClose={() => setShowAddExistingMember(false)}
        onCreate={handleCreateExistingMember}
      />

      {viewingApplication && (
        <MembershipModal
          application={viewingApplication}
          startInEditMode={openInEditMode}
          onClose={() => setViewingApplication(null)}
          onSave={handleApplicationSave}
          onStatusChange={handleApplicationStatus}
        />
      )}
    </div>
  );
}

export default AdminDashboard;
