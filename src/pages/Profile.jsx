import { useState, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import request from "../utils/api";
import "../styles/profile.css";

function Profile() {
  const { user, refreshUser } = useAuth();
  const fileInputRef = useRef(null);

  const [fullName, setFullName] = useState(user?.fullName || "");
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState("");

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
    }
  };

  const handleNameSave = async (e) => {
    e.preventDefault();
    setNameMsg("");
    setSavingName(true);
    try {
      await request("/users/me", {
        method: "PATCH",
        token: user.token,
        body: { fullName },
      });
      await refreshUser();
      setNameMsg("Saved.");
    } catch (err) {
      setNameMsg(err.message);
    } finally {
      setSavingName(false);
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
            {user?.role === "admin" && (
              <span className="role-badge">Admin</span>
            )}
          </p>
        </div>
      </header>

      {avatarError && <p className="form-error">{avatarError}</p>}

      <section className="profile-form-card">
        <h2>Edit Name</h2>
        <form onSubmit={handleNameSave} className="inline-form">
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
          <button type="submit" disabled={savingName}>
            {savingName ? "Saving..." : "Save"}
          </button>
        </form>
        {nameMsg && <p className="form-note">{nameMsg}</p>}
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
