import { useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useState, useEffect } from 'react';

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  '/': { title: 'Dashboard', subtitle: 'Welcome back 👋' },
  '/employees': { title: 'Employees', subtitle: 'Manage your workforce' },
  '/attendance': { title: 'Attendance', subtitle: 'Track daily time & attendance' },
  '/leave': { title: 'Leave', subtitle: 'Manage leave requests & balances' },
  '/payroll': { title: 'Payroll', subtitle: 'Philippine payroll processing' },
};

export default function TopBar() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const meta = PAGE_META[pathname] ?? { title: 'HRConnect', subtitle: '' };
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="topbar-title">{meta.title}</div>
        {meta.subtitle && <div className="topbar-subtitle">{meta.subtitle}</div>}
      </div>
      <div className="topbar-right">
        {/* Date */}
        <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)', display: 'none' }} id="topbar-date">
          {new Date().toLocaleDateString('en-PH', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })}
        </span>

        {/* Theme toggle */}
        <button className="icon-btn" onClick={() => setDark(d => !d)} title="Toggle theme">
          {dark ? <IconSun /> : <IconMoon />}
        </button>

        {/* User avatar */}
        <div className="avatar" style={{ background: 'var(--color-primary)', cursor: 'default' }}>
          {user?.avatarUrl
            ? <img src={user.avatarUrl} alt={user.name} />
            : initials(user?.name ?? '')}
        </div>
      </div>
    </header>
  );
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function IconSun() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  );
}

function IconMoon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}
