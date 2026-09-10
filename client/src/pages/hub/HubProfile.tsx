import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useToast } from '@/lib/toast';
import { useAuth } from '@/context/AuthContext';
import type { Employee, ProfileChangeRequest } from '@/types';

const API_ORIGIN = (import.meta.env.VITE_API_URL ?? '').replace(/\/api$/, '');
function resolvePhotoUrl(url: string): string {
  try { return `${API_ORIGIN}${new URL(url).pathname}`; } catch { return url; }
}

const AVATAR_COLORS = [
  '#2563EB', '#7C3AED', '#DB2777', '#EA580C',
  '#CA8A04', '#16A34A', '#0891B2', '#DC2626',
];

export default function HubProfile() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();

  const { data: employee, isLoading } = useQuery<Employee>({
    queryKey: ['hub-profile'],
    queryFn: () => api.get('/employees/me').then(r => r.data),
  });

  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState('');

  if (isLoading) return <div className="loading-center"><div className="spinner" /></div>;
  if (!employee) return (
    <div className="empty-state">
      <div className="empty-state-icon">👤</div>
      <div className="empty-state-title">No employee record linked</div>
      <div>Contact HR to link your account to an employee record</div>
    </div>
  );

  const initials = `${employee.firstName[0]}${employee.lastName[0]}`.toUpperCase();
  const onSaved = () => qc.invalidateQueries({ queryKey: ['hub-profile'] });

  const handlePhotoUpload = async (file: File) => {
    setPhotoError('');
    setPhotoUploading(true);
    try {
      const formData = new FormData();
      formData.append('photo', file);
      await api.post(`/employees/${employee.id}/photo`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onSaved();
      toast('success', 'Photo uploaded');
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? 'Upload failed';
      setPhotoError(msg);
      toast('error', msg);
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleRemovePhoto = async () => {
    if (!confirm('Remove your profile photo?')) return;
    setPhotoUploading(true);
    try {
      await api.delete(`/employees/${employee.id}/photo`);
      onSaved();
      toast('success', 'Photo removed');
    } catch {
      toast('error', 'Failed to remove photo');
    } finally {
      setPhotoUploading(false);
    }
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>My Profile</h1>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, marginBottom: 28 }}>
        {employee.firstName} {employee.lastName} · {employee.position} · {employee.department.name}
      </p>

      {/* ── Personal ─────────────────────────────────────────────────── */}
      <section className="card" style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 16 }}>
          Personal
        </div>

        {/* Profile Photo */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 10 }}>Profile Photo</div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
            <div style={{
              width: 80, height: 100, borderRadius: 10,
              background: employee.avatarColor, overflow: 'hidden',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 24, fontWeight: 800, color: '#fff', flexShrink: 0,
            }}>
              {employee.photoUrl
                ? <img src={resolvePhotoUrl(employee.photoUrl)} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
                : initials
              }
            </div>

            <div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 10 }}>
                Half-body portrait photo (recommended 400 × 500 px, max 5 MB)
              </div>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={ev => ev.target.files?.[0] && handlePhotoUpload(ev.target.files[0])}
              />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={photoUploading}
                  onClick={() => photoInputRef.current?.click()}
                >
                  {photoUploading ? 'Uploading…' : employee.photoUrl ? '📷 Change Photo' : '📷 Upload Photo'}
                </button>
                {employee.photoUrl && !photoUploading && (
                  <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--color-danger)' }} onClick={handleRemovePhoto}>
                    Remove
                  </button>
                )}
              </div>
              {photoError && <div style={{ fontSize: 12, color: 'var(--color-danger)', marginTop: 6 }}>{photoError}</div>}
            </div>
          </div>
        </div>

        <div style={{ height: 1, background: 'var(--color-border)', marginBottom: 20 }} />

        {/* Avatar color */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 10 }}>Avatar Color <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--color-text-muted)' }}>(used when no photo)</span></div>
          <AvatarColorPicker
            employeeId={employee.id}
            current={employee.avatarColor}
            initials={initials}
            onSaved={onSaved}
          />
        </div>

        {/* Change password */}
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 12 }}>Password</div>
          <ChangePasswordForm />
        </div>
      </section>

      {/* ── Government IDs ───────────────────────────────────────────── */}
      <section className="card" style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 16 }}>
          Government IDs
        </div>
        <GovtIdsForm employee={employee} onSaved={onSaved} />
      </section>

      {/* ── Contact Details ──────────────────────────────────────────── */}
      <section className="card">
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 16 }}>
          Contact Details
        </div>
        <ContactDetailsForm employee={employee} />
      </section>
    </div>
  );
}

