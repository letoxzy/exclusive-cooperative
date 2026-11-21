import { useState, useEffect, useCallback } from "react";
import request from "../../utils/api";
import { useAuth } from "../../context/AuthContext";
import { hasPermission } from "../../utils/adminAccess";
import "../../styles/admin-services.css";

const formatWhen = (value) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Africa/Lagos",
  });
};

function ServiceRow({ service, canManage, busy, onToggle, onSaveMessage }) {
  const [draft, setDraft] = useState(service.customMessage || "");

  // Keep the box in step when the list reloads.
  useEffect(() => {
    setDraft(service.customMessage || "");
  }, [service.customMessage]);

  const changed = draft.trim() !== (service.customMessage || "").trim();

  return (
    <div className={`svc-row ${service.available ? "" : "locked"}`}>
      <div className="svc-main">
        <div className="svc-title">
          <h3>{service.label}</h3>
          <span className={`svc-badge ${service.available ? "on" : "off"}`}>
            {service.available ? "Available" : "Locked"}
          </span>
        </div>
        <p className="svc-desc">{service.description}</p>
        {!service.available && service.updatedAt ? (
          <p className="svc-meta">
            Locked {formatWhen(service.updatedAt)}
            {service.updatedByName ? ` by ${service.updatedByName}` : ""}
          </p>
        ) : null}

        <label className="svc-message">
          <span>Message members see while it is locked (optional)</span>
          <div className="svc-message-row">
            <input
              type="text"
              maxLength={200}
              value={draft}
              disabled={!canManage || busy}
              placeholder="This service is not available at the moment. Please try again later."
              onChange={(e) => setDraft(e.target.value)}
            />
            {canManage && changed ? (
              <button
                type="button"
                className="svc-save"
                disabled={busy}
                onClick={() => onSaveMessage(service, draft)}
              >
                Save
              </button>
            ) : null}
          </div>
        </label>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={service.available}
        aria-label={`${service.label} is ${service.available ? "available" : "locked"}`}
        className={`svc-switch ${service.available ? "on" : "off"}`}
        disabled={!canManage || busy}
        onClick={() => onToggle(service)}
      >
        <span className="svc-knob" />
      </button>
    </div>
  );
}

function ServiceControlsPanel({ token }) {
  const { user } = useAuth();
  const canManage = hasPermission(user, "services.manage");

  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await request("/admin/services", { token });
      setServices(Array.isArray(data?.services) ? data.services : []);
    } catch (err) {
      setError(err.message || "Failed to load services.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const patch = async (service, body, doneText) => {
    setBusyKey(service.key);
    setError("");
    setNotice("");
    try {
      const data = await request(`/admin/services/${service.key}`, {
        method: "PATCH",
        token,
        body,
      });
      setServices(Array.isArray(data?.services) ? data.services : []);
      setNotice(doneText);
    } catch (err) {
      setError(err.message || "Failed to update the service.");
    } finally {
      setBusyKey("");
    }
  };

  const toggle = (service) => {
    if (service.available) {
      const ok = window.confirm(
        `Lock "${service.label}"?\n\nMembers will see a "not available at the moment" notice when they try to use it, in the app, on the website and by USSD, until you switch it back on.`,
      );
      if (!ok) return;
    }
    patch(
      service,
      { enabled: !service.available },
      service.available ? `${service.label} is now locked.` : `${service.label} is available again.`,
    );
  };

  const saveMessage = (service, message) =>
    patch(service, { message: message.trim() }, "Message saved.");

  const lockedCount = services.filter((s) => !s.available).length;

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="eyebrow">Service controls</p>
          <h1>Service Controls</h1>
          <p className="admin-subtitle">
            Switch a service off when it has a problem (for example Paystack or the BVN
            provider). Members see a "not available at the moment" notice and the server
            refuses the request, in the app, on the website and by USSD.
          </p>
        </div>
        <div className="admin-page-heading-actions">
          <button type="button" className="admin-refresh-btn" onClick={load} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {error ? <div className="svc-alert error">{error}</div> : null}
      {notice ? <div className="svc-alert ok">{notice}</div> : null}

      {lockedCount > 0 ? (
        <div className="svc-alert warn">
          {lockedCount} {lockedCount === 1 ? "service is" : "services are"} currently locked for members.
        </div>
      ) : null}

      {!canManage ? (
        <div className="svc-alert warn">You can view these switches but not change them.</div>
      ) : null}

      <section className="admin-card svc-card">
        {loading && services.length === 0 ? (
          <p className="svc-empty">Loading services...</p>
        ) : (
          services.map((service) => (
            <ServiceRow
              key={service.key}
              service={service}
              canManage={canManage}
              busy={busyKey === service.key}
              onToggle={toggle}
              onSaveMessage={saveMessage}
            />
          ))
        )}
      </section>

      <p className="svc-footnote">
        Locking a service stops new requests only. Payments or withdrawals already in progress
        still finish, and Paystack confirmations still arrive. Changes take effect within a few
        seconds.
      </p>
    </>
  );
}

export default ServiceControlsPanel;
