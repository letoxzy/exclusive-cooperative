import { Routes, Route, useLocation } from "react-router-dom";

import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import ProtectedRoute from "./components/ProtectedRoute";
import AdminRoute from "./components/AdminRoute";

import Home from "./pages/Home";
import Gallery from "./pages/Gallery";
import About from "./pages/About";
import Membership from "./pages/Membership";
import Savings from "./pages/Savings";
import Loans from "./pages/Loans";
import Contact from "./pages/Contact";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import Profile from "./pages/Profile";
import ChangePassword from "./pages/ChangePassword";
import Withdrawals from "./pages/Withdrawals";
import PaymentCallback from "./pages/PaymentCallback";
import AdminDashboard from "./pages/AdminDashboard";

import LoanApplication from "./pages/LoanApplication";
import FullLoanApplication from "./pages/FullLoanApplication";

function App() {
  const location = useLocation();

  // Admin has its own completely separate layout.
  const isAdminPage = location.pathname.startsWith("/admin");

  return (
    <>
      {!isAdminPage && <Navbar />}

      <div className={!isAdminPage ? "site-content" : ""}>
        <Routes>
          <Route path="/" element={<Home />} />

          <Route path="/about" element={<About />} />

          <Route path="/gallery" element={<Gallery />} />

          <Route
            path="/membership"
            element={
              <ProtectedRoute>
                <Membership />
              </ProtectedRoute>
            }
          />

          <Route path="/savings" element={<Savings />} />

          <Route path="/loans" element={<Loans />} />

          <Route
            path="/loans/apply"
            element={
              <ProtectedRoute>
                <LoanApplication />
              </ProtectedRoute>
            }
          />

          <Route
            path="/loans/apply-full"
            element={
              <ProtectedRoute>
                <FullLoanApplication />
              </ProtectedRoute>
            }
          />

          <Route path="/contact" element={<Contact />} />

          <Route path="/login" element={<Login />} />

          <Route path="/register" element={<Register />} />

          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />

          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />

          <Route
            path="/change-password"
            element={
              <ProtectedRoute allowPasswordChange>
                <ChangePassword />
              </ProtectedRoute>
            }
          />

          <Route
            path="/withdrawals"
            element={
              <ProtectedRoute>
                <Withdrawals />
              </ProtectedRoute>
            }
          />

          <Route
            path="/payment-callback"
            element={
              <ProtectedRoute>
                <PaymentCallback />
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin"
            element={
              <AdminRoute>
                <AdminDashboard />
              </AdminRoute>
            }
          />
        </Routes>
      </div>

      {!isAdminPage && <Footer />}
    </>
  );
}

export default App;
