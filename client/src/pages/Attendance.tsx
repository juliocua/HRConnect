import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import api from '@/lib/api';
import { DataTable } from '@/components/DataTable';
import type { AttendanceRecord, AttendanceStatus, AttendanceEditRequest, Employee, Client } from '@/types';
import { EmployeeCombobox } from '@/components/EmployeeCombobox';
import { ClientCombobox } from '@/components/ClientCombobox';

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

function firstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function toDateInput(t: string | null | undefined, fallback: string): string {
  if (!t) return fallback;
  if (t.includes('T')) return t.slice(0, 10);
  return t.slice(0, 10);
}

function toTimeInput(t: string | null | undefined, fallback: string): string {
  if (!t) return fallback;
  if (t.includes('T') || t.length > 8) {
    const d = new Date(t);
    if (!isNaN(d.getTime())) {
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
  }
  return t.slice(0, 5);
}

export default function Attendance() {
  const qc = useQueryClient();
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);
  const [empFilter, setEmpFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<AttendanceRecord | null>(null);

  const { data: records = [], isLoading } = useQuery<AttendanceRecord[]>({
    queryKey: ['attendance', startDate, endDate, empFilter, clientFilter],
    queryFn: () => {
      const p = new URLSearchParams();
      if (startDate) p.set('startDate', startDate);
      if (endDate) p.set('endDate', endDate);
      if (empFilter) p.set('employeeId', empFilter);
      if (clientFilter) p.set('clientId', clientFilter);
      return api.get(`/attendance?${p}`).then(r => r.data);
    },
  });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ['employees'],
    queryFn: () => api.get('/employees?status=ACTIVE').then(r => r.data),
  });

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then(r => r.data),
  });

  const present = records.filter(r => r.status === 'PRESENT' || r.status === 'LATE').length;
  const absent = records.filter(r => r.status === 'ABSENT').length;
  const onLeave = records.filter(r => r.status === 'ON_LEAVE').length;
  const overtime = records.reduce((s, r) => s + (r.overtimeHrs || 0), 0);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/attendance/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attendance'] }),
  });

  const handlePrint = () => window.print();

  const columns = useMemo<ColumnDef<AttendanceRecord>[]>(() => [
    {
      id: 'employee',
      accessorFn: row => `${row.employee.lastName} ${row.employee.firstName}`,
      header: 'Employee',
      cell: ({ row: { original: r } }) => (
        <div className="emp-info">
          <div className="emp-avatar" style={{ background: r.employee.avatarColor }}>
            {r.employee.firstName[0]}{r.employee.lastName[0]}
          </div>
          <div>
            <div className="emp-name">{r.employee.firstName} {r.employee.lastName}</div>
            <div className="emp-role">{r.employee.position}</div>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ getValue }) => {
        const s = getValue() as AttendanceStatus;
        return <span className={`badge ${STATUS_COLORS[s]}`}>{STATUS_LABELS[s]}</span>;
      },
    },
    {
      accessorKey: 'timeIn',
      header: 'Time In',
      cell: ({ getValue }) => <span className="td-mono">{getValue() ? formatTime(getValue() as string) : '—'}</span>,
    },
    {
      accessorKey: 'timeOut',
      header: 'Time Out',
      cell: ({ getValue }) => <span className="td-mono">{getValue() ? formatTime(getValue() as string) : '—'}</span>,
    },
    {
      accessorKey: 'overtimeHrs',
      header: 'OT Hours',
      cell: ({ getValue }) => {
        const v = getValue() as number;
        return v > 0 ? <span style={{ color: 'var(--color-warning)', fontWeight: 600 }}>{v}h</span> : <span>—</span>;
      },
    },
    {
      accessorKey: 'notes',
      header: 'Notes',
      cell: ({ getValue }) => <span className="text-muted text-sm">{(getValue() as string) ?? '—'}</span>,
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row: { original: r } }) => (
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => { setEditTarget(r); setShowModal(true); }}>Edit</button>
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-danger)' }} onClick={() => {
            if (confirm('Delete this record?')) deleteMutation.mutate(r.id);
          }}>Del</button>
        </div>
      ),
    },
  ], [deleteMutation]);

  const isRangeFilter = startDate !== endDate;
  const exportFilename = isRangeFilter ? `Attendance_${startDate}_to_${endDate}` : `Attendance_${startDate}`;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Attendance</h1>
          <p className="page-desc">Track daily time & attendance records</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={handlePrint}>🖨️ Print / PDF</button>
          <a href="/import?type=time" className="btn btn-ghost">⬆ Import CSV</a>
          <button className="btn btn-primary" onClick={() => { setEditTarget(null); setShowModal(true); }}>
            ＋ Log Attendance
          </button>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid-4" style={{ marginBottom: 20 }}>
        {[
          { label: 'Present', value: present, icon: '✅' },
          { label: 'Absent', value: absent, icon: '❌' },
          { label: 'On Leave', value: onLeave, icon: '🏖️' },
          { label: 'OT Hours', value: `${overtime.toFixed(1)}h`, icon: '⏱️' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20, lineHeight: 1 }}>{s.icon}</span>
            <span style={{ fontSize: 20, fontWeight: 800, lineHeight: 1 }}>{s.value}</span>
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="filter-bar" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={{ whiteSpace: 'nowrap', fontSize: 13 }}>From:</label>
            <input type="date" className="form-control" value={startDate} max={endDate} onChange={e => setStartDate(e.target.value)} style={{ width: 155 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={{ whiteSpace: 'nowrap', fontSize: 13 }}>To:</label>
            <input type="date" className="form-control" value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} style={{ width: 155 }} />
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => { setStartDate(todayStr()); setEndDate(todayStr()); }}>Today</button>
          <button className="btn btn-secondary btn-sm" onClick={() => { setStartDate(firstOfMonth()); setEndDate(todayStr()); }}>This Month</button>
          <ClientCombobox
            clients={clients}
            value={clientFilter}
            onChange={setClientFilter}
            placeholder="All Clients"
            style={{ width: 200 }}
          />
          <EmployeeCombobox
            employees={employees}
            value={empFilter}
            onChange={setEmpFilter}
            placeholder="All Employees"
            style={{ width: 200 }}
          />
        </div>
      </div>

      <AttendanceEditRequestsPanel />

      {isLoading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : records.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <div className="empty-state-title">No records found</div>
          <div>Try adjusting the date range or filters</div>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => { setEditTarget(null); setShowModal(true); }}>
            ＋ Log Attendance
          </button>
        </div>
      ) : (
        <div className="card">
          <DataTable
            data={records}
            columns={columns}
            globalFilterPlaceholder="Search employees…"
            exportFilename={exportFilename}
          />
        </div>
      )}

      {showModal && (
        <AttendanceModal
          employees={employees}
          defaultDate={startDate}
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
              {isEdit
                ? <input className="form-control" disabled value={employees.find(e => e.id === form.employeeId) ? `${employees.find(e => e.id === form.employeeId)!.firstName} ${employees.find(e => e.id === form.employeeId)!.lastName}` : form.employeeId} />
                : <EmployeeCombobox
                    employees={employees}
                    value={form.employeeId}
                    onChange={v => set('employeeId', v)}
                    placeholder="Select employee…"
                    required
                  />
              }
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
  if (t.includes('T') || t.length > 8) {
    const d = new Date(t);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true });
    }
  }
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  return `${hour % 12 || 12}:${m} ${hour < 12 ? 'AM' : 'PM'}`;
}

