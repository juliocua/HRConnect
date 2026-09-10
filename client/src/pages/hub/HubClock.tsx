import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { AttendanceRecord, AttendanceEditRequest } from '@/types';

const STATUS_COLORS: Record<string, string> = {
  PRESENT: 'badge-green', LATE: 'badge-yellow', ABSENT: 'badge-red',
  HALF_DAY: 'badge-yellow', ON_LEAVE: 'badge-blue',
  HOLIDAY: 'badge-blue', WEEKEND: 'badge-gray',
};

function formatTime(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function fmtDate(iso?: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const pad = (n: number) => String(n).padStart(2, '0');
  const hh = time.getHours() % 12 || 12;
  const mm = pad(time.getMinutes());
  const ss = pad(time.getSeconds());
  const ampm = time.getHours() < 12 ? 'AM' : 'PM';
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 56, fontWeight: 800, letterSpacing: '-2px', lineHeight: 1, color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
        {hh}:{mm}:{ss}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text-secondary)', marginTop: 4 }}>{ampm}</div>
      <div style={{ fontSize: 14, color: 'var(--color-text-muted)', marginTop: 8 }}>
        {time.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
      </div>
    </div>
  );
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function HubClock() {
  const qc = useQueryClient();
  const [showManual, setShowManual] = useState(false);
  const [showEditRequest, setShowEditRequest] = useState(false);
  const [editRequestTarget, setEditRequestTarget] = useState<AttendanceRecord | null>(null);
  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate, setEndDate] = useState(todayStr);

  // Today's attendance
  const { data: todayRecord, isLoading: todayLoading } = useQuery<AttendanceRecord | null>({
    queryKey: ['hub-today'],
    queryFn: () => api.get('/attendance/me/today').then(r => r.data),
    refetchInterval: 30_000,
  });

  // Filtered history
  const { data: history = [] } = useQuery<AttendanceRecord[]>({
    queryKey: ['hub-attendance', startDate, endDate],
    queryFn: () => api.get(`/attendance/me?startDate=${startDate}&endDate=${endDate}`).then(r => r.data),
    enabled: !!startDate && !!endDate,
  });

  const clockInMutation = useMutation({
    mutationFn: () => api.post('/attendance/clock-in'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hub-today'] }); qc.invalidateQueries({ queryKey: ['hub-attendance'] }); },
  });

  const clockOutMutation = useMutation({
    mutationFn: () => api.post('/attendance/clock-out'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hub-today'] }); qc.invalidateQueries({ queryKey: ['hub-attendance'] }); },
  });

  const hasClockedIn = !!todayRecord?.clockInAt;
  const hasClockedOut = !!todayRecord?.clockOutAt;
  const isClockedIn = hasClockedIn && !hasClockedOut;

  // Pending edit requests for per-row badge
  const { data: editRequests = [] } = useQuery<AttendanceEditRequest[]>({
    queryKey: ['hub-edit-requests'],
    queryFn: () => api.get('/attendance/edit-requests/me').then(r => r.data),
  });
  const pendingByDate = useMemo(() => {
    const s = new Set<string>();
    editRequests.filter(r => r.status === 'PENDING').forEach(r => s.add(r.attendanceDate.slice(0, 10)));
    return s;
  }, [editRequests]);

  // Quick stats for filtered range
  const presentDays = history.filter(r => r.status === 'PRESENT' || r.status === 'LATE').length;
  const absentDays = history.filter(r => r.status === 'ABSENT').length;
  const totalOT = history.reduce((s, r) => s + (r.overtimeHrs || 0), 0);

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Time & Attendance</h1>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, marginBottom: 24 }}>Record your daily time in and out</p>

      {/* Clock card */}
      <div className="card" style={{ textAlign: 'center', padding: '32px 24px', marginBottom: 24 }}>
        <LiveClock />

        <div style={{ marginTop: 28, display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          {!hasClockedIn && !todayLoading && (
            <button
              className="btn btn-primary"
              style={{ minWidth: 140, fontSize: 15, padding: '10px 24px' }}
              disabled={clockInMutation.isPending}
              onClick={() => clockInMutation.mutate()}
            >
              {clockInMutation.isPending ? 'Clocking in…' : '🟢 Clock In'}
            </button>
          )}
          {isClockedIn && (
            <button
              className="btn btn-danger"
              style={{ minWidth: 140, fontSize: 15, padding: '10px 24px' }}
              disabled={clockOutMutation.isPending}
              onClick={() => clockOutMutation.mutate()}
            >
              {clockOutMutation.isPending ? 'Clocking out…' : '🔴 Clock Out'}
            </button>
          )}
          {hasClockedOut && (
            <div style={{ padding: '10px 20px', borderRadius: 10, background: 'var(--color-surface-2)', fontWeight: 600, color: 'var(--color-text-muted)', fontSize: 14 }}>
              ✅ Done for today
            </div>
          )}
          <button
            className="btn btn-secondary"
            style={{ minWidth: 140, fontSize: 15, padding: '10px 24px' }}
            onClick={() => { setEditRequestTarget(null); setShowEditRequest(true); }}
          >
            ✏️ Request Entry
          </button>
        </div>

        {/* Error display */}
        {(clockInMutation.isError || clockOutMutation.isError) && (
          <div className="error-msg" style={{ marginTop: 12, maxWidth: 400, margin: '12px auto 0' }}>
            {(clockInMutation.error as any)?.response?.data?.error ?? (clockOutMutation.error as any)?.response?.data?.error ?? 'An error occurred'}
          </div>
        )}

        {/* Today's summary */}
        {todayRecord && (
          <div style={{ display: 'flex', gap: 20, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
            {[
              { label: 'Status', value: <span className={`badge ${STATUS_COLORS[todayRecord.status]}`}>{todayRecord.status.replace('_', ' ')}</span> },
              { label: 'Clock In', value: formatTime(todayRecord.clockInAt) },
              { label: 'Clock Out', value: formatTime(todayRecord.clockOutAt) },
              ...(todayRecord.overtimeHrs > 0 ? [{ label: 'OT Hours', value: `${todayRecord.overtimeHrs}h` }] : []),
            ].map(item => (
              <div key={item.label} style={{ textAlign: 'center', minWidth: 80 }}>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{item.label}</div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{item.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Attendance History */}
      <div className="card">
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div className="card-title">Attendance History</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>From:</label>
            <input
              type="date"
              className="form-control"
              style={{ width: 150, fontSize: 13 }}
              value={startDate}
              max={endDate}
              onChange={e => setStartDate(e.target.value)}
            />
            <label style={{ fontSize: 13, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>To:</label>
            <input
              type="date"
              className="form-control"
              style={{ width: 150, fontSize: 13 }}
              value={endDate}
              min={startDate}
              max={todayStr()}
              onChange={e => setEndDate(e.target.value)}
            />
          </div>
        </div>

        {/* Mini stats for date range */}
        {history.length > 0 && (
          <div style={{ display: 'flex', gap: 16, padding: '8px 0 16px', flexWrap: 'wrap' }}>
            {[
              { label: 'Days Present', value: presentDays },
              { label: 'Days Absent', value: absentDays },
              { label: 'OT Hours', value: `${totalOT.toFixed(1)}h` },
            ].map(s => (
              <div key={s.label} style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                <strong style={{ color: 'var(--color-text-primary)' }}>{s.value}</strong> {s.label}
              </div>
            ))}
          </div>
        )}

        {history.length === 0 ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 14 }}>No records for this period</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Clock In</th>
                  <th>Clock Out</th>
                  <th>OT</th>
                  <th>Entry</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {history.map(r => (
                  <tr key={r.id}>
                    <td className="text-sm">{fmtDate(r.date)}</td>
                    <td><span className={`badge ${STATUS_COLORS[r.status] ?? 'badge-gray'}`}>{r.status.replace('_', ' ')}</span></td>
                    <td className="td-mono text-sm">{formatTime(r.clockInAt)}</td>
                    <td className="td-mono text-sm">{formatTime(r.clockOutAt)}</td>
                    <td className="text-sm">{r.overtimeHrs > 0 ? <span style={{ color: 'var(--color-warning)', fontWeight: 600 }}>{r.overtimeHrs}h</span> : '—'}</td>
                    <td>
                      {r.isManualEntry
                        ? <span className="badge badge-yellow" title={r.manualReason}>Manual</span>
                        : <span className="badge badge-gray" style={{ opacity: 0.6 }}>Auto</span>
                      }
                    </td>
                    <td>
                      {r.status !== 'WEEKEND' && r.status !== 'HOLIDAY' && (
                        pendingByDate.has(r.date.slice(0, 10))
                          ? <span className="badge badge-yellow" title="Edit request pending HR review">Pending</span>
                          : <button
                              className="btn btn-ghost btn-sm"
                              style={{ fontSize: 12, padding: '3px 10px', whiteSpace: 'nowrap' }}
                              onClick={() => { setEditRequestTarget(r); setShowEditRequest(true); }}
                            >Request Edit</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showEditRequest && <AttendanceEditRequestModal record={editRequestTarget} onClose={() => setShowEditRequest(false)} onSaved={() => { setShowEditRequest(false); qc.invalidateQueries({ queryKey: ['hub-attendance'] }); qc.invalidateQueries({ queryKey: ['hub-today'] }); qc.invalidateQueries({ queryKey: ['hub-edit-requests'] }); }} />}
    </div>
  );
}

function AttendanceEditRequestModal({ record, onClose, onSaved }: { record: AttendanceRecord | null; onClose: () => void; onSaved: () => void }) {
  const toTime = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const [form, setForm] = useState({
    date: record?.date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    timeIn: toTime(record?.clockInAt) || '08:00',
    timeOut: toTime(record?.clockOutAt) || '17:00',
    status: record?.status ?? 'PRESENT',
    reason: '',
  });
  const [attachment, setAttachment] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.reason.trim().length < 10) {
      setError('Reason must be at least 10 characters.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('attendanceDate', form.date);
      if (form.status !== 'ABSENT') {
        if (form.timeIn) fd.append('requestedTimeIn', form.timeIn);
        if (form.timeOut) fd.append('requestedTimeOut', form.timeOut);
      }
      fd.append('requestedStatus', form.status);
      fd.append('reason', form.reason);
      if (attachment) fd.append('attachment', attachment);
      await api.post('/attendance/edit-request', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onSaved();
    } catch (err: unknown) {
      setError((err as any)?.response?.data?.error ?? 'Failed to submit');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">{record ? 'Request Attendance Edit' : 'Request Attendance Entry'}</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div style={{ background: 'var(--color-warning-light, #FFFBEB)', border: '1px solid var(--color-warning, #D97706)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#92400E' }}>
              ⚠️ {record ? 'Edit requests are reviewed by HR before taking effect.' : 'Attendance requests require HR approval before being recorded.'}
            </div>
            {error && <div className="error-msg">{error}</div>}
            <div className="form-grid form-grid-2">
              <div className="form-group">
                <label>Date *</label>
                <input type="date" className="form-control" required value={form.date} onChange={e => set('date', e.target.value)} max={new Date().toISOString().slice(0, 10)} readOnly={!!record} />
              </div>
              <div className="form-group">
                <label>Status</label>
                <select className="form-control" value={form.status} onChange={e => set('status', e.target.value)}>
                  <option value="PRESENT">Present</option>
                  <option value="LATE">Late</option>
                  <option value="HALF_DAY">Half Day</option>
                  <option value="ABSENT">Absent</option>
                </select>
              </div>
            </div>
            {form.status !== 'ABSENT' && (
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
              <label>Reason *</label>
              <textarea
                className="form-control"
                rows={3}
                required
                minLength={10}
                placeholder="e.g., Forgot to clock in, was working from client site…"
                value={form.reason}
                onChange={e => set('reason', e.target.value)}
                style={{ resize: 'vertical' }}
              />
              <div style={{ fontSize: 11, color: form.reason.length < 10 ? 'var(--color-danger)' : 'var(--color-text-muted)', marginTop: 2 }}>
                {form.reason.length}/10 minimum characters
              </div>
            </div>
            <div className="form-group">
              <label>Attachment <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(optional)</span></label>
              <input type="file" className="form-control" accept="image/*,application/pdf" onChange={e => setAttachment(e.target.files?.[0] ?? null)} />
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>Images or PDF, max 10 MB</div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
