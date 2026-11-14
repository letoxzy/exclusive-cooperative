import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

function ProtectedRoute({ children, allowPasswordChange = false }) {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword && !allowPasswordChange) {
    return <Navigate to="/change-password" replace />;
  }

  // Administrator and staff accounts work on the admin page only. The member
  // pages (dashboard, profile, withdrawals, loans...) are for members.
  if (user.role === "admin" && !allowPasswordChange) {
    return <Navigate to="/admin" replace />;
  }

  return children;
}

export default ProtectedRoute;
