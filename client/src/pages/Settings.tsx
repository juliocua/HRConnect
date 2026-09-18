import { useState, useEffect } from 'react';
import api from '@/lib/api';

interface AppSettings {
  requireOtp?: string; // 'true' | 'false'
}

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Local state mirrors the checkbox
  const [requireOtp, setRequireOtp] = useState(true);

  useEffect(() => {
    api.get<AppSettings>('/settings')
      .then(res => {
        setSettings(res.data);
        // Default to true if key is absent
        setRequireOtp(res.data.requireOtp !== 'false');
      })
      .catch(() => setError('Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await api.put<AppSettings>('/settings', { requireOtp });
      setSettings(res.data);
      setRequireOtp(res.data.requireOtp !== 'false');
      setSuccessMsg('Settings saved.');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch {
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Global Settings</h1>
          <p className="page-subtitle">System-wide configuration — Super Admin only</p>
        </div>
      </div>

      {loading ? (
        <div className="loading-center" style={{ minHeight: 200 }}>
          <div className="spinner" />
        </div>
      ) : (
        <div style={{ maxWidth: 560 }}>
          <div className="card" style={{ padding: '28px 32px' }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 20, color: 'var(--color-text-primary)' }}>
              Authentication
            </h2>

            {error && <div className="error-msg" style={{ marginBottom: 16 }}>{error}</div>}
            {successMsg && (
              <div style={{
                background: 'var(--color-success-bg, #d1fae5)',
                color: 'var(--color-success, #065f46)',
                border: '1px solid var(--color-success-border, #6ee7b7)',
                borderRadius: 6,
                padding: '10px 14px',
                fontSize: 13,
                marginBottom: 16,
              }}>
                {successMsg}
              </div>
            )}

            {/* Require OTP toggle */}
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 14, cursor: 'pointer', marginBottom: 24 }}>
              <div style={{ paddingTop: 2 }}>
                <input
                  type="checkbox"
                  checked={requireOtp}
                  onChange={e => setRequireOtp(e.target.checked)}
                  style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--color-primary)' }}
                />
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-text-primary)', marginBottom: 3 }}>
                  Require OTP for Employee login
                </div>
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                  When checked, employees must verify a 6-digit SMS code after entering their
                  password. Uncheck to allow all users (including employees) to log in with
                  just their password — useful when SMS delivery is unavailable.
                </div>
              </div>
            </label>

            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
