import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  FaChevronRight,
  FaCog,
  FaHandHoldingUsd,
  FaHeadset,
  FaThLarge,
  FaWallet,
} from "react-icons/fa";
import { useAuth } from "../context/AuthContext";
import request from "../utils/api";
import "../styles/profile.css";
import "../styles/settings.css";
import { useFlash } from "../context/ToastContext.jsx";

const EMPTY_MEMBERSHIP = {
  fullName: "",
  gender: "",
  phone: "",
  email: "",
  employmentStatus: "",
  employmentOther: "",
  lga: "",
  dob: "",
  maritalStatus: "",
  whatsapp: "",
  occupation: "",
  stateOfOrigin: "",
  address: "",
  kinName: "",
  kinPhone: "",
  kinAddress: "",
  kinRelationship: "",
  kinAltPhone: "",
  kinEmail: "",
  beneficiaryName: "",
  beneficiaryPhone: "",
  beneficiaryAddress: "",
  beneficiaryRelationship: "",
};

const EDITABLE_FIELDS = [
  ["fullName", "Full Name"],
  ["gender", "Gender"],
  ["phone", "Phone"],
  ["email", "Email"],
  ["dob", "Date of Birth"],
  ["maritalStatus", "Marital Status"],
  ["whatsapp", "WhatsApp"],
  ["occupation", "Occupation"],
  ["employmentStatus", "Employment Status"],
  ["employmentOther", "Employment Details"],
  ["lga", "LGA"],
  ["stateOfOrigin", "State of Origin"],
  ["address", "Address"],
  ["kinName", "Next of Kin Name"],
  ["kinPhone", "Next of Kin Phone"],
  ["kinAddress", "Next of Kin Address"],
  ["kinRelationship", "Next of Kin Relationship"],
  ["kinAltPhone", "Next of Kin Alternative Phone"],
  ["kinEmail", "Next of Kin Email"],
  ["beneficiaryName", "Beneficiary Name"],
  ["beneficiaryPhone", "Beneficiary Phone"],
  ["beneficiaryAddress", "Beneficiary Address"],
  ["beneficiaryRelationship", "Beneficiary Relationship"],
];

function formatDateForInput(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value).slice(0, 10);
  }

  return date.toISOString().slice(0, 10);
}

