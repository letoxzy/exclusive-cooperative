import { lazy, Suspense } from "react";
import { Routes, Route, useLocation } from "react-router-dom";

import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import ProtectedRoute from "./components/ProtectedRoute";
import AdminRoute from "./components/AdminRoute";

// Lazy-loaded pages
const Home = lazy(() => import("./pages/Home"));
const Gallery = lazy(() => import("./pages/Gallery"));
const About = lazy(() => import("./pages/About"));
const Membership = lazy(() => import("./pages/Membership"));
const Savings = lazy(() => import("./pages/Savings"));
const Loans = lazy(() => import("./pages/Loans"));
const Contact = lazy(() => import("./pages/Contact"));
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Profile = lazy(() => import("./pages/Profile"));
const ChangePassword = lazy(() => import("./pages/ChangePassword"));
const Withdrawals = lazy(() => import("./pages/Withdrawals"));
const PaymentCallback = lazy(() => import("./pages/PaymentCallback"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const LoanApplication = lazy(() => import("./pages/LoanApplication"));
const FullLoanApplication = lazy(() => import("./pages/FullLoanApplication"));

function App() {
  const location = useLocation();

  // Admin has its own completely separate layout.
  const isAdminPage = location.pathname.startsWith("/admin");

  return (
    <>
      {!isAdminPage && <Navbar />}

      <div className={!isAdminPage ? "site-content" : ""}>
        <Suspense
          fallback={
            <div className="page-loading">
              <p>Loading...</p>
            </div>
          }
        >
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

            <Route path="/forgot-password" element={<ForgotPassword />} />

            <Route path="/reset-password/:token" element={<ResetPassword />} />

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
        </Suspense>
      </div>

      {!isAdminPage && <Footer />}
    </>
  );
}

export default App;
