import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface ClientInfo {
  id: string;
  name: string;
  contactName?: string | null;
  contactEmail?: string | null;
  _count: { employees: number };
}

export default function ClientHubLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const { data: client } = useQuery<ClientInfo>({
    queryKey: ['client-hub-me'],
    queryFn: () => api.get('/client-hub/me').then(r => r.data),
  });

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-page, #f5f5f5)' }}>
      {/* Sidebar */}
      <aside style={{
        width: 240,
        background: '#1a2332',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}>
        {/* Logo */}
        <div style={{ padding: '24px 20px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>HRConnect</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>Client Portal</div>
        </div>

        {/* Client info */}
        {client && (
          <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 2 }}>{client.name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>{client._count.employees} employee{client._count.employees !== 1 ? 's' : ''}</div>
          </div>
        )}

        {/* Nav */}
        <nav style={{ flex: 1, padding: '12px 10px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '8px 10px 4px' }}>
            Approvals
          </div>
          <NavLink
            to="/client-hub/dtr"
            style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 10px', borderRadius: 6,
              color: isActive ? '#fff' : 'rgba(255,255,255,0.6)',
              background: isActive ? 'rgba(255,255,255,0.12)' : 'transparent',
              textDecoration: 'none', fontSize: 13, fontWeight: isActive ? 600 : 400,
              transition: 'all 0.15s',
            })}
          >
            <IconDTR /> DTR Approvals
          </NavLink>
          <NavLink
            to="/client-hub/overtime"
            style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 10px', borderRadius: 6,
              color: isActive ? '#fff' : 'rgba(255,255,255,0.6)',
              background: isActive ? 'rgba(255,255,255,0.12)' : 'transparent',
              textDecoration: 'none', fontSize: 13, fontWeight: isActive ? 600 : 400,
              transition: 'all 0.15s',
            })}
          >
            <IconOT /> OT Approvals
          </NavLink>
        </nav>

        {/* Footer */}
        <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 2 }}>
            {user?.name}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 10 }}>Client User</div>
          <button
            onClick={handleLogout}
            style={{
              width: '100%', padding: '7px 12px', background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6,
              color: 'rgba(255,255,255,0.7)', fontSize: 12, cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, overflow: 'auto' }}>
        <Outlet />
      </main>
    </div>
  );
}

function IconDTR() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
      <path d="M9 16l2 2 4-4"/>
    </svg>
  );
}

function IconOT() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      <path d="M16 16l2 2"/>
    </svg>
  );
}
