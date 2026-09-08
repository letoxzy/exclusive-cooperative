import { useEffect, useState } from "react";
import { FaXmark } from "react-icons/fa6";

function AdminActionModal({
  open,
  title,
  description,
  label,
  value = "",
  placeholder = "",
  inputType = "text",
  confirmText = "Confirm",
  danger = false,
  loading = false,
  onClose,
  onSubmit,
}) {
  const [inputValue, setInputValue] = useState(value);

  useEffect(() => {
    if (open) setInputValue(value ?? "");
  }, [open, value]);

  if (!open) return null;

  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit(inputValue);
  };

  return (
    <div className="admin-action-modal-backdrop" onMouseDown={onClose}>
      <div
        className="admin-action-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-action-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="admin-action-modal-header">
          <div>
            <p className="admin-action-modal-eyebrow">Admin Action</p>
            <h3 id="admin-action-modal-title">{title}</h3>
          </div>

          <button
            type="button"
            className="admin-action-modal-close"
            onClick={onClose}
            disabled={loading}
            aria-label="Close"
          >
            <FaXmark />
          </button>
        </div>

        <div className="admin-action-modal-body">
          <p className="admin-action-modal-description">{description}</p>

          {label && (
            <label className="admin-action-modal-label">
              {label}
              {inputType === "number" && (
                <span className="admin-action-modal-hint">Amount in Naira</span>
              )}

              {inputType === "textarea" ? (
                <textarea
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  placeholder={placeholder}
                  rows={5}
                  autoFocus
                  disabled={loading}
                />
              ) : (
                <input
                  type={inputType}
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  placeholder={placeholder}
                  min={inputType === "number" ? "0" : undefined}
                  step={inputType === "number" ? "0.01" : undefined}
                  autoFocus
                  disabled={loading}
                />
              )}
            </label>
          )}

          {danger && (
            <div className="admin-action-modal-warning">
              This action cannot be undone. Please confirm before continuing.
            </div>
          )}
        </div>

        <div className="admin-action-modal-footer">
          <button
            type="button"
            className="admin-action-modal-cancel"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </button>

          <button
            type="submit"
            className={`admin-action-modal-confirm ${
              danger ? "danger" : ""
            }`}
            disabled={loading}
            onClick={handleSubmit}
          >
            {loading ? "Processing..." : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AdminActionModal;
