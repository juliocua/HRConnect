import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { AttendanceRecord, AttendanceStatus, Employee } from '@/types';

const STATUS_COLORS: Record<AttendanceStatus, string> = {
  PRESENT: 'badge-green', LATE: 'badge-yellow', ABSENT: 'badge-red',
  HALF_DAY: 'badge-yellow', ON_LEAVE: 'badge-blue',
  HOLIDAY: 'badge-blue', WEEKEND: 'badge-gray',
};

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: 'Present', LATE: 'Late', ABSENT: 'Absent',
  HALF_DAY: 'Half Day', ON_LEAVE: 'On Leave',
  HOLIDAY: 'Holiday', WEEKEND: 'Weekend',
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Convert ISO DateTime or YYYY-MM-DD string to YYYY-MM-DD for <input type="date">
function toDateInput(t: string | null | undefined, fallback: string): string {
  if (!t) return fallback;
  if (t.includes('T')) return t.slice(0, 10);
  return t.slice(0, 10);
}

// Convert ISO DateTime or HH:MM string to HH:MM for <input type="time">
function toTimeInput(t: string | null | undefined, fallback: string): string {
  if (!t) return fallback;
  if (t.includes('T') || t.length > 8) {
    const d = new Date(t);
    if (!isNaN(d.getTime())) {
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
  }
  return t.slice(0, 5); // ensure HH:MM
}

export default function Attendance() {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayStr());
  const [empFilter, setEmpFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<AttendanceRecord | null>(null);

  const { data: records = [], isLoading } = useQuery<AttendanceRecord[]>({
    queryKey: ['attendance', date, empFilter],
    queryFn: () => {
      const p = new URLSearchParams({ date });
      if (empFilter) p.set('employeeId', empFilter);
      return api.get(`/attendance?${p}`).then(r => r.data);
    },
  });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ['employees'],
    queryFn: () => api.get('/employees?status=ACTIVE').then(r => r.data),
  });

  const present = records.filter(r => r.status === 'PRESENT' || r.status === 'LATE').length;
  const absent = records.filter(r => r.status === 'ABSENT').length;
  const onLeave = records.filter(r => r.status === 'ON_LEAVE').length;
  const overtime = records.reduce((s, r) => s + (r.overtimeHrs || 0), 0);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/attendance/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attendance'] }),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Attendance</h1>
          <p className="page-desc">Track daily time & attendance records</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/import?type=time" className="btn btn-ghost">⬆ Import CSV</a>
          <button className="btn btn-primary" onClick={() => { setEditTarget(null); setShowModal(true); }}>
            ＋ Log Attendance
          </button>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid-4" style={{ marginBottom: 20 }}>
        {[
          { label: 'Present', value: present, icon: '✅', cls: 'badge-green' },
          { label: 'Absent', value: absent, icon: '❌', cls: 'badge-red' },
          { label: 'On Leave', value: onLeave, icon: '🏖️', cls: 'badge-blue' },
          { label: 'OT Hours', value: `${overtime.toFixed(1)}h`, icon: '⏱️', cls: 'badge-yellow' },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ padding: 16 }}>
            <div className="stat-icon" style={{ width: 38, height: 38, fontSize: 18, background: 'var(--color-surface-2)' }}>{s.icon}</div>
            <div>
              <div className="stat-label">{s.label}</div>
              <div className="stat-value" style={{ fontSize: 20 }}>{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="filter-bar">
          <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <label style={{ whiteSpace: 'nowrap' }}>Date:</label>
            <input type="date" className="form-control" value={date} onChange={e => setDate(e.target.value)} style={{ width: 160 }} />
          </div>
          <select className="form-control" style={{ width: 220 }} value={empFilter} onChange={e => setEmpFilter(e.target.value)}>
            <option value="">All Employees</option>
            {employees.map(e => (
              <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>
            ))}
          </select>
          <button className="btn btn-secondary btn-sm" onClick={() => setDate(todayStr())}>Today</button>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : records.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <div className="empty-state-title">No records found</div>
          <div>Log attendance for {formatDate(date)}</div>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => { setEditTarget(null); setShowModal(true); }}>
            ＋ Log Attendance
          </button>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Status</th>
                <th>Time In</th>
                <th>Time Out</th>
                <th>OT Hours</th>
                <th>Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map(r => (
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
                  <td><span className={`badge ${STATUS_COLORS[r.status]}`}>{STATUS_LABELS[r.status]}</span></td>
                  <td className="td-mono">{r.timeIn ? formatTime(r.timeIn) : '—'}</td>
                  <td className="td-mono">{r.timeOut ? formatTime(r.timeOut) : '—'}</td>
                  <td>{r.overtimeHrs > 0 ? <span style={{ color: 'var(--color-warning)', fontWeight: 600 }}>{r.overtimeHrs}h</span> : '—'}</td>
                  <td className="text-muted text-sm">{r.notes ?? '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => { setEditTarget(r); setShowModal(true); }}>Edit</button>
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-danger)' }} onClick={() => {
                        if (confirm('Delete this record?')) deleteMutation.mutate(r.id);
                      }}>Del</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <AttendanceModal
          employees={employees}
          defaultDate={date}
          initial={editTarget}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); qc.invalidateQueries({ queryKey: ['attendance'] }); }}
        />
      )}
    </div>
  );
}

