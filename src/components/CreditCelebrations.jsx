import { useState, useEffect, useMemo, useCallback } from "react";
import { FaGift, FaTrophy, FaTimes } from "react-icons/fa";
import request from "../utils/api";
import { getCredits } from "../utils/credits";
import "../styles/credit-celebration.css";

const naira = (value) => `₦${Math.round(Math.abs(Number(value) || 0)).toLocaleString("en-NG")}`;

function copyFor(kind, credit, hidden) {
  const amount = hidden ? "" : naira(credit.amount);

  if (kind === "dividend") {
    if (credit.count > 1) {
      return {
        title: "Congratulations! Your dividends have arrived",
        body: hidden
          ? `You have received ${credit.count} dividend payments. Thank you for helping the cooperative grow.`
          : `You have received ${credit.count} dividend payments totalling ${amount}. Thank you for helping the cooperative grow.`,
      };
    }
    return {
      title: "Congratulations! Your dividend has arrived",
      body: hidden
        ? "Your dividend has been paid. Thank you for helping the cooperative grow."
        : `Your dividend of ${amount} has been paid. Thank you for helping the cooperative grow.`,
    };
  }

  const now = credit.current !== undefined && !hidden ? ` It is now ${naira(credit.current)}.` : "";
  return {
    title: "Congratulations! Your shareholding has grown",
    body: hidden
      ? "Your shareholding has increased. You now own a bigger stake in the cooperative."
      : `Your shareholding increased by ${amount}.${now} You now own a bigger stake in the cooperative.`,
  };
}

function Card({ kind, credit, hidden, onDismiss }) {
  const { title, body } = copyFor(kind, credit, hidden);
  const Icon = kind === "dividend" ? FaGift : FaTrophy;

  return (
    <div className="credit-card" role="status">
      <div className="credit-icon" aria-hidden="true">
        <Icon />
      </div>
      <div className="credit-text">
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
      <button type="button" className="credit-close" onClick={onDismiss} aria-label="Dismiss">
        <FaTimes />
      </button>
    </div>
  );
}

/**
 * Congratulation cards for a dividend or shareholding credit. It reads the
 * member's unread notifications itself and marks them read when dismissed.
 */
export default function CreditCelebrations({ token, hidden = false }) {
  const [notifications, setNotifications] = useState([]);
  const [dismissed, setDismissed] = useState([]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await request("/notifications", { token });
      setNotifications(Array.isArray(data) ? data : []);
    } catch {
      // Keep the last list if the network is unavailable.
    }
  }, [token]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load]);

  const credits = useMemo(() => {
    const found = getCredits(notifications);
    const visible = (credit) =>
      credit && !credit.ids.every((id) => dismissed.includes(id)) ? credit : null;
    return { dividend: visible(found.dividend), shareholding: visible(found.shareholding) };
  }, [notifications, dismissed]);

  const dismiss = (ids) => {
    setDismissed((current) => [...current, ...ids]);
    ids.forEach((id) => {
      request(`/notifications/${id}/read`, { method: "PATCH", token }).catch(() => {});
    });
  };

  if (!credits.dividend && !credits.shareholding) return null;

  return (
    <div className="credit-stack">
      {credits.dividend && (
        <Card kind="dividend" credit={credits.dividend} hidden={hidden} onDismiss={() => dismiss(credits.dividend.ids)} />
      )}
      {credits.shareholding && (
        <Card kind="shareholding" credit={credits.shareholding} hidden={hidden} onDismiss={() => dismiss(credits.shareholding.ids)} />
      )}
    </div>
  );
}
