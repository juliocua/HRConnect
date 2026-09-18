import { useState, useRef, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

const NAV = [
  { to: '/hub', label: 'Time & Attendance', icon: '🕐', end: true },
  { to: '/hub/leave', label: 'My Leave', icon: '🏖️', end: false },
  { to: '/hub/overtime', label: 'Overtime', icon: '⏱️', end: false },
  { to: '/hub/payslips', label: 'My Payslips', icon: '💰', end: false },
  { to: '/hub/expenses', label: 'Expense Reimbursement', icon: '🧾', end: false },
];

export default function EmployeeHubLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<HTMLDivElement>(null);

  const handleLogout = () => { logout(); navigate('/login'); };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        setMobileOpen(false);
      }
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
        setAvatarMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const initials = user?.name
    ? user.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', display: 'flex' }}>
      <style>{`
        .hub-sidebar {
          width: 220px;
          min-width: 220px;
          background: var(--color-surface);
          border-right: 1px solid var(--color-border);
          display: flex;
          flex-direction: column;
          position: sticky;
          top: 0;
          height: 100vh;
          overflow-y: auto;
          z-index: 10;
          flex-shrink: 0;
        }
        .hub-right {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .hub-topbar {
          display: none;
          background: var(--color-surface);
          border-bottom: 1px solid var(--color-border);
          height: 56px;
          padding: 0 16px;
          align-items: center;
          justify-content: space-between;
          position: sticky;
          top: 0;
          z-index: 100;
          flex-shrink: 0;
        }
        .hub-drawer-overlay {
          display: none;
          position: fixed;
          inset: 56px 0 0 0;
          background: rgba(0,0,0,0.35);
          z-index: 200;
        }
        .hub-drawer {
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 240px;
          background: var(--color-surface);
          border-right: 1px solid var(--color-border);
          display: flex;
          flex-direction: column;
          box-shadow: 4px 0 16px rgba(0,0,0,0.12);
        }
        .hub-main {
          flex: 1;
          padding: 28px 32px;
          max-width: 960px;
          width: 100%;
          margin: 0 auto;
          box-sizing: border-box;
        }
        .hub-nav-link {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 16px;
          border-radius: 8px;
          font-weight: 600;
          font-size: 13.5px;
          text-decoration: none;
          color: var(--color-text-secondary);
          transition: all 0.15s;
          margin: 2px 8px;
          background: none;
          border: none;
          cursor: pointer;
          width: calc(100% - 16px);
          text-align: left;
          box-sizing: border-box;
        }
        .hub-nav-link:hover {
          background: var(--color-surface-2);
          color: var(--color-text-primary);
        }
        .hub-nav-link.active {
          background: var(--color-primary-light);
          color: var(--color-primary);
        }
        @media (max-width: 768px) {
          .hub-sidebar { display: none !important; }
          .hub-topbar { display: flex !important; }
          .hub-drawer-overlay.open { display: block !important; }
          .hub-main { padding: 16px !important; }
        }
      `}</style>

      {/* Desktop Sidebar */}
      <aside className="hub-sidebar">
        {/* Logo */}
        <div style={{ padding: '18px 16px 12px', borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 8, background: '#0F2744',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px', flexShrink: 0,
            }}>HR</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--color-text-primary)', lineHeight: 1.2 }}>Employee Hub</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>HRConnect</div>
            </div>
          </div>
        </div>

        {/* Nav links */}
        <nav style={{ flex: 1, paddingTop: 8, paddingBottom: 8 }}>
          {NAV.map(n => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => `hub-nav-link${isActive ? ' active' : ''}`}
            >
              <span style={{ fontSize: 16 }}>{n.icon}</span>
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Bottom: user + signout */}
        <div style={{ borderTop: '1px solid var(--color-border)', padding: '10px 8px 12px' }}>
          <button
            onClick={() => navigate('/hub/profile')}
            style={{
              width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px', borderRadius: 8,
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'var(--color-primary)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, flexShrink: 0,
            }}>{initials}</div>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.name}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Employee</div>
            </div>
          </button>
          <button
            onClick={handleLogout}
            style={{
              width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px', borderRadius: 8,
              fontSize: 13, fontWeight: 600, color: 'var(--color-danger)', marginTop: 2, transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            <span style={{ fontSize: 16 }}>🚪</span> Sign Out
          </button>
        </div>
      </aside>

      {/* Right side */}
      <div className="hub-right">
        {/* Mobile top bar */}
        <header className="hub-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 7, background: '#0F2744',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 800, color: '#fff', flexShrink: 0,
            }}>HR</div>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-text-primary)' }}>Employee Hub</div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Avatar dropdown */}
            <div ref={avatarRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setAvatarMenuOpen(o => !o)}
                style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: 'var(--color-primary)', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer',
                }}
              >{initials}</button>
              {avatarMenuOpen && (
                <div style={{
                  position: 'absolute', right: 0, top: 'calc(100% + 8px)',
                  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                  borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                  minWidth: 160, overflow: 'hidden', zIndex: 300,
                }}>
                  <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border)' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>{user?.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Employee</div>
                  </div>
                  <button
                    onClick={() => { setAvatarMenuOpen(false); navigate('/hub/profile'); }}
                    style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '10px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}
                  ><span>👤</span> Edit Profile</button>
                  <button
                    onClick={handleLogout}
                    style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '10px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: 8 }}
                  ><span>🚪</span> Sign Out</button>
                </div>
              )}
            </div>

            {/* Hamburger */}
            <div ref={drawerRef}>
              <button
                onClick={() => setMobileOpen(o => !o)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 36, height: 36, background: 'none', border: 'none', cursor: 'pointer',
                  borderRadius: 8, color: 'var(--color-text-secondary)',
                }}
                aria-label="Menu"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        </header>

        {/* Mobile drawer overlay */}
        <div
          className={`hub-drawer-overlay${mobileOpen ? ' open' : ''}`}
          onClick={() => setMobileOpen(false)}
        >
          <div className="hub-drawer" onClick={e => e.stopPropagation()}>
            <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>{user?.name}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Employee</div>
            </div>
            <nav style={{ flex: 1, paddingTop: 8, paddingBottom: 8 }}>
              {NAV.map(n => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) => `hub-nav-link${isActive ? ' active' : ''}`}
                >
                  <span style={{ fontSize: 17 }}>{n.icon}</span>
                  <span>{n.label}</span>
                </NavLink>
              ))}
              <button
                onClick={() => { setMobileOpen(false); navigate('/hub/profile'); }}
                className="hub-nav-link"
              >
                <span style={{ fontSize: 17 }}>👤</span> Edit Profile
              </button>
            </nav>
            <div style={{ borderTop: '1px solid var(--color-border)', padding: '10px 8px 14px' }}>
              <button
                onClick={handleLogout}
                style={{
                  width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 8px', borderRadius: 8,
                  fontSize: 14, fontWeight: 600, color: 'var(--color-danger)',
                }}
              >
                <span style={{ fontSize: 17 }}>🚪</span> Sign Out
              </button>
            </div>
          </div>
        </div>

        {/* Main content */}
        <main className="hub-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
