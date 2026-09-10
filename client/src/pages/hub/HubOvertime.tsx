import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { OTStatus, AttendanceRecord } from '@/types';

interface MyOTRequest {
  id: string;
  date: string;
  hours: number;
  reason?: string;
  status: OTStatus;
  approvedAt?: string;
  rejectedAt?: string;
  rejectionNote?: string;
  filedAt: string;
}

const STATUS_COLORS: Record<OTStatus, string> = {
  PENDING: 'badge-yellow',
  APPROVED: 'badge-green',
  REJECTED: 'badge-red',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export default function HubOvertime() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);

  const { data: requests = [], isLoading } = useQuery<MyOTRequest[]>({
    queryKey: ['overtime-me'],
    queryFn: () => api.get('/overtime/me').then(r => r.data),
  });

  const pending = useMemo(() => requests.filter(r => r.status === 'PENDING').length, [requests]);
  const approved = useMemo(() => requests.filter(r => r.status === 'APPROVED').length, [requests]);
  const totalHrs = useMemo(
    () => requests.filter(r => r.status === 'APPROVED').reduce((s, r) => s + r.hours, 0),
    [requests]
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Overtime</h1>
          <p className="page-desc">Track and file your overtime requests</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          ＋ File OT Request
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <div className="card" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Pending</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--color-warning)' }}>{pending}</div>
        </div>
        <div className="card" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Approved</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--color-success)' }}>{approved}</div>
        </div>
        <div className="card" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Total OT Hours</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{totalHrs.toFixed(1)}</div>
        </div>
      </div>

      {isLoading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : requests.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">⏱️</div>
          <div className="empty-state-title">No overtime requests</div>
          <div>File your first OT request using the button above.</div>
        </div>
      ) : (
        <div className="card">
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>OT Hours</th>
                <th>Reason</th>
                <th>Filed</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {requests.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{fmtDate(r.date)}</td>
                  <td><strong>{r.hours} hrs</strong></td>
                  <td>
                    <span className="text-muted text-sm" style={{ maxWidth: 220, display: 'block' }}>
                      {r.reason ?? '—'}
                    </span>
                  </td>
                  <td className="text-muted text-sm">{fmtDate(r.filedAt)}</td>
                  <td>
                    <span className={`badge ${STATUS_COLORS[r.status]}`}>{r.status}</span>
                    {r.rejectionNote && (
                      <div
                        className="text-sm text-muted"
                        style={{ marginTop: 3 }}
                        title={r.rejectionNote}
                      >
                        ⚠️ {r.rejectionNote}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <FileOTModal
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false);
            qc.invalidateQueries({ queryKey: ['overtime-me'] });
          }}
        />
      )}
    </div>
  );
}

function FileOTModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ date: '', hours: '1', reason: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // Auto-calculate OT hours from clock records when date is selected
  const { data: dayRecords = [] } = useQuery<AttendanceRecord[]>({
    queryKey: ['hub-ot-day', form.date],
    queryFn: () => api.get(`/attendance/me?startDate=${form.date}&endDate=${form.date}`).then(r => r.data),
    enabled: !!form.date,
  });
  const dayRecord = dayRecords.find(r => r.date.slice(0, 10) === form.date) ?? null;

  useEffect(() => {
    if (!dayRecord?.clockInAt || !dayRecord?.clockOutAt) return;
    const workedHrs = (new Date(dayRecord.clockOutAt).getTime() - new Date(dayRecord.clockInAt).getTime()) / 3600000;
    const ot = Math.max(0, Math.round((workedHrs - 8) * 2) / 2);
    if (ot > 0) set('hours', String(ot));
  }, [dayRecord]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/overtime/me', { ...form, hours: Number(form.hours) });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Failed to file overtime request');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <h2 className="modal-title">File Overtime Request</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="error-msg">{error}</div>}
            <div className="form-grid form-grid-2">
              <div className="form-group">
                <label>Date *</label>
                <input
                  type="date"
                  className="form-control"
                  required
                  value={form.date}
                  onChange={e => set('date', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>OT Hours *</label>
                <input
                  type="number"
                  className="form-control"
                  required
                  min="0.5"
                  max="24"
                  step="0.5"
                  value={form.hours}
                  onChange={e => set('hours', e.target.value)}
                />
                {dayRecord?.clockInAt && dayRecord?.clockOutAt && (
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    ✨ Auto-calculated from clock records ({formatTime(dayRecord.clockInAt)} – {formatTime(dayRecord.clockOutAt)})
                  </div>
                )}
              </div>
            </div>
            <div className="form-group">
              <label>Reason</label>
              <textarea
                className="form-control"
                rows={3}
                placeholder="Optional reason for overtime…"
                value={form.reason}
                onChange={e => set('reason', e.target.value)}
                style={{ resize: 'vertical' }}
              />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Filing…' : 'File OT Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