function AttendanceModal({ employees, defaultDate, initial, onClose, onSaved }: {
  employees: Employee[];
  defaultDate: string;
  initial: AttendanceRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!initial;
  const [form, setForm] = useState({
    employeeId: initial?.employeeId ?? '',
    date: toDateInput(initial?.date, defaultDate),
    status: initial?.status ?? 'PRESENT' as AttendanceStatus,
    timeIn: toTimeInput(initial?.timeIn, '08:00'),
    timeOut: toTimeInput(initial?.timeOut, '17:00'),
    overtimeHrs: initial?.overtimeHrs ?? 0,
    notes: initial?.notes ?? '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (isEdit) {
        await api.put(`/attendance/${initial!.id}`, form);
      } else {
        await api.post('/attendance', form);
      }
      onSaved();
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setError((err as any)?.response?.data?.error ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const showTime = form.status === 'PRESENT' || form.status === 'LATE' || form.status === 'HALF_DAY';

  return (
    <div className="modal-overlay" onClick={ev => ev.target === ev.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Edit Attendance' : 'Log Attendance'}</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="error-msg">{error}</div>}
            <div className="form-group">
              <label>Employee *</label>
              <select className="form-control" required value={form.employeeId} onChange={e => set('employeeId', e.target.value)} disabled={isEdit}>
                <option value="">Select employee…</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
              </select>
            </div>
            <div className="form-grid form-grid-2">
              <div className="form-group">
                <label>Date *</label>
                <input type="date" className="form-control" required value={form.date} onChange={e => set('date', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Status *</label>
                <select className="form-control" value={form.status} onChange={e => set('status', e.target.value)}>
                  {(Object.keys(STATUS_LABELS) as AttendanceStatus[]).map(s => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>
            </div>
            {showTime && (
              <div className="form-grid form-grid-2">
                <div className="form-group">
                  <label>Time In</label>
                  <input type="time" className="form-control" value={form.timeIn} onChange={e => set('timeIn', e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Time Out</label>
                  <input type="time" className="form-control" value={form.timeOut} onChange={e => set('timeOut', e.target.value)} />
                </div>
              </div>
            )}
            <div className="form-group">
              <label>Overtime Hours</label>
              <input type="number" className="form-control" min={0} max={12} step={0.5} value={form.overtimeHrs} onChange={e => set('overtimeHrs', parseFloat(e.target.value) || 0)} />
            </div>
            <div className="form-group">
              <label>Notes</label>
              <input className="form-control" placeholder="Optional notes…" value={form.notes} onChange={e => set('notes', e.target.value)} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Log Attendance'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function formatTime(t: string) {
  if (!t) return '—';
  // Handle ISO DateTime strings (e.g. "2026-09-01T08:00:00.000Z")
  if (t.includes('T') || t.length > 8) {
    const d = new Date(t);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true });
    }
  }
  // Plain HH:MM
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  return `${hour % 12 || 12}:${m} ${hour < 12 ? 'AM' : 'PM'}`;
}
