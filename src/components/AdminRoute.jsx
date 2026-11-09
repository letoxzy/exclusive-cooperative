import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

function AdminRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin") return <Navigate to="/dashboard" replace />;
  // New staff accounts start with a temporary password and must replace it
  // before they can use the admin page.
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;

  return children;
}

export default AdminRoute;
