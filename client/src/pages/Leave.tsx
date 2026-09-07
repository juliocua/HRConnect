import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import type { LeaveRequest, LeaveBalance, LeaveType, Employee, LeaveStatus } from '@/types';

const STATUS_COLORS: Record<LeaveStatus, string> = {
  PENDING: 'badge-yellow', APPROVED: 'badge-green',
  REJECTED: 'badge-red', CANCELLED: 'badge-gray',
};

export default function Leave() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState('');
  const [empFilter, setEmpFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [rejModal, setRejModal] = useState<LeaveRequest | null>(null);
  const [activeTab, setActiveTab] = useState<'requests' | 'balances'>('requests');

  const { data: requests = [], isLoading } = useQuery<LeaveRequest[]>({
    queryKey: ['leaves', statusFilter, empFilter],
    queryFn: () => {
      const p = new URLSearchParams();
      if (statusFilter) p.set('status', statusFilter);
      if (empFilter) p.set('employeeId', empFilter);
      return api.get(`/leave?${p}`).then(r => r.data);
    },
  });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ['employees'],
    queryFn: () => api.get('/employees?status=ACTIVE').then(r => r.data),
  });

  const { data: balances = [] } = useQuery<LeaveBalance[]>({
    queryKey: ['leave-balances', empFilter],
    queryFn: () =>
      empFilter
        ? api.get(`/leave/balances/${empFilter}`).then(r => r.data)
        : Promise.resolve([]),
    enabled: !!empFilter && activeTab === 'balances',
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.put(`/leave/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leaves'] }),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      api.put(`/leave/${id}/reject`, { rejectionNote: note }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leaves'] }); setRejModal(null); },
  });

  const pending = requests.filter(r => r.status === 'PENDING').length;
  const approved = requests.filter(r => r.status === 'APPROVED').length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Leave Management</h1>
          <p className="page-desc">{pending} pending · {approved} approved this cycle</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          ＋ File Leave
        </button>
      </div>

      {/* Tabs */}
      <div className="tabs" style={{ maxWidth: 300, marginBottom: 20 }}>
        <button className={`tab-btn${activeTab === 'requests' ? ' active' : ''}`} onClick={() => setActiveTab('requests')}>Requests</button>
        <button className={`tab-btn${activeTab === 'balances' ? ' active' : ''}`} onClick={() => setActiveTab('balances')}>Balances</button>
      </div>

      {activeTab === 'requests' && (
        <>
          {/* Filters */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="filter-bar">
              <select className="form-control" style={{ width: 220 }} value={empFilter} onChange={e => setEmpFilter(e.target.value)}>
                <option value="">All Employees</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
              </select>
              <select className="form-control" style={{ width: 160 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="">All Statuses</option>
                <option value="PENDING">Pending</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
          </div>

          {isLoading ? (
            <div className="loading-center"><div className="spinner" /></div>
          ) : requests.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🏖️</div>
              <div className="empty-state-title">No leave requests</div>
              <div>File a new leave request to get started</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Leave Type</th>
                    <th>Dates</th>
                    <th>Days</th>
                    <th>Reason</th>
                    <th>Filed</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map(r => (
                    <tr key={r.id}>
                      <td>
                        <div className="emp-info">
                          <div className="emp-avatar" style={{ background: r.employee.avatarColor }}>
                            {r.employee.firstName[0]}{r.employee.lastName[0]}
                          </div>
                          <div>
                            <div className="emp-name">{r.employee.firstName} {r.employee.lastName}</div>
                            <div className="emp-role">{r.employee.position}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div>{r.leaveType.name}</div>
                        <div className="text-muted text-sm">{r.leaveType.isPaid ? 'Paid' : 'Unpaid'}</div>
                      </td>
                      <td className="text-sm">
                        <div>{formatDate(r.startDate)}</div>
                        {r.startDate !== r.endDate && <div className="text-muted">→ {formatDate(r.endDate)}</div>}
                      </td>
                      <td><strong>{r.totalDays}</strong></td>
                      <td className="text-muted text-sm" style={{ maxWidth: 160 }}>{r.reason ?? '—'}</td>
                      <td className="text-muted text-sm">{formatDate(r.filedAt)}</td>
                      <td>
                        <div>
                          <span className={`badge ${STATUS_COLORS[r.status]}`}>{r.status}</span>
                          {r.rejectionNote && (
                            <div className="text-sm text-muted" style={{ marginTop: 3 }} title={r.rejectionNote}>
                              ⚠️ Note
                            </div>
                          )}
                        </div>
                      </td>
                      <td>
                        {r.status === 'PENDING' && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              className="btn btn-success btn-sm"
                              disabled={approveMutation.isPending}
                              onClick={() => approveMutation.mutate(r.id)}
                            >
                              Approve
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ color: 'var(--color-danger)' }}
                              onClick={() => setRejModal(r)}
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {activeTab === 'balances' && (
        <div>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="filter-bar">
              <select className="form-control" style={{ width: 260 }} value={empFilter} onChange={e => setEmpFilter(e.target.value)}>
                <option value="">Select an employee to view balances…</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
              </select>
            </div>
          </div>

          {!empFilter ? (
            <div className="empty-state">
              <div className="empty-state-icon">📊</div>
              <div className="empty-state-title">Select an employee</div>
              <div>Choose an employee above to view their leave balances</div>
            </div>
          ) : balances.length === 0 ? (
            <div className="loading-center"><div className="spinner" /></div>
          ) : (
            <div className="grid-3">
              {balances.map(b => {
                const used = b.usedDays;
                const pending = b.pendingDays;
                const total = b.totalDays;
                const remaining = total - used - pending;
                const pct = Math.max(0, Math.min(100, (used / total) * 100));
                return (
                  <div key={b.id} className="card">
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>{b.leaveType.name}</div>
                      <div className="text-muted text-sm">{b.leaveType.isPaid ? 'Paid Leave' : 'Unpaid Leave'} · {b.year}</div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--color-primary)' }}>{remaining}</div>
                        <div className="text-muted text-sm">Remaining</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 22, fontWeight: 800 }}>{used}</div>
                        <div className="text-muted text-sm">Used</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--color-warning)' }}>{pending}</div>
                        <div className="text-muted text-sm">Pending</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--color-text-muted)' }}>{total}</div>
                        <div className="text-muted text-sm">Total</div>
                      </div>
                    </div>
                    <div style={{ background: 'var(--color-surface-2)', borderRadius: 99, height: 6, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, background: pct > 80 ? 'var(--color-danger)' : 'var(--color-primary)', height: '100%', borderRadius: 99 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showModal && (
        <LeaveModal
          employees={employees}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); qc.invalidateQueries({ queryKey: ['leaves'] }); }}
        />
      )}

      {rejModal && (
        <RejectModal
          request={rejModal}
          onClose={() => setRejModal(null)}
          onReject={(note) => rejectMutation.mutate({ id: rejModal.id, note })}
          loading={rejectMutation.isPending}
        />
      )}
    </div>
  );
}

function LeaveModal({ employees, onClose, onSaved }: {
  employees: Employee[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    employeeId: '',
    leaveTypeId: '',
    startDate: '',
    endDate: '',
    reason: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const { data: leaveTypes = [] } = useQuery<LeaveType[]>({
    queryKey: ['leave-types'],
    queryFn: () => api.get('/leave/types').then(r => r.data),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/leave', form);
      onSaved();
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setError((err as any)?.response?.data?.error ?? 'Failed to file leave');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={ev => ev.target === ev.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">File Leave Request</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="error-msg">{error}</div>}
            <div className="form-group">
              <label>Employee *</label>
              <select className="form-control" required value={form.employeeId} onChange={e => set('employeeId', e.target.value)}>
                <option value="">Select employee…</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Leave Type *</label>
              <select className="form-control" required value={form.leaveTypeId} onChange={e => set('leaveTypeId', e.target.value)}>
                <option value="">Select leave type…</option>
                {leaveTypes.map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.daysPerYear}d/yr · {t.isPaid ? 'Paid' : 'Unpaid'})</option>
                ))}
              </select>
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
            <div className="form-group">
              <label>Reason</label>
              <textarea className="form-control" rows={3} placeholder="Optional reason…" value={form.reason} onChange={e => set('reason', e.target.value)} style={{ resize: 'vertical' }} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Filing…' : 'File Leave Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RejectModal({ request: r, onClose, onReject, loading }: {
  request: LeaveRequest;
  onClose: () => void;
  onReject: (note: string) => void;
  loading: boolean;
}) {
  const [note, setNote] = useState('');
  return (
    <div className="modal-overlay" onClick={ev => ev.target === ev.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h2 className="modal-title">Reject Leave Request</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 13.5, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
            Rejecting <strong>{r.employee.firstName} {r.employee.lastName}</strong>'s {r.leaveType.name} request
            ({r.totalDays}d, {formatDate(r.startDate)} – {formatDate(r.endDate)}).
          </p>
          <div className="form-group">
            <label>Rejection Note (optional)</label>
            <textarea className="form-control" rows={3} placeholder="Reason for rejection…" value={note} onChange={e => setNote(e.target.value)} style={{ resize: 'vertical' }} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" disabled={loading} onClick={() => onReject(note)}>
            {loading ? 'Rejecting…' : 'Reject Request'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}
