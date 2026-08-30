import { useEffect, useRef, useState } from "react";
import { FaBell } from "react-icons/fa6";

function AdminNotifications({
  applications = [],
  requests = [],
  loans = [],
  loanEligibilityApplications = [],
  loanRepayments = [],
  withdrawals = [],
  onNavigate,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [readIds, setReadIds] = useState(() => {
    try {
      return JSON.parse(
        localStorage.getItem("adminNotificationReadIds") || "[]",
      );
    } catch {
      return [];
    }
  });

  const containerRef = useRef(null);

  /* ================================
     BUILD NOTIFICATIONS
  ================================= */

  const notifications = [
    ...applications
      .filter((item) => item.status === "pending")
      .map((item) => ({
        id: `membership-${item._id}`,
        type: "membership",
        title: "New Membership Application",
        message: `${item.user?.fullName || "A member"} submitted a membership application.`,
        date: item.createdAt || item.submittedDate,
        section: "membership",
      })),

    ...requests
      .filter((item) => item.status === "pending")
      .map((item) => ({
        id: `savings-${item._id}`,
        type: "savings",
        title: "New Savings Request",
        message: `${item.user?.fullName || "A member"} submitted a savings request.`,
        date: item.createdAt,
        section: "savings",
      })),

    ...loanEligibilityApplications
      .filter((item) => item.status === "pending")
      .map((item) => ({
        id: `loan-eligibility-${item._id}`,
        type: "loan-eligibility",
        title: "Full Loan Application",
        message: `${item.user?.fullName || "A member"} submitted a full loan application.`,
        date: item.submittedDate || item.createdAt,
        section: "loan-eligibility",
      })),

    ...loans
      .filter((item) => item.status === "pending")
      .map((item) => ({
        id: `loan-${item._id}`,
        type: "loan",
        title: "New Loan Request",
        message: `${item.user?.fullName || "A member"} submitted a loan request.`,
        date: item.applicationDate || item.createdAt,
        section: "loan-requests",
      })),

    ...loanRepayments
      .filter((item) => item.status === "pending")
      .map((item) => ({
        id: `repayment-${item._id}`,
        type: "repayment",
        title: "Loan Repayment Pending",
        message: `${item.user?.fullName || "A member"} submitted a repayment.`,
        date: item.createdAt,
        section: "repayments",
      })),

    ...withdrawals
      .filter((item) => item.status === "processing")
      .map((item) => ({
        id: `withdrawal-${item._id}`,
        type: "withdrawal",
        title: "Withdrawal Processing",
        message: `${item.user?.fullName || "A member"} has a withdrawal being processed.`,
        date: item.createdAt,
        section: "withdrawals",
      })),
  ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  const unreadNotifications = notifications.filter(
    (notification) => !readIds.includes(notification.id),
  );

  /* ================================
     CLOSE WHEN CLICKING OUTSIDE
  ================================= */

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  /* ================================
     MARK AS READ
  ================================= */

  const markAsRead = (id) => {
    setReadIds((previous) => {
      const updated = [...new Set([...previous, id])];

      localStorage.setItem("adminNotificationReadIds", JSON.stringify(updated));

      return updated;
    });
  };

  const handleNotificationClick = (notification) => {
    markAsRead(notification.id);
    setIsOpen(false);

    if (notification.section) {
      onNavigate(notification.section);
    }
  };

  const markAllAsRead = () => {
    const allIds = notifications.map((notification) => notification.id);

    setReadIds(allIds);

    localStorage.setItem("adminNotificationReadIds", JSON.stringify(allIds));
  };

  const formatTime = (date) => {
    if (!date) return "Recently";

    const notificationDate = new Date(date);
    const now = new Date();

    const difference = Math.floor((now - notificationDate) / 1000);

    if (difference < 60) {
      return "Just now";
    }

    if (difference < 3600) {
      return `${Math.floor(difference / 60)}m ago`;
    }

    if (difference < 86400) {
      return `${Math.floor(difference / 3600)}h ago`;
    }

    if (difference < 604800) {
      return `${Math.floor(difference / 86400)}d ago`;
    }

    return notificationDate.toLocaleDateString();
  };

  return (
    <div className="admin-notification-wrapper" ref={containerRef}>
      <button
        type="button"
        className="admin-notification-button"
        onClick={() => setIsOpen((previous) => !previous)}
        aria-label="Notifications"
      >
        <FaBell />

        {unreadNotifications.length > 0 && (
          <span className="admin-notification-count">
            {unreadNotifications.length > 99
              ? "99+"
              : unreadNotifications.length}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="admin-notification-dropdown">
          <div className="admin-notification-header">
            <div>
              <h3>Notifications</h3>
              <span>{unreadNotifications.length} unread</span>
            </div>

            {unreadNotifications.length > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                className="admin-mark-read-btn"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="admin-notification-list">
            {notifications.length === 0 ? (
              <div className="admin-notification-empty">
                <FaBell />
                <p>No notifications</p>
                <span>You're all caught up.</span>
              </div>
            ) : (
              notifications.slice(0, 10).map((notification) => {
                const isUnread = !readIds.includes(notification.id);

                return (
                  <button
                    type="button"
                    key={notification.id}
                    className={`admin-notification-item ${
                      isUnread ? "unread" : ""
                    }`}
                    onClick={() => handleNotificationClick(notification)}
                  >
                    <span className="admin-notification-dot" />

                    <div className="admin-notification-content">
                      <strong>{notification.title}</strong>

                      <p>{notification.message}</p>

                      <small>{formatTime(notification.date)}</small>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {notifications.length > 10 && (
            <div className="admin-notification-footer">
              Showing the 10 most recent notifications
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AdminNotifications;
