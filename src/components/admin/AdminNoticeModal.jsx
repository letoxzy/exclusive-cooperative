import { FaCheck, FaTriangleExclamation, FaXmark } from "react-icons/fa6";

function AdminNoticeModal({ open, type = "success", title, message, onClose }) {
  if (!open) return null;

  const isError = type === "error";
  const Icon = isError ? FaTriangleExclamation : FaCheck;

  return (
    <div className="admin-notice-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="admin-notice-title">
      <div className="admin-notice-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="admin-notice-close" onClick={onClose} aria-label="Close">
          <FaXmark />
        </button>
        <div className={`admin-notice-icon ${isError ? "error" : "success"}`}><Icon /></div>
        <h3 id="admin-notice-title">{title}</h3>
        <p>{message}</p>
        <button type="button" className="admin-notice-button" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

export default AdminNoticeModal;
