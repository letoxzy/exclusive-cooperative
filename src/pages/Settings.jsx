import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  FaBell,
  FaChevronRight,
  FaDesktop,
  FaFileAlt,
  FaHeadset,
  FaMobileAlt,
  FaQuestionCircle,
  FaShieldAlt,
  FaTrashAlt,
  FaUserShield,
} from "react-icons/fa";
import { useAuth } from "../context/AuthContext";
import { useFlash, useToast } from "../context/ToastContext.jsx";
import request from "../utils/api";
import { getPasswordChecks, isStrongPassword } from "../utils/passwordPolicy";
import {
  isPushSubscribed,
  isPushSupported,
  sendTestPush,
  subscribePush,
  unsubscribePush,
} from "../utils/webPush";
import "../styles/profile.css";
import "../styles/settings.css";

const TABS = [
  { id: "security", label: "Security", sub: "Password & withdrawal PIN", icon: FaShieldAlt },
  { id: "notifications", label: "Notifications", sub: "Alerts in this browser", icon: FaBell },
  { id: "devices", label: "Devices", sub: "Where you are signed in", icon: FaMobileAlt },
  { id: "help", label: "Help & legal", sub: "Support, privacy, terms", icon: FaQuestionCircle },
];

function SettingsRow({ to, icon: Icon, title, sub, danger = false }) {
  return (
    <Link to={to} className={`link-row${danger ? " link-row-danger" : ""}`}>
      <span className="link-row-icon">
        <Icon />
      </span>
      <span className="link-row-text">
        <strong>{title}</strong>
        <small>{sub}</small>
      </span>
      <FaChevronRight className="link-row-arrow" />
    </Link>
  );
}

