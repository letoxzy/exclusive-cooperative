import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { FaBell } from "react-icons/fa6";
import { useAuth } from "../context/AuthContext";
import { UserIcon, GridIcon, LogOutIcon } from "./Icons";
import request from "../utils/api";
import "../styles/navbar.css";

function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  const [notifications, setNotifications] = useState([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationLoading, setNotificationLoading] = useState(false);

  const { user, logout } = useAuth();

  /*
   * =========================
   * LOAD NOTIFICATIONS
   * =========================
   */

  const loadNotifications = async () => {
    if (!user?.token) {
      setNotifications([]);
      return;
    }

    try {
      setNotificationLoading(true);

      const data = await request("/notifications", {
        token: user.token,
      });

      setNotifications(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load notifications:", err);
    } finally {
      setNotificationLoading(false);
    }
  };

  /*
   * Load notifications when user logs in.
   */

  useEffect(() => {
    if (!user?.token) return;

    loadNotifications();

    /*
     * Check for new notifications periodically.
     * This keeps the bell reasonably up to date
     * without requiring a page refresh.
     */
    const interval = setInterval(() => {
      loadNotifications();
    }, 30000);

    return () => clearInterval(interval);
  }, [user?.token]);

  /*
   * =========================
   * MENU
   * =========================
   */

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 900) {
        setMenuOpen(false);
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const closeMenu = () => {
    setMenuOpen(false);
  };

  /*
   * =========================
   * LOGOUT
   * =========================
   */

  const handleLogout = () => {
    logout();
    closeMenu();
    setNotificationOpen(false);
  };

  /*
   * =========================
   * NOTIFICATIONS
   * =========================
   */

  const unreadCount = notifications.filter(
    (notification) => !notification.isRead,
  ).length;

  const formatNotificationTime = (date) => {
    if (!date) return "Recently";

    const notificationDate = new Date(date);

    if (Number.isNaN(notificationDate.getTime())) {
      return "Recently";
    }

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

  const markNotificationAsRead = async (notification) => {
    if (notification.isRead) return;

    try {
      await request(`/notifications/${notification._id}/read`, {
        method: "PATCH",
        token: user.token,
      });

      setNotifications((previous) =>
        previous.map((item) =>
          item._id === notification._id ? { ...item, isRead: true } : item,
        ),
      );
    } catch (err) {
      console.error("Failed to mark notification as read:", err);
    }
  };

  const markAllNotificationsAsRead = async () => {
    if (unreadCount === 0) return;

    try {
      await request("/notifications/read-all", {
        method: "PATCH",
        token: user.token,
      });

      setNotifications((previous) =>
        previous.map((notification) => ({
          ...notification,
          isRead: true,
        })),
      );
    } catch (err) {
      console.error("Failed to mark all notifications as read:", err);
    }
  };

  /*
   * Close notification dropdown when clicking elsewhere.
   */

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest(".navbar-notification-wrapper")) {
        setNotificationOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  /*
   * =========================
   * NOTIFICATION BUTTON
   * =========================
   */

  const NotificationButton = ({ mobile = false }) => (
    <div
      className={`navbar-notification-wrapper ${
        mobile ? "mobile-notification-wrapper" : ""
      }`}
    >
      <button
        type="button"
        className={
          mobile ? "mobile-notification-btn" : "navbar-notification-btn"
        }
        onClick={() => setNotificationOpen((previous) => !previous)}
        aria-label="Notifications"
        title="Notifications"
      >
        <FaBell />

        {unreadCount > 0 && (
          <span className="navbar-notification-count">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {notificationOpen && (
        <div className="navbar-notification-dropdown">
          <div className="navbar-notification-header">
            <div>
              <h3>Notifications</h3>

              <span>{unreadCount} unread</span>
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                className="navbar-mark-read-btn"
                onClick={markAllNotificationsAsRead}
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="navbar-notification-list">
            {notificationLoading ? (
              <div className="navbar-notification-empty">
                <p>Loading notifications...</p>
              </div>
            ) : notifications.length === 0 ? (
              <div className="navbar-notification-empty">
                <FaBell />

                <p>No notifications</p>

                <span>You're all caught up.</span>
              </div>
            ) : (
              notifications.slice(0, 10).map((notification) => (
                <button
                  type="button"
                  key={notification._id}
                  className={`navbar-notification-item ${
                    !notification.isRead ? "unread" : ""
                  }`}
                  onClick={() => markNotificationAsRead(notification)}
                >
                  <span className="navbar-notification-dot" />

                  <div className="navbar-notification-content">
                    <strong>{notification.title}</strong>

                    <p>{notification.message}</p>

                    <small>
                      {formatNotificationTime(notification.createdAt)}
                    </small>
                  </div>
                </button>
              ))
            )}
          </div>

          {notifications.length > 10 && (
            <div className="navbar-notification-footer">
              Showing the 10 most recent notifications
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <nav className="navbar">
      <div className="navbar-container">
        {/* =========================
            MOBILE NOTIFICATION
        ========================= */}

        {user && (
          <div className="mobile-navbar-notification">
            <NotificationButton mobile />
          </div>
        )}

        {/* =========================
            LOGO
        ========================= */}

        <Link to="/" className="navbar-logo" onClick={closeMenu}>
          EXCLUSIVE
        </Link>

        {/* =========================
            MOBILE ACTIONS
        ========================= */}

        <div className="mobile-nav-actions">
          {user && (
            <NavLink
              to={user.role === "admin" ? "/admin" : "/dashboard"}
              className={({ isActive }) =>
                `icon-btn mobile-dashboard-btn ${isActive ? "active" : ""}`
              }
              onClick={closeMenu}
              aria-label={user.role === "admin" ? "Admin Panel" : "Dashboard"}
              title={user.role === "admin" ? "Admin Panel" : "Dashboard"}
            >
              <GridIcon size={19} />
            </NavLink>
          )}

          <button
            className="menu-btn"
            onClick={() => setMenuOpen((previous) => !previous)}
            aria-label="Toggle navigation menu"
            aria-expanded={menuOpen}
          >
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>

        {/* =========================
            NAVIGATION CONTENT
        ========================= */}

        <div className={`navbar-content ${menuOpen ? "open" : ""}`}>
          <div className="navbar-links">
            <NavLink to="/" end onClick={closeMenu}>
              Home
            </NavLink>

            <NavLink to="/about" end onClick={closeMenu}>
              About
            </NavLink>

            <NavLink to="/membership" end onClick={closeMenu}>
              Membership
            </NavLink>

            <NavLink to="/gallery" end onClick={closeMenu}>
              Gallery
            </NavLink>

            <NavLink to="/savings" end onClick={closeMenu}>
              Savings
            </NavLink>

            {user?.role === "member" && (
              <NavLink to="/withdrawals" end onClick={closeMenu}>
                Withdrawals
              </NavLink>
            )}

            <NavLink to="/loans" onClick={closeMenu}>
              Loans
            </NavLink>

            <NavLink to="/contact" end onClick={closeMenu}>
              Contact
            </NavLink>
          </div>

          {/* =========================
              DESKTOP ACTIONS
          ========================= */}

          <div className="navbar-actions">
            {user ? (
              <div className="navbar-icon-group">
                {/* Desktop notification */}
                <div className="desktop-navbar-notification">
                  <NotificationButton />
                </div>

                {/* Dashboard */}
                <NavLink
                  to={user.role === "admin" ? "/admin" : "/dashboard"}
                  className={({ isActive }) =>
                    `icon-btn desktop-dashboard-btn ${isActive ? "active" : ""}`
                  }
                  onClick={closeMenu}
                  aria-label={
                    user.role === "admin" ? "Admin Panel" : "Dashboard"
                  }
                  title={user.role === "admin" ? "Admin Panel" : "Dashboard"}
                >
                  <GridIcon size={19} />
                </NavLink>

                {/* Profile */}
                <NavLink
                  to="/profile"
                  className={({ isActive }) =>
                    `icon-btn ${isActive ? "active" : ""}`
                  }
                  onClick={closeMenu}
                  aria-label="Profile"
                  title="Profile"
                >
                  <UserIcon size={19} />
                </NavLink>

                {/* Logout */}
                <button
                  className="icon-btn"
                  onClick={handleLogout}
                  aria-label="Log out"
                  title="Log out"
                >
                  <LogOutIcon size={19} />
                </button>
              </div>
            ) : (
              <>
                <Link to="/login" className="login-btn" onClick={closeMenu}>
                  Login
                </Link>

                <Link to="/register" className="member-btn" onClick={closeMenu}>
                  Become a Member
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}

export default Navbar;
