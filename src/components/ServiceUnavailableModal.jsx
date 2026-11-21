import { useState, useEffect, useRef } from "react";
import { FaTools } from "react-icons/fa";
import "../styles/service-unavailable.css";

/**
 * The "service not available at the moment" popup. api.js raises a
 * "service-unavailable" event whenever the server refuses a request because an
 * administrator has switched that service off.
 */
export default function ServiceUnavailableModal() {
  const [notice, setNotice] = useState(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    const onEvent = (event) => {
      setNotice({
        message:
          event.detail?.message ||
          "This service is not available at the moment. Please try again later.",
      });
    };
    window.addEventListener("service-unavailable", onEvent);
    return () => window.removeEventListener("service-unavailable", onEvent);
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    buttonRef.current?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") setNotice(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [notice]);

  if (!notice) return null;

  return (
    <div className="svc-backdrop" onClick={() => setNotice(null)}>
      <div
        className="svc-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="svc-modal-title"
        aria-describedby="svc-modal-text"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="svc-modal-icon" aria-hidden="true">
          <FaTools />
        </div>
        <h2 id="svc-modal-title">Service not available</h2>
        <p id="svc-modal-text">{notice.message}</p>
        <button ref={buttonRef} type="button" onClick={() => setNotice(null)}>
          OK
        </button>
      </div>
    </div>
  );
}