function NotificationsPanel() {
  const toast = useToast();
  const [status, setStatus] = useState("loading"); // loading | unsupported | denied | on | off
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    if (!isPushSupported()) return setStatus("unsupported");
    if (Notification.permission === "denied") return setStatus("denied");
    setStatus((await isPushSubscribed()) ? "on" : "off");
  };

  useEffect(() => {
    refresh();
  }, []);

  const turnOn = async () => {
    setBusy(true);
    try {
      const result = await subscribePush({ prompt: true });
      if (result.ok) {
        toast.success("Notifications are on for this browser.");
        sendTestPush().catch(() => {});
      } else if (result.reason === "not-configured") {
        toast.info("Website notifications are not available yet.");
      } else if (result.reason === "denied") {
        toast.error("Notifications are blocked. Allow them in your browser's site settings.");
      }
    } catch (err) {
      toast.error(err.message || "Could not turn on notifications.");
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const turnOff = async () => {
    setBusy(true);
    await unsubscribePush();
    toast.success("Notifications are off for this browser.");
    setBusy(false);
    refresh();
  };

  return (
    <section className="profile-form-card">
      <div className="section-heading-row">
        <div>
          <p className="profile-section-eyebrow">NOTIFICATIONS</p>
          <h2>Browser notifications</h2>
          <p className="section-help">
            Get instant alerts on this device for payments, withdrawals, loans
            and account activity, even when the website is closed.
          </p>
        </div>
      </div>

      {status === "loading" && <div className="profile-loading">Checking...</div>}

      {status === "unsupported" && (
        <p className="settings-note">
          This browser does not support website notifications. On an iPhone, add
          the website to your Home Screen first.
        </p>
      )}

      {status === "denied" && (
        <p className="settings-note">
          Notifications are blocked for this website. Allow them in your
          browser's site settings (the icon next to the address bar), then come
          back here.
        </p>
      )}

      {(status === "on" || status === "off") && (
        <div className="settings-toggle-row">
          <div>
            <strong>{status === "on" ? "On for this browser" : "Off for this browser"}</strong>
            <small>This only affects the browser you are using now.</small>
          </div>
          <button
            type="button"
            className={status === "on" ? "settings-btn-secondary" : "settings-btn-primary"}
            onClick={status === "on" ? turnOff : turnOn}
            disabled={busy}
          >
            {busy ? "Please wait..." : status === "on" ? "Turn off" : "Turn on"}
          </button>
        </div>
      )}
    </section>
  );
}

function DevicesPanel() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useFlash(error, "error");

  useEffect(() => {
    request("/devices")
      .then((data) => setDevices(data.devices || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const when = (value) => (value ? new Date(value).toLocaleString() : "Not recorded");

  return (
    <section className="profile-form-card">
      <div className="section-heading-row">
        <div>
          <p className="profile-section-eyebrow">DEVICES</p>
          <h2>Where you are signed in</h2>
          <p className="section-help">
            Devices and browsers that have signed in to your account, with the
            time of their last sign-in. If you see one you do not recognise,
            change your password straight away.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="profile-loading">Loading devices...</div>
      ) : devices.length === 0 ? (
        <div className="profile-empty">No devices recorded yet.</div>
      ) : (
        <ul className="device-list">
          {devices.map((device) => (
            <li key={device.id} className="device-item">
              <span className="device-icon">
                {device.kind === "browser" ? <FaDesktop /> : <FaMobileAlt />}
              </span>
              <span className="device-text">
                <strong>
                  {device.name}
                  {device.current && <em className="device-badge">This device</em>}
                </strong>
                <small>Last signed in: {when(device.lastSeen)}</small>
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="settings-note">
        To sign out all your other devices at once, use <strong>Settings → My
        devices</strong> in the mobile app.
      </p>
    </section>
  );
}

function HelpPanel() {
  return (
    <section className="profile-form-card">
      <div className="section-heading-row">
        <div>
          <p className="profile-section-eyebrow">HELP &amp; LEGAL</p>
          <h2>Support and policies</h2>
        </div>
      </div>

      <div className="profile-links settings-links">
        <SettingsRow to="/contact" icon={FaHeadset} title="Help & support" sub="Contact the cooperative" />
        <SettingsRow to="/privacy" icon={FaUserShield} title="Privacy policy" sub="How we use and protect your data" />
        <SettingsRow to="/terms" icon={FaFileAlt} title="Terms & conditions" sub="Membership and loan terms" />
        <SettingsRow to="/delete-account" icon={FaTrashAlt} title="Delete account" sub="Remove your account and personal details" danger />
      </div>
    </section>
  );
}

function Settings() {
  const { user } = useAuth();
  const location = useLocation();

  const hash = location.hash.replace("#", "");
  const active = TABS.some((tab) => tab.id === hash) ? hash : "security";

  // Password
  const [pwForm, setPwForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  useFlash(pwMsg, "auto");
  const [pwError, setPwError] = useState("");
  useFlash(pwError, "error");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Withdrawal PIN
  const [hasPin, setHasPin] = useState(false);
  const [pinLoading, setPinLoading] = useState(true);

  const [pinForm, setPinForm] = useState({
    pin: "",
    confirmPin: "",
  });

  const [changePinForm, setChangePinForm] = useState({
    currentPin: "",
    newPin: "",
    confirmPin: "",
  });

  const [pinSaving, setPinSaving] = useState(false);
  const [pinMsg, setPinMsg] = useState("");
  useFlash(pinMsg, "auto");
  const [pinError, setPinError] = useState("");
  useFlash(pinError, "error");
  const [changePinOpen, setChangePinOpen] = useState(false);

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

  const passwordChecks = getPasswordChecks(pwForm.newPassword);
  const passwordScore = Object.values(passwordChecks).filter(Boolean).length;
  const passwordStrength =
    passwordScore === 0
      ? ""
      : passwordScore <= 1
        ? "Weak"
        : passwordScore === 2
          ? "Fair"
          : passwordScore === 3
            ? "Good"
            : "Strong";

  const handlePasswordChange = async (e) => {
    e.preventDefault();

    setPwMsg("");
    setPwError("");

    if (!isStrongPassword(pwForm.newPassword)) {
      setPwError(
        "New password must be at least 8 characters and include uppercase and lowercase letters, a number, and a special character."
      );
      return;
    }

    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwError("New passwords do not match.");
      return;
    }

    try {
      setPwSaving(true);

      const result = await request("/users/me/password", {
        method: "PATCH",
        token: user.token,
        body: {
          currentPassword: pwForm.currentPassword,
          newPassword: pwForm.newPassword,
        },
      });

      setPwMsg(result.message || "Password updated successfully.");

      setPwForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
    } catch (err) {
      setPwError(err.message);
    } finally {
      setPwSaving(false);
    }
  };

  const handleCreatePin = async () => {
    setPinMsg("");
    setPinError("");

    if (!/^\d{4}$/.test(pinForm.pin)) {
      setPinError("Withdrawal PIN must contain exactly 4 digits.");
      return;
    }

    if (pinForm.pin !== pinForm.confirmPin) {
      setPinError("Withdrawal PINs do not match.");
      return;
    }

    try {
      setPinSaving(true);

      const result = await request("/withdrawals/pin", {
        method: "POST",
        token: user.token,
        body: {
          pin: pinForm.pin,
          confirmPin: pinForm.confirmPin,
        },
      });

      setHasPin(true);

      setPinForm({
        pin: "",
        confirmPin: "",
      });

      setPinMsg(result.message || "Withdrawal PIN created successfully.");
    } catch (err) {
      setPinError(err.message);
    } finally {
      setPinSaving(false);
    }
  };

  const handleChangePin = async () => {
    setPinMsg("");
    setPinError("");

    if (!/^\d{4}$/.test(changePinForm.currentPin)) {
      setPinError("Current PIN must contain exactly 4 digits.");
      return;
    }

    if (!/^\d{4}$/.test(changePinForm.newPin)) {
      setPinError("New PIN must contain exactly 4 digits.");
      return;
    }

    if (changePinForm.newPin !== changePinForm.confirmPin) {
      setPinError("New withdrawal PINs do not match.");
      return;
    }

    try {
      setPinSaving(true);

      const result = await request("/withdrawals/pin", {
        method: "PATCH",
        token: user.token,
        body: {
          currentPin: changePinForm.currentPin,
          newPin: changePinForm.newPin,
          confirmPin: changePinForm.confirmPin,
        },
      });

      setChangePinOpen(false);

      setChangePinForm({
        currentPin: "",
        newPin: "",
        confirmPin: "",
      });

      setPinMsg(result.message || "Withdrawal PIN changed successfully.");
    } catch (err) {
      setPinError(err.message);
    } finally {
      setPinSaving(false);
    }
  };

  const updatePinField = (field) => (e) => {
    setPinForm((prev) => ({
      ...prev,
      [field]: e.target.value.replace(/\D/g, "").slice(0, 4),
    }));
  };

  const updateChangePinField = (field) => (e) => {
    setChangePinForm((prev) => ({
      ...prev,
      [field]: e.target.value.replace(/\D/g, "").slice(0, 4),
    }));
  };

  return (
    <main className="profile-page settings-page">
      <header className="settings-header">
        <Link to="/profile" className="settings-back">
          &larr; Back to profile
        </Link>
        <p className="profile-eyebrow">ACCOUNT</p>
        <h1>Settings</h1>
        <p className="settings-sub">
          Manage your security, notifications and devices.
        </p>
      </header>

      <div className="settings-layout">
        <nav className="settings-menu" aria-label="Settings sections">
          {TABS.map((tab) => (
            <Link
              key={tab.id}
              to={{ hash: `#${tab.id}` }}
              replace
              className={`settings-menu-item${active === tab.id ? " active" : ""}`}
            >
              <span className="settings-menu-icon">
                <tab.icon />
              </span>
              <span className="settings-menu-text">
                <strong>{tab.label}</strong>
                <small>{tab.sub}</small>
              </span>
            </Link>
          ))}
        </nav>

        <div className="settings-panel">
          {active === "security" && (
            <>
      <section className="profile-form-card security-card">
        <div className="section-heading-row">
          <div>
            <p className="profile-section-eyebrow">SECURITY</p>

            <h2>Account Security</h2>

            <p className="section-help">
              Manage your login password and withdrawal security PIN. Your
              withdrawal PIN is separate from your login password and is used
              only when authorizing withdrawals.
            </p>
          </div>

          <div className="security-icon">✓</div>
        </div>

        {/* PASSWORD */}
        <div className="security-section">
          <div className="security-section-heading">
            <div>
              <h3>Login Password</h3>
              <p>Change the password you use to sign in to your account.</p>
            </div>
          </div>

          <form onSubmit={handlePasswordChange} className="stacked-form">
            <div className="security-form-grid">
              <div className="form-group">
                <label htmlFor="currentPassword">Current Password</label>

                <div className="profile-password-wrapper">
                  <input
                    id="currentPassword"
                    type={showCurrentPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    value={pwForm.currentPassword}
                    onChange={(e) =>
                      setPwForm((prev) => ({
                        ...prev,
                        currentPassword: e.target.value,
                      }))
                    }
                  />
                  <button
                    type="button"
                    className="profile-password-toggle"
                    onClick={() => setShowCurrentPassword((prev) => !prev)}
                    aria-label={showCurrentPassword ? "Hide current password" : "Show current password"}
                  >
                    {showCurrentPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="newPassword">New Password</label>

                <div className={`profile-password-wrapper ${passwordStrength === "Strong" ? "password-strong" : ""}`}>
                  <input
                    id="newPassword"
                    type={showNewPassword ? "text" : "password"}
                    required
                    autoComplete="new-password"
                    value={pwForm.newPassword}
                    onChange={(e) =>
                      setPwForm((prev) => ({
                        ...prev,
                        newPassword: e.target.value,
                      }))
                    }
                    aria-describedby="profile-password-requirements"
                  />
                  <button
                    type="button"
                    className="profile-password-toggle"
                    onClick={() => setShowNewPassword((prev) => !prev)}
                    aria-label={showNewPassword ? "Hide new password" : "Show new password"}
                  >
                    {showNewPassword ? "Hide" : "Show"}
                  </button>
                </div>

                {pwForm.newPassword && (
                  <div className="password-strength" aria-live="polite">
                    <div className="strength-header">
                      <span>Password strength</span>
                      <strong className={`strength-${passwordStrength.toLowerCase()}`}>
                        {passwordStrength}
                      </strong>
                    </div>

                    <div className="strength-bars" aria-hidden="true">
                      {[1, 2, 3, 4].map((bar) => (
                        <span
                          key={bar}
                          className={`strength-bar ${bar <= passwordScore ? `active strength-${passwordStrength.toLowerCase()}` : ""}`}
                        />
                      ))}
                    </div>

                    <ul id="profile-password-requirements" className="password-requirements">
                      <li className={passwordChecks.length ? "met" : ""}>
                        At least 8 characters
                      </li>
                      <li className={passwordChecks.upperLower ? "met" : ""}>
                        Uppercase and lowercase letters
                      </li>
                      <li className={passwordChecks.number ? "met" : ""}>
                        At least one number
                      </li>
                      <li className={passwordChecks.special ? "met" : ""}>
                        At least one special character
                      </li>
                    </ul>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="confirmNewPassword">Confirm New Password</label>

                <div className="profile-password-wrapper">
                  <input
                    id="confirmNewPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    required
                    autoComplete="new-password"
                    value={pwForm.confirmPassword}
                    onChange={(e) =>
                      setPwForm((prev) => ({
                        ...prev,
                        confirmPassword: e.target.value,
                      }))
                    }
                  />
                  <button
                    type="button"
                    className="profile-password-toggle"
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                    aria-label={showConfirmPassword ? "Hide confirmation password" : "Show confirmation password"}
                  >
                    {showConfirmPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
            </div>



            <button type="submit" className="btn-primary" disabled={pwSaving}>
              {pwSaving ? "Updating..." : "Update Password"}
            </button>
          </form>
        </div>

        {/* WITHDRAWAL PIN */}
        <div className="security-section withdrawal-security">
          <div className="security-section-heading">
            <div>
              <h3>Withdrawal PIN</h3>

              <p>
                A separate 4-digit PIN used to authorize withdrawals from your
                cooperative savings.
              </p>
            </div>

            {!pinLoading && (
              <span className={`pin-status ${hasPin ? "enabled" : "not-set"}`}>
                {hasPin ? "PIN Enabled" : "Not Set"}
              </span>
            )}
          </div>

          {pinLoading ? (
            <div className="security-loading">
              Checking withdrawal security...
            </div>
          ) : !hasPin ? (
            <div className="pin-create-box">
              <div className="pin-create-header">
                <span className="pin-check">+</span>

                <div>
                  <strong>Create your withdrawal PIN</strong>
                  <p>
                    You need a withdrawal PIN before you can request money from
                    your savings.
                  </p>
                </div>
              </div>

              <div className="pin-form-grid">
                <div className="form-group">
                  <label htmlFor="withdrawalPin">4-Digit PIN</label>

                  <input
                    id="withdrawalPin"
                    type="password"
                    inputMode="numeric"
                    maxLength="4"
                    autoComplete="off"
                    value={pinForm.pin}
                    onChange={updatePinField("pin")}
                    placeholder="••••"
                    disabled={pinSaving}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="confirmWithdrawalPin">Confirm PIN</label>

                  <input
                    id="confirmWithdrawalPin"
                    type="password"
                    inputMode="numeric"
                    maxLength="4"
                    autoComplete="off"
                    value={pinForm.confirmPin}
                    onChange={updatePinField("confirmPin")}
                    placeholder="••••"
                    disabled={pinSaving}
                  />
                </div>
              </div>



              <button
                type="button"
                className="btn-primary"
                onClick={handleCreatePin}
                disabled={pinSaving}
              >
                {pinSaving ? "Creating PIN..." : "Create Withdrawal PIN"}
              </button>
            </div>
          ) : (
            <div className="pin-enabled-box">
              <div className="pin-enabled-content">
                <div className="pin-success-icon">✓</div>

                <div>
                  <strong>Your withdrawal PIN is active</strong>
                  <p>
                    Your PIN is securely stored and is never visible to
                    administrators.
                  </p>
                </div>
              </div>

              <button
                type="button"
                className="secondary-security-btn"
                onClick={() => {
                  setChangePinOpen((prev) => !prev);
                  setPinError("");
                  setPinMsg("");

                  setChangePinForm({
                    currentPin: "",
                    newPin: "",
                    confirmPin: "",
                  });
                }}
              >
                {changePinOpen ? "Cancel" : "Change Withdrawal PIN"}
              </button>
            </div>
          )}

          {/* CHANGE PIN */}
          {hasPin && changePinOpen && (
            <div className="pin-change-box">
              <h4>Change Withdrawal PIN</h4>

              <p>Enter your current PIN and create a new 4-digit PIN.</p>

              <div className="pin-form-grid pin-change-grid">
                <div className="form-group">
                  <label htmlFor="currentWithdrawalPin">Current PIN</label>

                  <input
                    id="currentWithdrawalPin"
                    type="password"
                    inputMode="numeric"
                    maxLength="4"
                    autoComplete="off"
                    value={changePinForm.currentPin}
                    onChange={updateChangePinField("currentPin")}
                    placeholder="••••"
                    disabled={pinSaving}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="newWithdrawalPin">New PIN</label>

                  <input
                    id="newWithdrawalPin"
                    type="password"
                    inputMode="numeric"
                    maxLength="4"
                    autoComplete="off"
                    value={changePinForm.newPin}
                    onChange={updateChangePinField("newPin")}
                    placeholder="••••"
                    disabled={pinSaving}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="confirmNewWithdrawalPin">
                    Confirm New PIN
                  </label>

                  <input
                    id="confirmNewWithdrawalPin"
                    type="password"
                    inputMode="numeric"
                    maxLength="4"
                    autoComplete="off"
                    value={changePinForm.confirmPin}
                    onChange={updateChangePinField("confirmPin")}
                    placeholder="••••"
                    disabled={pinSaving}
                  />
                </div>
              </div>



              <button
                type="button"
                className="btn-primary"
                onClick={handleChangePin}
                disabled={pinSaving}
              >
                {pinSaving ? "Changing PIN..." : "Update Withdrawal PIN"}
              </button>
            </div>
          )}
        </div>
      </section>
            </>
          )}

          {active === "notifications" && <NotificationsPanel />}
          {active === "devices" && <DevicesPanel />}
          {active === "help" && <HelpPanel />}
        </div>
      </div>
    </main>
  );
}

export default Settings;
