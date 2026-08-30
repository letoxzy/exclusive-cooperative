import { useState, useEffect } from "react";
import { Link, NavLink } from "react-router-dom";
import { FaBell } from "react-icons/fa6";
import { useAuth } from "../context/AuthContext";
import { UserIcon, GridIcon, LogOutIcon } from "./Icons";
import "../styles/navbar.css";

function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { user, logout } = useAuth();

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 900) {
        setMenuOpen(false);
      }
    };

    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const closeMenu = () => setMenuOpen(false);

  const handleLogout = () => {
    logout();
    closeMenu();
  };

  return (
    <nav className="navbar">
      <div className="navbar-container">
        {/* =========================
            MOBILE NOTIFICATION
        ========================= */}
        {user && (
          <button
            type="button"
            className="mobile-notification-btn"
            aria-label="Notifications"
            title="Notifications"
          >
            <FaBell />
          </button>
        )}

        {/* Logo */}
        <Link to="/" className="navbar-logo" onClick={closeMenu}>
          EXCLUSIVE
        </Link>

        {/* Mobile actions */}
        <div className="mobile-nav-actions">
          {/* Dashboard icon */}
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

          {/* Menu button */}
          <button
            className="menu-btn"
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-label="Toggle navigation menu"
            aria-expanded={menuOpen}
          >
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>

        {/* Navigation content */}
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

          {/* Desktop / opened mobile actions */}
          <div className="navbar-actions">
            {user ? (
              <div className="navbar-icon-group">
                {/* Dashboard - desktop */}
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