function Profile() {
  const { user, refreshUser } = useAuth();
  const fileInputRef = useRef(null);

  const [membership, setMembership] = useState(null);
  const [membershipForm, setMembershipForm] = useState(EMPTY_MEMBERSHIP);
  const [membershipLoading, setMembershipLoading] = useState(true);
  const [membershipSaving, setMembershipSaving] = useState(false);
  const [membershipMsg, setMembershipMsg] = useState("");
  useFlash(membershipMsg, "auto");
  const [membershipError, setMembershipError] = useState("");
  useFlash(membershipError, "error");

  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  useFlash(avatarError, "error");

  // Withdrawal PIN status (read-only here; managed in Settings)
  const [hasPin, setHasPin] = useState(false);
  const [pinLoading, setPinLoading] = useState(true);
  const [pinError, setPinError] = useState("");
  useFlash(pinError, "error");

  // Load membership
  useEffect(() => {
    if (!user?._id) return;

    setMembershipLoading(true);

    request("/membership/me", { token: user.token })
      .then((data) => {
        setMembership(data);

        if (data) {
          setMembershipForm((prev) => {
            const next = { ...prev };

            EDITABLE_FIELDS.forEach(([field]) => {
              if (field === "dob") {
                next[field] = formatDateForInput(data[field]);
              } else {
                next[field] = data[field] || "";
              }
            });

            return next;
          });
        }
      })
      .catch(() => setMembership(null))
      .finally(() => setMembershipLoading(false));
  }, [user?._id]);

  // Load withdrawal PIN status
  useEffect(() => {
    if (!user?._id) return;

    const loadPinStatus = async () => {
      try {
        setPinLoading(true);

        const result = await request("/withdrawals/pin/status", {
          token: user.token,
        });

        setHasPin(Boolean(result.hasWithdrawalPin));
      } catch (err) {
        setPinError(err.message);
      } finally {
        setPinLoading(false);
      }
    };

    loadPinStatus();
  }, [user?._id]);

  const initials = (user?.fullName || "")
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const avatarUrl = user?.avatarUrl || null;

  const memberSince = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
      })
    : "—";

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];

    if (!file) return;

    setAvatarError("");
    setAvatarUploading(true);

    const formData = new FormData();
    formData.append("avatar", file);

    try {
      await request("/users/me/avatar", {
        method: "POST",
        token: user.token,
        body: formData,
        isFormData: true,
      });

      await refreshUser();
    } catch (err) {
      setAvatarError(err.message);
    } finally {
      setAvatarUploading(false);
      e.target.value = "";
    }
  };

  const updateMembershipField = (field) => (e) => {
    setMembershipForm((prev) => ({
      ...prev,
      [field]: e.target.value,
    }));
  };

  const handleMembershipSave = async (e) => {
    e.preventDefault();

    setMembershipMsg("");
    setMembershipError("");
    setMembershipSaving(true);

    const body = {};

    EDITABLE_FIELDS.forEach(([field]) => {
      body[field] = membershipForm[field];
    });

    try {
      const updated = await request("/membership/me", {
        method: "PATCH",
        token: user.token,
        body,
      });

      setMembership(updated);
      setMembershipMsg("Membership details updated successfully.");

      await refreshUser();
    } catch (err) {
      setMembershipError(err.message);
    } finally {
      setMembershipSaving(false);
    }
  };

  return (
    <main className="profile-page">
      {/* PROFILE HEADER */}
      <header className="profile-hero">
        <div className="profile-hero-actions">
          <Link to="/contact" className="icon-btn" title="Help & support" aria-label="Help & support">
            <FaHeadset />
          </Link>
          <Link to="/settings" className="icon-btn" title="Settings" aria-label="Settings">
            <FaCog />
          </Link>
        </div>

        <div
          className="avatar-wrap"
          onClick={handleAvatarClick}
          role="button"
          tabIndex={0}
          title="Change profile photo"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="Profile" className="avatar-img" />
          ) : (
            <div className="avatar-fallback">{initials || "?"}</div>
          )}

          <div className="avatar-overlay">
            {avatarUploading ? "Uploading..." : "Change photo"}
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handleAvatarChange}
        />

        <div className="profile-hero-info">
          <p className="profile-eyebrow">MEMBER PROFILE</p>

          <h1>{user?.fullName || "Member"}</h1>

          <p className="profile-meta">
            {user?.email || "—"}
            <span>•</span>
            Member since {memberSince}
          </p>

          <div className="profile-status-row">
            <span className="account-status">
              {user?.role === "admin" ? "Administrator" : "Member"}
            </span>

            {membership?.status && (
              <span className={`membership-status ${membership.status}`}>
                {membership.status}
              </span>
            )}
          </div>
        </div>
      </header>


      {/* ACCOUNT OVERVIEW */}
      <section className="profile-overview">
        <div className="profile-overview-card">
          <span>Account Type</span>
          <strong>{user?.role === "admin" ? "Administrator" : "Member"}</strong>
        </div>

        <div className="profile-overview-card">
          <span>Membership Status</span>
          <strong>
            {membership?.status
              ? membership.status.charAt(0).toUpperCase() +
                membership.status.slice(1)
              : "—"}
          </strong>
        </div>

        <div className="profile-overview-card">
          <span>Withdrawal Security</span>
          <strong className={hasPin ? "security-ready" : "security-warning"}>
            {pinLoading
              ? "Checking..."
              : hasPin
                ? "PIN Enabled"
                : "PIN Not Set"}
          </strong>
          <Link to="/settings#security" className="overview-link">
            Manage
          </Link>
        </div>
      </section>

      {/* QUICK SHORTCUTS */}
      <section className="profile-quick" aria-label="Shortcuts">
        <Link to={user?.role === "admin" ? "/admin" : "/dashboard"} className="quick-tile">
          <span className="quick-tile-icon"><FaThLarge /></span>
          {user?.role === "admin" ? "Admin" : "Dashboard"}
        </Link>
        <Link to="/withdrawals" className="quick-tile">
          <span className="quick-tile-icon"><FaWallet /></span>
          Withdrawals
        </Link>
        <Link to="/loans/apply" className="quick-tile">
          <span className="quick-tile-icon"><FaHandHoldingUsd /></span>
          Apply for loan
        </Link>
      </section>

      <section className="profile-links">
        <Link to="/settings" className="link-row">
          <span className="link-row-icon"><FaCog /></span>
          <span className="link-row-text">
            <strong>Settings</strong>
            <small>Password, withdrawal PIN, notifications &amp; devices</small>
          </span>
          <FaChevronRight className="link-row-arrow" />
        </Link>
        <Link to="/contact" className="link-row">
          <span className="link-row-icon"><FaHeadset /></span>
          <span className="link-row-text">
            <strong>Help &amp; support</strong>
            <small>Questions about your account? Talk to us</small>
          </span>
          <FaChevronRight className="link-row-arrow" />
        </Link>
      </section>

      {/* MEMBERSHIP DETAILS */}
      <section className="profile-form-card">
        <div className="section-heading-row">
          <div>
            <p className="profile-section-eyebrow">MEMBERSHIP</p>

            <h2>Membership Details</h2>

            <p className="section-help">
              Keep your personal and membership information up to date. These
              details may also be used during membership and loan reviews.
            </p>
          </div>

          {membership?.status && (
            <span className={`membership-status ${membership.status}`}>
              {membership.status}
            </span>
          )}
        </div>

        {membershipLoading ? (
          <div className="profile-loading">Loading membership details...</div>
        ) : !membership ? (
          <div className="profile-empty">
            No membership application is linked to this account yet.
          </div>
        ) : (
          <form
            onSubmit={handleMembershipSave}
            className="membership-edit-form"
          >
            <div className="profile-edit-grid">
              {EDITABLE_FIELDS.map(([field, label]) => (
                <div
                  className={`form-group ${
                    field === "address" || field.includes("Address")
                      ? "full-width"
                      : ""
                  }`}
                  key={field}
                >
                  <label htmlFor={`profile-${field}`}>{label}</label>

                  {field === "address" || field.includes("Address") ? (
                    <textarea
                      id={`profile-${field}`}
                      value={membershipForm[field]}
                      onChange={updateMembershipField(field)}
                      rows={3}
                    />
                  ) : (
                    <input
                      id={`profile-${field}`}
                      type={field === "dob" ? "date" : "text"}
                      value={membershipForm[field]}
                      onChange={updateMembershipField(field)}
                    />
                  )}
                </div>
              ))}
            </div>



            <button
              type="submit"
              className="btn-primary"
              disabled={membershipSaving}
            >
              {membershipSaving
                ? "Saving changes..."
                : "Save Membership Details"}
            </button>
          </form>
        )}
      </section>

      {/* ACCOUNT INFORMATION */}
      <section className="profile-form-card account-information-card">
        <div className="section-heading-row">
          <div>
            <p className="profile-section-eyebrow">ACCOUNT</p>

            <h2>Account Information</h2>

            <p className="section-help">
              Basic information about your cooperative account.
            </p>
          </div>
        </div>

        <div className="account-info-grid">
          <div className="account-info-item">
            <span>Full Name</span>
            <strong>{user?.fullName || "—"}</strong>
          </div>

          <div className="account-info-item">
            <span>Email Address</span>
            <strong>{user?.email || "—"}</strong>
          </div>

          <div className="account-info-item">
            <span>Account Type</span>
            <strong>
              {user?.role === "admin" ? "Administrator" : "Member"}
            </strong>
          </div>

          <div className="account-info-item">
            <span>Member Since</span>
            <strong>{memberSince}</strong>
          </div>

          <div className="account-info-item">
            <span>Membership Status</span>
            <strong>{membership?.status || "—"}</strong>
          </div>

          <div className="account-info-item">
            <span>Withdrawal Security</span>
            <strong>{hasPin ? "4-Digit PIN Enabled" : "PIN Not Set"}</strong>
          </div>
        </div>
      </section>
    </main>
  );
}

export default Profile;
