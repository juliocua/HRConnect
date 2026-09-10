import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useToast } from '@/lib/toast';
import { useAuth } from '@/context/AuthContext';
import type { LeaveRequest, LeaveBalance, LeaveType, LeaveStatus } from '@/types';

const STATUS_COLORS: Record<LeaveStatus, string> = {
  PENDING: 'badge-yellow', APPROVED: 'badge-green',
  REJECTED: 'badge-red', CANCELLED: 'badge-gray',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function HubLeave() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'requests' | 'balances'>('balances');
  const [showModal, setShowModal] = useState(false);

  const { data: requests = [], isLoading: reqLoading } = useQuery<LeaveRequest[]>({
    queryKey: ['hub-leave'],
    queryFn: () => api.get('/leave/me').then(r => r.data),
  });

  const { data: balances = [], isLoading: balLoading } = useQuery<LeaveBalance[]>({
    queryKey: ['hub-leave-balances'],
    queryFn: () => api.get('/leave/me/balances').then(r => r.data),
  });

  const pending = requests.filter(r => r.status === 'PENDING').length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>My Leave</h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>
            {pending > 0 ? `${pending} pending request${pending > 1 ? 's' : ''}` : 'Your leave requests and balances'}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>＋ File Leave</button>
      </div>

      {/* Tabs */}
      <div className="tabs" style={{ maxWidth: 300, marginBottom: 20 }}>
        <button className={`tab-btn${activeTab === 'balances' ? ' active' : ''}`} onClick={() => setActiveTab('balances')}>Balances</button>
        <button className={`tab-btn${activeTab === 'requests' ? ' active' : ''}`} onClick={() => setActiveTab('requests')}>Requests</button>
      </div>

      {activeTab === 'balances' && (
        balLoading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : balances.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📊</div>
            <div className="empty-state-title">No leave balances found</div>
            <div>Contact HR to set up your leave entitlements</div>
          </div>
        ) : (
          <div className="grid-3">
            {balances.map(b => {
              const remaining = b.totalDays - b.usedDays - b.pendingDays;
              const pct = b.totalDays > 0 ? Math.max(0, Math.min(100, (b.usedDays / b.totalDays) * 100)) : 0;
              return (
                <div key={b.id} className="card">
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{b.leaveType.name}</div>
                    <div className="text-muted text-sm">{b.leaveType.isPaid ? 'Paid Leave' : 'Unpaid'} · {b.year}</div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    {[
                      { label: 'Remaining', value: remaining, color: 'var(--color-primary)' },
                      { label: 'Used', value: b.usedDays, color: 'var(--color-text-primary)' },
                      { label: 'Pending', value: b.pendingDays, color: 'var(--color-warning)' },
                      { label: 'Total', value: b.totalDays, color: 'var(--color-text-muted)' },
                    ].map(s => (
                      <div key={s.label} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</div>
                        <div className="text-muted text-sm">{s.label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ background: 'var(--color-surface-2)', borderRadius: 99, height: 6, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, background: pct > 80 ? 'var(--color-danger)' : 'var(--color-primary)', height: '100%', borderRadius: 99 }} />
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {activeTab === 'requests' && (
        reqLoading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : requests.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🏖️</div>
            <div className="empty-state-title">No leave requests yet</div>
            <div>File a leave request using the button above</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Leave Type</th>
                  <th>Dates</th>
                  <th>Days</th>
                  <th>Reason</th>
                  <th>Filed</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(r => (
                  <tr key={r.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.leaveType.name}</div>
                      <div className="text-muted text-sm">{r.leaveType.isPaid ? 'Paid' : 'Unpaid'}</div>
                    </td>
                    <td className="text-sm">
                      <div>{fmtDate(r.startDate)}</div>
                      {r.startDate !== r.endDate && <div className="text-muted">→ {fmtDate(r.endDate)}</div>}
                    </td>
                    <td><strong>{r.totalDays}d</strong></td>
                    <td className="text-muted text-sm" style={{ maxWidth: 180 }}>{r.reason ?? '—'}</td>
                    <td className="text-muted text-sm">{fmtDate(r.filedAt)}</td>
                    <td>
                      <span className={`badge ${STATUS_COLORS[r.status]}`}>{r.status}</span>
                      {r.rejectionNote && (
                        <div className="text-sm text-muted" style={{ marginTop: 3 }} title={r.rejectionNote}>⚠️ {r.rejectionNote}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {showModal && (
        <FileLeaveModal
          balances={balances}
          employeeId={user?.employeeId ?? null}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false);
            qc.invalidateQueries({ queryKey: ['hub-leave'] });
            qc.invalidateQueries({ queryKey: ['hub-leave-balances'] });
          }}
        />
      )}
    </div>
  );
}

function FileLeaveModal({ balances, employeeId, onClose, onSaved }: {
  balances: LeaveBalance[];
  employeeId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { data: leaveTypes = [] } = useQuery<LeaveType[]>({
    queryKey: ['leave-types', employeeId],
    queryFn: () => api.get(`/leave/types${employeeId ? `?employeeId=${employeeId}` : ''}`).then(r => r.data),
  });

  const [form, setForm] = useState({
    leaveTypeId: '',
    startDate: '',
    endDate: '',
    reason: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // Count working days
  const totalDays = (() => {
    if (!form.startDate || !form.endDate) return 0;
    const start = new Date(form.startDate);
    const end = new Date(form.endDate);
    let count = 0;
    const cur = new Date(start);
    while (cur <= end) {
      const day = cur.getDay();
      if (day !== 0 && day !== 6) count++;
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  })();

  // Find balance for selected type
  const selectedBalance = balances.find(b => b.leaveTypeId === form.leaveTypeId);
  const availableDays = selectedBalance
    ? selectedBalance.totalDays - selectedBalance.usedDays - selectedBalance.pendingDays
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (totalDays <= 0) { setError('End date must be after start date.'); return; }
    setSaving(true);
    setError('');
    try {
      await api.post('/leave/me', { ...form, totalDays });
      toast('success', 'Leave filed');
      onSaved();
    } catch (err: unknown) {
      const msg = (err as any)?.response?.data?.error ?? 'Failed to file leave';
      setError(msg);
      toast('error', msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">File Leave Request</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="error-msg">{error}</div>}
            <div className="form-group">
              <label>Leave Type *</label>
              <select className="form-control" required value={form.leaveTypeId} onChange={e => set('leaveTypeId', e.target.value)}>
                <option value="">Select leave type…</option>
                {leaveTypes.map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.daysPerYear}d/yr · {t.isPaid ? 'Paid' : 'Unpaid'})</option>
                ))}
              </select>
              {selectedBalance !== undefined && (
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  Available balance: <strong style={{ color: availableDays! > 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>{availableDays} days</strong>
                </div>
              )}
            </div>
            <div className="form-grid form-grid-2">
              <div className="form-group">
                <label>Start Date *</label>
                <input type="date" className="form-control" required value={form.startDate} onChange={e => set('startDate', e.target.value)} />
              </div>
              <div className="form-group">
                <label>End Date *</label>
                <input type="date" className="form-control" required value={form.endDate} min={form.startDate} onChange={e => set('endDate', e.target.value)} />
              </div>
            </div>
            {totalDays > 0 && (
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: -8, padding: '6px 10px', background: 'var(--color-surface-2)', borderRadius: 6 }}>
                <strong>{totalDays} working day{totalDays > 1 ? 's' : ''}</strong> selected
                {availableDays !== null && totalDays > availableDays && (
                  <span style={{ color: 'var(--color-danger)', marginLeft: 8 }}>⚠️ Exceeds balance</span>
                )}
              </div>
            )}
            <div className="form-group">
              <label>Reason</label>
              <textarea
                className="form-control"
                rows={3}
                placeholder="Optional reason for leave…"
                value={form.reason}
                onChange={e => set('reason', e.target.value)}
                style={{ resize: 'vertical' }}
              />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || totalDays <= 0}>
              {saving ? 'Filing…' : 'File Leave Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
