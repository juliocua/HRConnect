import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';

export default function Login() {
  const navigate = useNavigate();

  // Step 1: credential entry
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  // Step 2: OTP entry
  const [step, setStep] = useState<'credentials' | 'otp'>('credentials');
  const [otpUserId, setOtpUserId] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [otp, setOtp] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const storeAndRedirect = (token: string) => {
    localStorage.setItem('hrc_token', token);
    navigate('/', { replace: true });
  };

  // ── Step 1: submit credentials ─────────────────────────────────────────────
  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { identifier, password });
      const data = res.data;

      if (data.requiresOtp) {
        setOtpUserId(data.userId);
        setMaskedPhone(data.maskedPhone ?? '');
        setStep('otp');
      } else {
        storeAndRedirect(data.token);
      }
    } catch (err: unknown) {
      const axiosMsg = (err as any)?.response?.data?.error;
      setError(axiosMsg ?? 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: verify OTP ────────────────────────────────────────────────────
  const handleOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/verify-otp', { userId: otpUserId, code: otp });
      storeAndRedirect(res.data.token);
    } catch (err: unknown) {
      const axiosMsg = (err as any)?.response?.data?.error;
      setError(axiosMsg ?? 'Invalid or expired OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setStep('credentials');
    setOtp('');
    setError('');
    setOtpUserId('');
    setMaskedPhone('');
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-icon">👥</div>
          <span className="login-logo-name">HRConnect</span>
        </div>

        {step === 'credentials' ? (
          <>
            <h1 className="login-heading">Welcome back</h1>
            <p className="login-sub">Sign in to your HR workspace</p>

            {error && <div className="error-msg">{error}</div>}

            <form onSubmit={handleCredentials} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label htmlFor="identifier">Employee Code / Email</label>
                <input
                  id="identifier"
                  type="text"
                  className="form-control"
                  placeholder="EMP-0000000001 or you@company.ph"
                  value={identifier}
                  onChange={e => setIdentifier(e.target.value)}
                  required
                  autoComplete="username"
                />
              </div>
              <div className="form-group">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  className="form-control"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
              <button
                type="submit"
                className="btn btn-primary btn-lg"
                disabled={loading}
                style={{ marginTop: 4 }}
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>

            <p style={{ marginTop: 20, textAlign: 'center', fontSize: 12.5, color: 'var(--color-text-muted)' }}>
              Demo admin: <strong>admin@hrconnect.demo</strong> / <strong>Admin@2026</strong>
            </p>
          </>
        ) : (
          <>
            <h1 className="login-heading">Verify your identity</h1>
            <p className="login-sub" style={{ marginBottom: 6 }}>
              A 6-digit code was sent to
            </p>
            <p style={{ fontWeight: 700, fontSize: 15, color: 'var(--color-text-primary)', marginBottom: 20, textAlign: 'center' }}>
              {maskedPhone}
            </p>

            {error && <div className="error-msg">{error}</div>}

            <form onSubmit={handleOtp} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label htmlFor="otp">One-Time Password</label>
                <input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  className="form-control"
                  placeholder="6-digit code"
                  value={otp}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                  required
                  autoComplete="one-time-code"
                  autoFocus
                  style={{ letterSpacing: '0.3em', textAlign: 'center', fontSize: 20, fontFamily: 'monospace' }}
                />
              </div>
              <button
                type="submit"
                className="btn btn-primary btn-lg"
                disabled={loading || otp.length !== 6}
                style={{ marginTop: 4 }}
              >
                {loading ? 'Verifying…' : 'Verify'}
              </button>
            </form>

            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={handleBack}
              style={{ marginTop: 14, width: '100%' }}
            >
              ← Back to login
            </button>

            <p style={{ marginTop: 14, textAlign: 'center', fontSize: 12, color: 'var(--color-text-muted)' }}>
              Code expires in 5 minutes. Check your registered phone number.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
