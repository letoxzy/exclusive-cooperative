import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "../styles/toast.css";

const ToastContext = createContext(null);

const MAX_TOASTS = 4;
const DURATION = { success: 4500, info: 4500, error: 6500 };
const ICON = { success: "✓", error: "!", info: "i" };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((type, message) => {
    const text = String(message ?? "").trim();
    if (!text) return;

    setToasts((prev) => {
      // The same message twice in a row just restarts the existing toast.
      const existing = prev.find((t) => t.type === type && t.message === text);
      if (existing) {
        return prev.map((t) =>
          t.id === existing.id ? { ...t, bump: t.bump + 1 } : t,
        );
      }
      const next = [
        ...prev,
        { id: nextId.current++, type, message: text, bump: 0 },
      ];
      return next.slice(-MAX_TOASTS);
    });
  }, []);

  const api = useMemo(
    () => ({
      success: (message) => show("success", message),
      error: (message) => show("error", message),
      info: (message) => show("info", message),
      dismiss,
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-viewport" aria-live="polite">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onClose={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onClose }) {
  const [paused, setPaused] = useState(false);

  // Auto-dismiss; hovering pauses it, and a repeated message restarts it.
  useEffect(() => {
    if (paused) return undefined;
    const timer = setTimeout(() => onClose(toast.id), DURATION[toast.type]);
    return () => clearTimeout(timer);
  }, [paused, toast.id, toast.type, toast.bump, onClose]);

  return (
    <div
      className={`toast toast-${toast.type}`}
      role={toast.type === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <span className="toast-icon" aria-hidden="true">
        {ICON[toast.type]}
      </span>
      <p className="toast-message">{toast.message}</p>
      <button
        type="button"
        className="toast-close"
        aria-label="Dismiss"
        onClick={() => onClose(toast.id)}
      >
        ×
      </button>
    </div>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside ToastProvider");
  return value;
}

const SUCCESS_WORDS =
  /success|updated|saved|created|changed|sent|submitted|approved|removed|deleted|set up|has been/i;
const ERROR_WORDS =
  /fail|error|invalid|incorrect|unable|could not|couldn't|cannot|can't|not match|do not|must|required|expired|denied|wrong|too many|try again/i;

// Used for state strings that hold either kind of message.
const guessType = (message) => {
  if (ERROR_WORDS.test(message)) return "error";
  if (SUCCESS_WORDS.test(message)) return "success";
  return "info";
};

/**
 * Shows a toast whenever `message` becomes a non-empty string.
 * Lets a page keep its existing `error` / `success` state and simply drop the
 * inline <p className="form-error"> - clear the state before retrying so the
 * same text can appear again. type: "error" | "success" | "info" | "auto".
 */
export function useFlash(message, type = "error") {
  const toast = useToast();
  useEffect(() => {
    if (!message) return;
    toast[type === "auto" ? guessType(message) : type](message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);
}

/** Same, for state shaped like { type: "success" | "error", text }. */
export function useFlashMessage(message) {
  const toast = useToast();
  useEffect(() => {
    if (!message?.text) return;
    toast[message.type === "error" ? "error" : "success"](message.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);
}
