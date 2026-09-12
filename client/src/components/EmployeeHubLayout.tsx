import { useState, useRef, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

const NAV = [
  { to: '/hub', label: 'Time & Attendance', icon: '🕐', short: 'Clock', end: true },
  { to: '/hub/leave', label: 'My Leave', icon: '🏖️', short: 'Leave', end: false },
  { to: '/hub/overtime', label: 'Overtime', icon: '⏱️', short: 'OT', end: false },
  { to: '/hub/payslips', label: 'My Payslips', icon: '💰', short: 'Payslips', end: false },
];

export default function EmployeeHubLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const mobileNavRef = useRef<HTMLDivElement>(null);

  const handleLogout = () => { logout(); navigate('/login'); };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      if (mobileNavRef.current && !mobileNavRef.current.contains(e.target as Node)) {
        setMobileNavOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const initials = user?.name
    ? user.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        @media (max-width: 640px) {
          .hub-nav-desktop { display: none !important; }
          .hub-user-label { display: none !important; }
          .hub-hamburger { display: flex !important; }
          .hub-main { padding: 16px !important; }
        }
        @media (min-width: 641px) {
          .hub-hamburger { display: none !important; }
          .hub-mobile-menu { display: none !important; }
        }
      `}</style>

      {/* Top bar */}
      <header style={{
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
        padding: '0 16px',
        height: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 8, background: '#0F2744',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px',
            flexShrink: 0,
          }}>HR</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-text-primary)', lineHeight: 1.2 }}>Employee Hub</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>HRConnect</div>
          </div>
        </div>

        {/* Desktop nav links */}
        <nav className="hub-nav-desktop" style={{ display: 'flex', gap: 4 }}>
          {NAV.map(n => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 8,
                fontWeight: 600, fontSize: 13, textDecoration: 'none',
                color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                background: isActive ? 'var(--color-primary-light)' : 'transparent',
                transition: 'all 0.15s',
              })}
            >
              <span>{n.icon}</span>
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Right side: avatar + mobile hamburger */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Mobile hamburger */}
          <div ref={mobileNavRef} style={{ position: 'relative' }}>
            <button
              className="hub-hamburger"
              onClick={() => setMobileNavOpen(o => !o)}
              style={{
                display: 'none', // overridden by CSS at mobile
                alignItems: 'center', justifyContent: 'center',
                width: 36, height: 36,
                background: 'none', border: 'none', cursor: 'pointer',
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

            {mobileNavOpen && (
              <div className="hub-mobile-menu" style={{
                position: 'absolute', right: 0, top: 'calc(100% + 8px)',
                background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                minWidth: 200, overflow: 'hidden', zIndex: 300,
              }}>
                {NAV.map(n => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    end={n.end}
                    onClick={() => setMobileNavOpen(false)}
                    style={({ isActive }) => ({
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '12px 16px', textDecoration: 'none',
                      fontWeight: 600, fontSize: 14,
                      color: isActive ? 'var(--color-primary)' : 'var(--color-text-primary)',
                      background: isActive ? 'var(--color-primary-light)' : 'transparent',
                      borderBottom: '1px solid var(--color-border)',
                    })}
                  >
                    <span>{n.icon}</span>
                    <span>{n.label}</span>
                  </NavLink>
                ))}
                <button
                  onClick={() => { setMobileNavOpen(false); navigate('/hub/profile'); }}
                  style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '12px 16px', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--color-border)' }}
                >
                  <span>👤</span> My Profile
                </button>
                <button
                  onClick={handleLogout}
                  style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '12px 16px', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: 10 }}
                >
                  <span>🚪</span> Sign Out
                </button>
              </div>
            )}
          </div>

          {/* Avatar + dropdown (desktop) */}
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setMenuOpen(o => !o)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '6px 8px', borderRadius: 10,
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              <div className="hub-user-label" style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>{user?.name}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Employee</div>
              </div>
              <div style={{
                width: 34, height: 34, borderRadius: '50%',
                background: 'var(--color-primary)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700, flexShrink: 0,
              }}>{initials}</div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                className="hub-nav-desktop"
                style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {menuOpen && (
              <div style={{
                position: 'absolute', right: 0, top: 'calc(100% + 8px)',
                background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                minWidth: 180, overflow: 'hidden', zIndex: 200,
              }}>
                {/* User info header */}
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>{user?.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 1 }}>{user?.email}</div>
                </div>
                {/* Menu items */}
                <div style={{ padding: '6px 0' }}>
                  <button
                    onClick={() => { setMenuOpen(false); navigate('/hub/profile'); }}
                    style={{
                      width: '100%', textAlign: 'left', background: 'none', border: 'none',
                      padding: '9px 16px', cursor: 'pointer', fontSize: 13.5, fontWeight: 500,
                      color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: 10,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    <span>👤</span> Edit Profile
                  </button>
                  <div style={{ height: 1, background: 'var(--color-border)', margin: '4px 0' }} />
                  <button
                    onClick={handleLogout}
                    style={{
                      width: '100%', textAlign: 'left', background: 'none', border: 'none',
                      padding: '9px 16px', cursor: 'pointer', fontSize: 13.5, fontWeight: 500,
                      color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: 10,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    <span>🚪</span> Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="hub-main" style={{ flex: 1, padding: '28px 32px', maxWidth: 960, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        <Outlet />
      </main>
    </div>
  );
}