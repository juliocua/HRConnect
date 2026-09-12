import { Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { ToastProvider } from '@/lib/toast';
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

function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 768px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return mobile;
}

function NonEmployeeMobileFallback() {
  const { user, logout } = useAuth();
  const handleLogout = () => { logout(); window.location.href = '/login'; };
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--color-bg)', padding: '32px 24px', textAlign: 'center',
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: 12, background: '#0F2744',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18, fontWeight: 800, color: '#fff', marginBottom: 20,
      }}>HR</div>
      <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--color-text-primary)', marginBottom: 8 }}>
        Desktop Required
      </div>
      <div style={{ fontSize: 14, color: 'var(--color-text-muted)', maxWidth: 280, lineHeight: 1.6, marginBottom: 32 }}>
        The HRConnect admin portal is designed for desktop use. Please open it on a desktop browser.
      </div>
      {user && (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 24 }}>
          Signed in as <strong>{user.name}</strong>
        </div>
      )}
      <button
        onClick={handleLogout}
        className="btn btn-secondary"
        style={{ fontSize: 14 }}
      >
        Sign Out
      </button>
    </div>
  );
}

function AppRoutes() {
  const { user } = useAuth();
  const isEmployee = user?.role === 'EMPLOYEE';
  const isMobile = useIsMobile();

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
            {isEmployee ? <Navigate to="/hub" replace /> : isMobile ? <NonEmployeeMobileFallback /> : <Layout />}
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
      <ToastProvider>
        <AppRoutes />
      </ToastProvider>
    </AuthProvider>
  );
}
