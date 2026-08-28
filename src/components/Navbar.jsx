import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { UserIcon, GridIcon, LogOutIcon } from "./Icons";
import "../styles/navbar.css";

function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { user, logout } = useAuth();

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 900) setMenuOpen(false);
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
        <Link to="/" className="navbar-logo" onClick={closeMenu}>
          EXCLUSIVE
        </Link>

        <button
          className="menu-btn"
          onClick={() => setMenuOpen((prev) => !prev)}
          aria-label="Toggle navigation menu"
          aria-expanded={menuOpen}
        >
          {menuOpen ? "✕" : "☰"}
        </button>

        <div className={`navbar-content ${menuOpen ? "open" : ""}`}>
          <div className="navbar-links">
            <Link to="/" onClick={closeMenu}>
              Home
            </Link>
            <Link to="/about" onClick={closeMenu}>
              About
            </Link>
            <Link to="/membership" onClick={closeMenu}>
              Membership
            </Link>
            <Link to="/savings" onClick={closeMenu}>
              Savings
            </Link>
            <Link to="/loans" onClick={closeMenu}>
              Loans
            </Link>
            <Link to="/contact" onClick={closeMenu}>
              Contact
            </Link>
          </div>

          <div className="navbar-actions">
            {user ? (
              <div className="navbar-icon-group">
                <Link
                  to={user.role === "admin" ? "/admin" : "/dashboard"}
                  className="icon-btn"
                  onClick={closeMenu}
                  aria-label={
                    user.role === "admin" ? "Admin Panel" : "Dashboard"
                  }
                  title={user.role === "admin" ? "Admin Panel" : "Dashboard"}
                >
                  <GridIcon size={19} />
                </Link>
                <Link
                  to="/profile"
                  className="icon-btn"
                  onClick={closeMenu}
                  aria-label="Profile"
                  title="Profile"
                >
                  <UserIcon size={19} />
                </Link>
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
