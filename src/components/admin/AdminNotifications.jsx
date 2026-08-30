import { useEffect, useMemo, useRef, useState } from "react";
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
      const saved = localStorage.getItem("adminNotificationReadIds");

      const parsed = saved ? JSON.parse(saved) : [];

      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  // Used to keep "5m ago", "2h ago", etc. up to date
  const [now, setNow] = useState(() => Date.now());

  const containerRef = useRef(null);

  /* ================================
     UPDATE RELATIVE TIME
  ================================= */

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  /* ================================
     BUILD NOTIFICATIONS
  ================================= */

  const notifications = useMemo(() => {
    const items = [
      /* ================================
         MEMBERSHIP
      ================================= */

      ...applications
        .filter((item) => item.status === "pending")
        .map((item) => ({
          id: `membership-${item._id}`,
          type: "membership",
          title: "New Membership Application",
          message: `${
            item.user?.fullName || item.fullName || "A member"
          } submitted a membership application.`,
          date: item.createdAt || item.submittedDate,
          section: "membership",
        })),

      /* ================================
         SAVINGS
      ================================= */

      ...requests
        .filter((item) => item.status === "pending")
        .map((item) => ({
          id: `savings-${item._id}`,
          type: "savings",
          title: "New Savings Request",
          message: `${
            item.user?.fullName || "A member"
          } submitted a savings request.`,
          date: item.createdAt,
          section: "savings",
        })),

      /* ================================
         LOAN ELIGIBILITY
      ================================= */

      ...loanEligibilityApplications
        .filter((item) => item.status === "pending")
        .map((item) => ({
          id: `loan-eligibility-${item._id}`,
          type: "loan-eligibility",
          title: "Full Loan Application",
          message: `${
            item.user?.fullName || "A member"
          } submitted a full loan application.`,
          date: item.submittedDate || item.createdAt,
          section: "loan-eligibility",
        })),

      /* ================================
         LOAN REQUESTS
      ================================= */

      ...loans
        .filter((item) => item.status === "pending")
        .map((item) => ({
          id: `loan-${item._id}`,
          type: "loan",
          title: "New Loan Request",
          message: `${
            item.user?.fullName || "A member"
          } submitted a loan request.`,
          date: item.applicationDate || item.createdAt,
          section: "loan-requests",
        })),

      /* ================================
         LOAN REPAYMENTS
      ================================= */

      ...loanRepayments
        .filter((item) => item.status === "pending")
        .map((item) => ({
          id: `repayment-${item._id}`,
          type: "repayment",
          title: "Loan Repayment Pending",
          message: `${
            item.user?.fullName || "A member"
          } submitted a repayment.`,
          date: item.createdAt,
          section: "repayments",
        })),

      /* ================================
         WITHDRAWALS
      ================================= */

      ...withdrawals
        .filter((item) => item.status === "processing")
        .map((item) => ({
          id: `withdrawal-${item._id}`,
          type: "withdrawal",
          title: "Withdrawal Processing",
          message: `${
            item.user?.fullName || "A member"
          } has a withdrawal being processed.`,
          date: item.createdAt,
          section: "withdrawals",
        })),
    ];

    /*
      Remove duplicate notifications.
      This protects against the same record appearing
      more than once in the source arrays.
    */

    const uniqueItems = Array.from(
      new Map(items.map((item) => [item.id, item])).values(),
    );

    /*
      Sort newest first.
    */

    return uniqueItems.sort((a, b) => {
      const dateA = new Date(a.date || 0).getTime();
      const dateB = new Date(b.date || 0).getTime();

      return dateB - dateA;
    });
  }, [
    applications,
    requests,
    loans,
    loanEligibilityApplications,
    loanRepayments,
    withdrawals,
  ]);

  /* ================================
     UNREAD NOTIFICATIONS
  ================================= */

  const unreadNotifications = useMemo(() => {
    return notifications.filter(
      (notification) => !readIds.includes(notification.id),
    );
  }, [notifications, readIds, now]);

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
     MARK ONE AS READ
  ================================= */

  const markAsRead = (id) => {
    setReadIds((previous) => {
      if (previous.includes(id)) {
        return previous;
      }

      const updated = [...previous, id];

      localStorage.setItem("adminNotificationReadIds", JSON.stringify(updated));

      return updated;
    });
  };

  /* ================================
     HANDLE NOTIFICATION CLICK
  ================================= */

  const handleNotificationClick = (notification) => {
    markAsRead(notification.id);

    setIsOpen(false);

    if (notification.section && onNavigate) {
      onNavigate(notification.section);
    }
  };

  /* ================================
     MARK ALL AS READ
  ================================= */

  const markAllAsRead = () => {
    const allIds = notifications.map((notification) => notification.id);

    setReadIds(allIds);

    localStorage.setItem("adminNotificationReadIds", JSON.stringify(allIds));
  };

  /* ================================
     FORMAT TIME
  ================================= */

  const formatTime = (date) => {
    if (!date) {
      return "Recently";
    }

    const notificationDate = new Date(date);

    if (Number.isNaN(notificationDate.getTime())) {
      return "Recently";
    }

    const difference = Math.floor((now - notificationDate.getTime()) / 1000);

    /*
      Future timestamps can happen because of
      small server/client clock differences.
    */

    if (difference < 0) {
      return "Just now";
    }

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

  /* ================================
     RENDER
  ================================= */

  return (
    <div className="admin-notification-wrapper" ref={containerRef}>
      {/* Notification Bell */}

      <button
        type="button"
        className="admin-notification-button"
        onClick={() => setIsOpen((previous) => !previous)}
        aria-label={`Notifications${
          unreadNotifications.length > 0
            ? `, ${unreadNotifications.length} unread`
            : ""
        }`}
        aria-expanded={isOpen}
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

      {/* Notification Dropdown */}

      {isOpen && (
        <div className="admin-notification-dropdown">
          {/* Header */}

          <div className="admin-notification-header">
            <div>
              <h3>Notifications</h3>

              <span>
                {unreadNotifications.length === 0
                  ? "All caught up"
                  : `${unreadNotifications.length} unread`}
              </span>
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

          {/* Notification List */}

          <div className="admin-notification-list">
            {notifications.length === 0 ? (
              <div className="admin-notification-empty">
                <FaBell />

                <p>No notifications</p>

                <span>
                  New membership, savings and loan activity will appear here.
                </span>
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
                    <span
                      className="admin-notification-dot"
                      aria-hidden="true"
                    />

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

          {/* Footer */}

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
