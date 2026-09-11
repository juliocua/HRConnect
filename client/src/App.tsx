import { Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { ToastProvider } from '@/lib/toast';
import { canAccess, type Module } from '@/lib/permissions';
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

/** Redirects to /login if not authenticated. */
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

/**
 * Redirects to "/" (which then auto-redirects to the first accessible page)
 * if the user's role does not have access to the given module.
 */
function ModuleRoute({ module, children }: { module: Module; children: React.ReactNode }) {
  const { user } = useAuth();
  if (!canAccess(user?.role, module)) return <Navigate to="/" replace />;
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

      {/* HR Portal — for all non-EMPLOYEE roles */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            {isEmployee ? <Navigate to="/hub" replace /> : <Layout />}
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />

        <Route
          path="employees"
          element={<ModuleRoute module="employees"><Employees /></ModuleRoute>}
        />
        <Route
          path="attendance"
          element={<ModuleRoute module="attendance"><Attendance /></ModuleRoute>}
        />
        <Route
          path="leave"
          element={<ModuleRoute module="leave"><Leave /></ModuleRoute>}
        />
        <Route
          path="payroll"
          element={<ModuleRoute module="payroll"><Payroll /></ModuleRoute>}
        />
        <Route
          path="clients"
          element={<ModuleRoute module="clients"><Clients /></ModuleRoute>}
        />
        <Route
          path="clients/:id"
          element={<ModuleRoute module="clients"><ClientDetail /></ModuleRoute>}
        />
        <Route
          path="billing"
          element={<ModuleRoute module="billing"><ClientBilling /></ModuleRoute>}
        />
        <Route
          path="reports"
          element={<ModuleRoute module="reports"><Reports /></ModuleRoute>}
        />
        <Route
          path="import"
          element={<ModuleRoute module="import"><BulkImport /></ModuleRoute>}
        />
        <Route
          path="leave-setup"
          element={<ModuleRoute module="leaveSetup"><LeaveSetup /></ModuleRoute>}
        />
        <Route
          path="overtime"
          element={<ModuleRoute module="overtime"><Overtime /></ModuleRoute>}
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppRoutes />
      </ToastProvider>
    </AuthProvider>
  );
}
