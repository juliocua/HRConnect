import { Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import Layout from '@/components/Layout';
import EmployeeHubLayout from '@/components/EmployeeHubLayout';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Employees from '@/pages/Employees';
import Attendance from '@/pages/Attendance';
import Leave from '@/pages/Leave';
import Payroll from '@/pages/Payroll';
import HubClock from '@/pages/hub/HubClock';
import HubLeave from '@/pages/hub/HubLeave';
import HubPayslips from '@/pages/hub/HubPayslips';
import HubProfile from '@/pages/hub/HubProfile';
import Clients from '@/pages/Clients';
import ClientDetail from '@/pages/ClientDetail';
import ClientBilling from '@/pages/ClientBilling';
import Reports from '@/pages/Reports';
import BulkImport from '@/pages/BulkImport';
import LeaveSetup from '@/pages/LeaveSetup';
import Overtime from '@/pages/Overtime';
import HubOvertime from '@/pages/hub/HubOvertime';

// Handles /auth/callback?token=xxx from OAuth redirects
function OAuthCallback() {
  const [params] = useSearchParams();
  const { setTokenAndFetchUser } = useAuth();

  useEffect(() => {
    const token = params.get('token');
    if (token) {
      setTokenAndFetchUser(token).catch(() => {
        window.location.href = '/login?error=oauth';
      });
    } else {
      window.location.href = '/login?error=oauth';
    }
  }, [params, setTokenAndFetchUser]);

  return (
    <div className="loading-center" style={{ minHeight: '100vh' }}>
      <div className="spinner" />
      <span>Signing you in…</span>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="loading-center" style={{ minHeight: '100vh' }}>
        <div className="spinner" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { user } = useAuth();
  const isEmployee = user?.role === 'EMPLOYEE';

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <Login />}
      />
      <Route path="/auth/callback" element={<OAuthCallback />} />

      {/* Employee Hub — for EMPLOYEE role */}
      <Route
        path="/hub"
        element={
          <ProtectedRoute>
            <EmployeeHubLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<HubClock />} />
        <Route path="leave" element={<HubLeave />} />
        <Route path="overtime" element={<HubOvertime />} />
        <Route path="payslips" element={<HubPayslips />} />
        <Route path="profile" element={<HubProfile />} />
      </Route>

      {/* HR Portal — for HR_STAFF, HR_MANAGER, SUPER_ADMIN */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            {isEmployee ? <Navigate to="/hub" replace /> : <Layout />}
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="employees" element={<Employees />} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="leave" element={<Leave />} />
        <Route path="payroll" element={<Payroll />} />
        <Route path="clients" element={<Clients />} />
        <Route path="clients/:id" element={<ClientDetail />} />
        <Route path="billing" element={<ClientBilling />} />
        <Route path="reports" element={<Reports />} />
        <Route path="import" element={<BulkImport />} />
        <Route path="leave-setup" element={<LeaveSetup />} />
        <Route path="overtime" element={<Overtime />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