function resolveAttachmentUrl(url: string) {
  if (!url) return url;
  if (url.startsWith('http')) {
    try {
      const u = new URL(url);
      const base = ((import.meta.env.VITE_API_URL as string) ?? '').replace(/\/$/, '');
      return `${base}${u.pathname}`;
    } catch { return url; }
  }
  const base = ((import.meta.env.VITE_API_URL as string) ?? '').replace(/\/$/, '');
  return `${base}${url}`;
}

function AttendanceEditRequestsPanel() {
  const qc = useQueryClient();
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const { data: requests = [], isLoading } = useQuery<AttendanceEditRequest[]>({
    queryKey: ['attendance-edit-requests'],
    queryFn: () => api.get('/attendance/edit-requests').then(r => r.data),
    refetchInterval: 60_000,
  });

  const pending = requests.filter(r => r.status === 'PENDING');

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.put(`/attendance/edit-requests/${id}/approve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance-edit-requests'] });
      qc.invalidateQueries({ queryKey: ['attendance'] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      api.put(`/attendance/edit-requests/${id}/reject`, { rejectionNote: note }),
    onSuccess: () => {
      setRejectId(null);
      setRejectNote('');
      qc.invalidateQueries({ queryKey: ['attendance-edit-requests'] });
    },
  });

  if (!isLoading && pending.length === 0) return null;

  return (
    <div className="card" style={{ marginBottom: 20, borderColor: '#FCD34D' }}>
      <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="card-title">Attendance Edit Requests</div>
        {pending.length > 0 && <span className="badge badge-yellow">{pending.length} pending</span>}
      </div>
      {isLoading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Date</th>
                <th>Requested Changes</th>
                <th>Reason</th>
                <th>Attachment</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pending.map(req => (
                <tr key={req.id}>
                  <td>
                    <div className="emp-info">
                      <div className="emp-avatar" style={{ background: req.employee.avatarColor }}>
                        {req.employee.firstName[0]}{req.employee.lastName[0]}
                      </div>
                      <div>
                        <div className="emp-name">{req.employee.firstName} {req.employee.lastName}</div>
                        <div className="emp-role">{req.employee.position}</div>
                      </div>
                    </div>
                  </td>
                  <td className="text-sm">
                    {new Date(req.attendanceDate).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </td>
                  <td className="text-sm" style={{ minWidth: 140 }}>
                    {req.requestedStatus && <div><strong>Status:</strong> {req.requestedStatus.replace('_', ' ')}</div>}
                    {req.requestedTimeIn && <div><strong>In:</strong> {formatTime(req.requestedTimeIn)}</div>}
                    {req.requestedTimeOut && <div><strong>Out:</strong> {formatTime(req.requestedTimeOut)}</div>}
                  </td>
                  <td className="text-sm text-muted" style={{ maxWidth: 200 }}>{req.reason}</td>
                  <td>
                    {req.attachmentUrl
                      ? <a href={resolveAttachmentUrl(req.attachmentUrl)} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">View</a>
                      : <span className="text-muted text-sm">—</span>
                    }
                  </td>
                  <td>
                    {rejectId === req.id ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 200 }}>
                        <input
                          className="form-control"
                          placeholder="Rejection note…"
                          value={rejectNote}
                          onChange={e => setRejectNote(e.target.value)}
                          style={{ fontSize: 12 }}
                        />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="btn btn-danger btn-sm"
                            disabled={rejectMutation.isPending}
                            onClick={() => rejectMutation.mutate({ id: req.id, note: rejectNote })}
                          >
                            {rejectMutation.isPending ? '…' : 'Confirm'}
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => { setRejectId(null); setRejectNote(''); }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={approveMutation.isPending}
                          onClick={() => approveMutation.mutate(req.id)}
                        >
                          {approveMutation.isPending ? '…' : 'Approve'}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--color-danger)' }}
                          onClick={() => setRejectId(req.id)}
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
    </div>
  );
}
