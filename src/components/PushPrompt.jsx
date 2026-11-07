import { useEffect, useState } from "react";
import { FaBell } from "react-icons/fa";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import {
  isPushSupported,
  sendTestPush,
  subscribePush,
} from "../utils/webPush";
import "../styles/push-prompt.css";

const SNOOZE_KEY = "pushPromptSnoozedAt";
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000; // ask again after a week

const readSnooze = () => {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) || 0);
  } catch {
    return 0;
  }
};

function PushPrompt() {
  const { user } = useAuth();
  const toast = useToast();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setVisible(false);
    if (!user?._id || !isPushSupported()) return undefined;

    // Already allowed: quietly keep this browser registered to this account.
    if (Notification.permission === "granted") {
      subscribePush().catch(() => {});
      return undefined;
    }
    if (Notification.permission === "denied") return undefined;
    if (Date.now() - readSnooze() < SNOOZE_MS) return undefined;

    const timer = setTimeout(() => setVisible(true), 2500);
    return () => clearTimeout(timer);
  }, [user?._id]);

  const snooze = () => {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now()));
    } catch {
      // Not being able to remember the choice is fine.
    }
    setVisible(false);
  };

  const enable = async () => {
    setBusy(true);
    try {
      const result = await subscribePush({ prompt: true });

      if (result.ok) {
        setVisible(false);
        toast.success("Notifications are on for this browser.");
        sendTestPush().catch(() => {});
      } else if (result.reason === "denied") {
        setVisible(false);
        toast.error(
          "Notifications are blocked. Allow them in your browser's site settings to turn them on.",
        );
      } else if (result.reason === "not-configured") {
        setVisible(false);
        toast.info("Website notifications are not available yet.");
      } else {
        // The member closed the browser's permission box without choosing.
        snooze();
      }
    } catch (err) {
      toast.error(err.message || "Could not turn on notifications.");
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="push-prompt" role="dialog" aria-label="Turn on notifications">
      <span className="push-prompt-icon" aria-hidden="true">
        <FaBell />
      </span>
      <div className="push-prompt-body">
        <strong>Stay up to date</strong>
        <p>
          Get instant alerts for payments, withdrawals, loans and account
          activity.
        </p>
        <div className="push-prompt-actions">
          <button
            type="button"
            className="push-prompt-yes"
            onClick={enable}
            disabled={busy}
          >
            {busy ? "Turning on..." : "Turn on"}
          </button>
          <button type="button" className="push-prompt-no" onClick={snooze}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

export default PushPrompt;