// ── Avatar color picker ────────────────────────────────────────────────────────
function AvatarColorPicker({ employeeId, current, initials, onSaved }: {
  employeeId: string; current: string; initials: string; onSaved: () => void;
}) {
  const toast = useToast();
  const [selected, setSelected] = useState(current);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    if (selected === current) return;
    setSaving(true);
    try {
      await api.patch('/employees/me', { avatarColor: selected });
      onSaved();
      setSaved(true);
      toast('success', 'Avatar color saved');
      setTimeout(() => setSaved(false), 2000);
    } catch {
      toast('error', 'Failed to save avatar color');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {AVATAR_COLORS.map(c => (
          <button
            key={c}
            type="button"
            onClick={() => setSelected(c)}
            title={c}
            style={{
              width: 28, height: 28, borderRadius: '50%', background: c,
              border: 'none', cursor: 'pointer',
              outline: selected === c ? '3px solid var(--color-primary)' : '3px solid transparent',
              outlineOffset: 2, position: 'relative',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {selected === c && (
              <span style={{ color: '#fff', fontSize: 13, fontWeight: 800, lineHeight: 1 }}>✓</span>
            )}
          </button>
        ))}
      </div>
      {selected !== current && (
        <button
          className="btn btn-primary btn-sm"
          disabled={saving}
          onClick={handleSave}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      )}
      {saved && <span style={{ fontSize: 12.5, color: 'var(--color-success)', fontWeight: 600 }}>✓ Saved</span>}
    </div>
  );
}

// ── Change password form ───────────────────────────────────────────────────────
function ChangePasswordForm() {
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => { setForm(f => ({ ...f, [k]: v })); setError(''); setSuccess(false); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.newPassword !== form.confirmPassword) { setError('New passwords do not match'); return; }
    if (form.newPassword.length < 8) { setError('New password must be at least 8 characters'); return; }
    setSaving(true); setError('');
    try {
      await api.post('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      setSuccess(true);
      toast('success', 'Password changed');
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err: unknown) {
      const msg = (err as any)?.response?.data?.error ?? 'Failed to change password';
      setError(msg);
      toast('error', msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}
      {success && (
        <div style={{ background: 'var(--color-success-light, #F0FDF4)', border: '1px solid var(--color-success, #16A34A)', borderRadius: 8, padding: '10px 14px', fontSize: 13.5, color: '#15803D', marginBottom: 12 }}>
          ✓ Password changed successfully
        </div>
      )}
      <div className="form-grid form-grid-2" style={{ gap: 12 }}>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>Current Password *</label>
          <input
            type="password"
            className="form-control"
            required
            autoComplete="current-password"
            value={form.currentPassword}
            onChange={e => set('currentPassword', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label>New Password *</label>
          <input
            type="password"
            className="form-control"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="Min. 8 characters"
            value={form.newPassword}
            onChange={e => set('newPassword', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label>Confirm New Password *</label>
          <input
            type="password"
            className="form-control"
            required
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={e => set('confirmPassword', e.target.value)}
          />
        </div>
      </div>
      <button
        type="submit"
        className="btn btn-primary btn-sm"
        disabled={saving || !form.currentPassword || !form.newPassword || !form.confirmPassword}
        style={{ marginTop: 4 }}
      >
        {saving ? 'Saving…' : 'Change Password'}
      </button>
    </form>
  );
}

// ── Government IDs form ───────────────────────────────────────────────────────
function GovtIdsForm({ employee, onSaved }: { employee: Employee; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    sssNo: employee.sssNo ?? '',
    philhealthNo: employee.philhealthNo ?? '',
    pagibigNo: employee.pagibigNo ?? '',
    tinNo: employee.tinNo ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const set = (k: string, v: string) => { setForm(f => ({ ...f, [k]: v })); setSaved(false); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      await api.patch('/employees/me', form);
      onSaved();
      setSaved(true);
      toast('success', 'Government IDs saved');
    } catch (err: unknown) {
      const msg = (err as any)?.response?.data?.error ?? 'Failed to save';
      setError(msg);
      toast('error', msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="form-grid form-grid-2" style={{ gap: 12 }}>
        <div className="form-group">
          <label>SSS No.</label>
          <input className="form-control font-mono" placeholder="XX-XXXXXXX-X" value={form.sssNo} onChange={e => set('sssNo', e.target.value)} />
        </div>
        <div className="form-group">
          <label>PhilHealth No.</label>
          <input className="form-control font-mono" placeholder="XXXXXXXXXXXX" value={form.philhealthNo} onChange={e => set('philhealthNo', e.target.value)} />
        </div>
        <div className="form-group">
          <label>Pag-IBIG No.</label>
          <input className="form-control font-mono" placeholder="XXXXXXXXXXXX" value={form.pagibigNo} onChange={e => set('pagibigNo', e.target.value)} />
        </div>
        <div className="form-group">
          <label>TIN No.</label>
          <input className="form-control font-mono" placeholder="XXX-XXX-XXX-XXX" value={form.tinNo} onChange={e => set('tinNo', e.target.value)} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
          {saving ? 'Saving…' : 'Save Government IDs'}
        </button>
        {saved && <span style={{ fontSize: 12.5, color: 'var(--color-success)', fontWeight: 600 }}>✓ Saved</span>}
      </div>
    </form>
  );
}

// ── Contact Details form ──────────────────────────────────────────────────────
function ContactDetailsForm({ employee }: { employee: Employee }) {
  const qc = useQueryClient();
  const toast = useToast();

  const { data: requests } = useQuery<ProfileChangeRequest[]>({
    queryKey: ['my-change-requests'],
    queryFn: () => api.get('/employees/me/change-requests').then(r => r.data),
  });

  const latest = requests?.[0];
  const hasPending = latest?.status === 'PENDING';

  const [form, setForm] = useState({
    phone: employee.phone ?? '',
    address: employee.address ?? '',
    emergencyContactName: employee.emergencyContactName ?? '',
    emergencyContactPhone: employee.emergencyContactPhone ?? '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const set = (k: string, v: string) => { setForm(f => ({ ...f, [k]: v })); setError(''); setSuccess(false); };

  const submitMutation = useMutation({
    mutationFn: (data: typeof form) => api.post('/employees/me/change-request', data),
    onSuccess: () => {
      setSuccess(true);
      toast('success', 'Change request submitted');
      qc.invalidateQueries({ queryKey: ['my-change-requests'] });
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error ?? 'Failed to submit request';
      setError(msg);
      toast('error', msg);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess(false);
    submitMutation.mutate(form);
  };

  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div>
      {/* Pending request banner */}
      {hasPending && latest && (
        <div style={{
          background: 'var(--color-warning-light, #FFFBEB)',
          border: '1px solid var(--color-warning, #CA8A04)',
          borderRadius: 8, padding: '12px 14px', marginBottom: 16, fontSize: 13,
        }}>
          <div style={{ fontWeight: 700, color: '#92400E', marginBottom: 6 }}>
            ⏳ Change request pending review
          </div>
          <div style={{ color: '#78350F', marginBottom: 4 }}>Submitted {fmtDate(latest.submittedAt)}</div>
          {Object.entries(latest.changes).map(([k, v]) => (
            <div key={k} style={{ fontSize: 12, color: '#92400E', marginTop: 2 }}>
              <strong>{FIELD_LABELS[k] ?? k}:</strong> {v as string}
            </div>
          ))}
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
            Your current values are shown below. Changes will apply once approved.
          </div>
        </div>
      )}

      {latest?.status === 'REJECTED' && (
        <div style={{
          background: 'var(--color-danger-light, #FEF2F2)',
          border: '1px solid var(--color-danger, #DC2626)',
          borderRadius: 8, padding: '12px 14px', marginBottom: 16, fontSize: 13,
        }}>
          <div style={{ fontWeight: 700, color: '#991B1B', marginBottom: 4 }}>
            ✗ Previous request rejected
          </div>
          {latest.rejectionNote && (
            <div style={{ color: '#7F1D1D', fontSize: 12 }}>Note: {latest.rejectionNote}</div>
          )}
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
            You can submit a new request below.
          </div>
        </div>
      )}

      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 14 }}>
        Changes to contact and emergency information require HR approval. Submitting a new request will supersede any pending one.
      </p>

      <form onSubmit={handleSubmit}>
        {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}
        {success && (
          <div style={{ background: 'var(--color-success-light, #F0FDF4)', border: '1px solid var(--color-success, #16A34A)', borderRadius: 8, padding: '10px 14px', fontSize: 13.5, color: '#15803D', marginBottom: 12 }}>
            ✓ Change request submitted — HR will review shortly
          </div>
        )}

        <div className="form-grid form-grid-2" style={{ gap: 12 }}>
          <div className="form-group">
            <label>Phone</label>
            <input className="form-control" placeholder="+63 9XX XXX XXXX" value={form.phone} onChange={e => set('phone', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Emergency Contact Name</label>
            <input className="form-control" placeholder="Full name" value={form.emergencyContactName} onChange={e => set('emergencyContactName', e.target.value)} />
          </div>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>Home Address</label>
            <input className="form-control" placeholder="Street, City, Province" value={form.address} onChange={e => set('address', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Emergency Contact Phone</label>
            <input className="form-control" placeholder="+63 9XX XXX XXXX" value={form.emergencyContactPhone} onChange={e => set('emergencyContactPhone', e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={submitMutation.isPending}
          >
            {submitMutation.isPending ? 'Submitting…' : 'Submit Change Request'}
          </button>
          {hasPending && (
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              This will replace your pending request
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

const FIELD_LABELS: Record<string, string> = {
  phone: 'Phone',
  address: 'Home Address',
  emergencyContactName: 'Emergency Contact Name',
  emergencyContactPhone: 'Emergency Contact Phone',
};
