import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import request from "../utils/api";
import "../styles/profile.css";

const EMPTY_MEMBERSHIP = {
  fullName: "",
  gender: "",
  phone: "",
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

function Profile() {
  const { user, refreshUser } = useAuth();
  const fileInputRef = useRef(null);

  const [membership, setMembership] = useState(null);
  const [membershipForm, setMembershipForm] = useState(EMPTY_MEMBERSHIP);
  const [membershipLoading, setMembershipLoading] = useState(true);
  const [membershipSaving, setMembershipSaving] = useState(false);
  const [membershipMsg, setMembershipMsg] = useState("");
  const [membershipError, setMembershipError] = useState("");

  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState("");

  const [pwForm, setPwForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  const [pwError, setPwError] = useState("");

  useEffect(() => {
    if (!user) return;

    setMembershipLoading(true);
    request("/membership/me", { token: user.token })
      .then((data) => {
        setMembership(data);
        if (data) {
          setMembershipForm((prev) => {
            const next = { ...prev };
            EDITABLE_FIELDS.forEach(([field]) => {
              next[field] = data[field] || "";
            });
            return next;
          });
        }
      })
      .catch(() => setMembership(null))
      .finally(() => setMembershipLoading(false));
  }, [user]);

  const initials = (user?.fullName || "")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const avatarUrl = user?.avatarUrl || null;

  const handleAvatarClick = () => fileInputRef.current?.click();

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
    setMembershipForm((prev) => ({ ...prev, [field]: e.target.value }));
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

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPwMsg("");
    setPwError("");

    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwError("New passwords do not match.");
      return;
    }

    setPwSaving(true);
    try {
      await request("/users/me/password", {
        method: "PATCH",
        token: user.token,
        body: {
          currentPassword: pwForm.currentPassword,
          newPassword: pwForm.newPassword,
        },
      });
      setPwMsg("Password updated.");
      setPwForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (err) {
      setPwError(err.message);
    } finally {
      setPwSaving(false);
    }
  };

  const memberSince = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
      })
    : "—";

  return (
    <div className="profile-page">
      <header className="profile-hero">
        <div className="avatar-wrap" onClick={handleAvatarClick}>
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
        <div>
          <h1>{user?.fullName}</h1>
          <p className="profile-meta">
            {user?.email} · Member since {memberSince}
            {user?.role === "admin" && <span className="role-badge">Admin</span>}
          </p>
        </div>
      </header>

      {avatarError && <p className="form-error">{avatarError}</p>}

      <section className="profile-form-card">
        <div className="section-heading-row">
          <div>
            <h2>Edit Membership Details</h2>
            <p className="section-help">
              Keep your membership information up to date. These details are
              also used when your loan eligibility is reviewed.
            </p>
          </div>
          {membership?.status && (
            <span className={`membership-status ${membership.status}`}>
              {membership.status}
            </span>
          )}
        </div>

        {membershipLoading ? (
          <p className="form-note">Loading membership details...</p>
        ) : !membership ? (
          <p className="form-note">
            No membership application is linked to this account yet.
          </p>
        ) : (
          <form onSubmit={handleMembershipSave} className="membership-edit-form">
            <div className="profile-edit-grid">
              {EDITABLE_FIELDS.map(([field, label]) => (
                <div
                  className={`form-group ${field === "address" || field.includes("Address") ? "full-width" : ""}`}
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

            {membershipError && <p className="form-error">{membershipError}</p>}
            {membershipMsg && <p className="form-note">{membershipMsg}</p>}

            <button type="submit" className="btn-primary" disabled={membershipSaving}>
              {membershipSaving ? "Saving changes..." : "Save Membership Details"}
            </button>
          </form>
        )}
      </section>

      <section className="profile-form-card">
        <h2>Change Password</h2>
        <form onSubmit={handlePasswordChange} className="stacked-form">
          <div className="form-group">
            <label htmlFor="currentPassword">Current Password</label>
            <input
              id="currentPassword"
              type="password"
              required
              value={pwForm.currentPassword}
              onChange={(e) =>
                setPwForm((p) => ({ ...p, currentPassword: e.target.value }))
              }
            />
          </div>
          <div className="form-group">
            <label htmlFor="newPassword">New Password</label>
            <input
              id="newPassword"
              type="password"
              required
              value={pwForm.newPassword}
              onChange={(e) =>
                setPwForm((p) => ({ ...p, newPassword: e.target.value }))
              }
            />
          </div>
          <div className="form-group">
            <label htmlFor="confirmNewPassword">Confirm New Password</label>
            <input
              id="confirmNewPassword"
              type="password"
              required
              value={pwForm.confirmPassword}
              onChange={(e) =>
                setPwForm((p) => ({ ...p, confirmPassword: e.target.value }))
              }
            />
          </div>
          {pwError && <p className="form-error">{pwError}</p>}
          {pwMsg && <p className="form-note">{pwMsg}</p>}
          <button type="submit" className="btn-primary" disabled={pwSaving}>
            {pwSaving ? "Updating..." : "Update Password"}
          </button>
        </form>
      </section>
    </div>
  );
}

export default Profile;
