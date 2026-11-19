import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { FaDownload, FaTimes } from "react-icons/fa";
import {
  getInstallEvent,
  isInstalledApp,
  isIos,
  onInstallChange,
} from "../utils/pwa";
import "../styles/install-prompt.css";

const SNOOZE_KEY = "installPromptSnoozedAt";
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000; // ask again after two weeks
const SHOW_AFTER_MS = 12000; // let the page settle (and the notification card go first)

const readSnooze = () => {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) || 0);
  } catch {
    return 0;
  }
};

// The iPhone / iPad "Share" button.
function ShareIcon() {
  return (
    <svg
      className="install-share-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}

/**
 * Offers to install the website as an app.
 *  - Android / Chrome / Edge: an "Install" button that opens the browser's own
 *    install box.
 *  - iPhone / iPad: Apple gives websites no install button, so we show the two
 *    steps (Share, then Add to Home Screen).
 * Hidden once installed, on the admin page, and for two weeks after "Not now".
 */
function InstallPrompt() {
  const location = useLocation();
  const [mode, setMode] = useState(null); // "native" | "ios" | null
  const [visible, setVisible] = useState(false);

  // Work out which kind of offer (if any) applies to this browser.
  useEffect(() => {
    if (isInstalledApp()) return undefined;

    const update = () => {
      if (isInstalledApp()) return setMode(null);
      if (getInstallEvent()) return setMode("native");
      setMode(isIos() ? "ios" : null);
    };

    update();
    return onInstallChange(update);
  }, []);

  // Show it after a short delay, and not while the notification card is open.
  useEffect(() => {
    setVisible(false);
    if (!mode || Date.now() - readSnooze() < SNOOZE_MS) return undefined;

    let timer;
    const tryShow = () => {
      if (document.querySelector(".push-prompt")) {
        timer = setTimeout(tryShow, 8000);
        return;
      }
      setVisible(true);
    };

    timer = setTimeout(tryShow, SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [mode]);

  const snooze = () => {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now()));
    } catch {
      // Not being able to remember the choice is fine.
    }
    setVisible(false);
  };

  const install = async () => {
    const event = getInstallEvent();
    if (!event) return;
    event.prompt();
    try {
      await event.userChoice;
    } finally {
      setVisible(false);
    }
  };

  // Staff work on the admin page in a browser, so no offer there.
  if (!visible || !mode || location.pathname.startsWith("/admin")) return null;

  return (
    <div className="install-prompt" role="dialog" aria-label="Install the app">
      <button
        type="button"
        className="install-close"
        onClick={snooze}
        aria-label="Close"
      >
        <FaTimes />
      </button>

      <span className="install-icon" aria-hidden="true">
        <FaDownload />
      </span>

      <div className="install-body">
        <strong>Install the Exclusive Cooperative app</strong>

        {mode === "native" ? (
          <>
            <p>Open your account faster from your home screen, like any other app.</p>
            <div className="install-actions">
              <button type="button" className="install-yes" onClick={install}>
                Install
              </button>
              <button type="button" className="install-no" onClick={snooze}>
                Not now
              </button>
            </div>
          </>
        ) : (
          <>
            <p>
              Tap <ShareIcon /> <strong>Share</strong> at the bottom of your
              screen, then choose <strong>Add to Home Screen</strong>.
            </p>
            <div className="install-actions">
              <button type="button" className="install-no" onClick={snooze}>
                Got it
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default InstallPrompt;
