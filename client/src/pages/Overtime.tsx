import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import api from '@/lib/api';
import { DataTable } from '@/components/DataTable';
import type { Employee } from '@/types';

type OTStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

interface OvertimeRequest {
  id: string;
  employeeId: string;
  employee: Pick<Employee, 'id' | 'firstName' | 'lastName' | 'position' | 'avatarColor'>;
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
  PENDING: 'badge-yellow', APPROVED: 'badge-green', REJECTED: 'badge-red',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function Overtime() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [empFilter, setEmpFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [rejModal, setRejModal] = useState<OvertimeRequest | null>(null);

  const { data: requests = [], isLoading } = useQuery<OvertimeRequest[]>({
    queryKey: ['overtime', statusFilter, empFilter],
    queryFn: () => {
      const p = new URLSearchParams();
      if (statusFilter) p.set('status', statusFilter);
      if (empFilter) p.set('employeeId', empFilter);
      return api.get(`/overtime?${p}`).then(r => r.data);
    },
  });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ['employees'],
    queryFn: () => api.get('/employees?status=ACTIVE').then(r => r.data),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.put(`/overtime/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['overtime'] }),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      api.put(`/overtime/${id}/reject`, { note }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['overtime'] }); setRejModal(null); },
  });

  const pending = requests.filter(r => r.status === 'PENDING').length;

  const columns = useMemo<ColumnDef<OvertimeRequest>[]>(() => [
    {
      id: 'employee',
      accessorFn: row => `${row.employee?.lastName} ${row.employee?.firstName}`,
      header: 'Employee',
      cell: ({ row: { original: r } }) => (
        <div className="emp-info">
          <div className="emp-avatar" style={{ background: r.employee?.avatarColor }}>
            {r.employee?.firstName[0]}{r.employee?.lastName[0]}
          </div>
          <div>
            <div className="emp-name">{r.employee?.firstName} {r.employee?.lastName}</div>
            <div className="emp-role">{r.employee?.position}</div>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'date',
      header: 'Date',
      cell: ({ getValue }) => fmtDate(getValue() as string),
    },
    {
      accessorKey: 'hours',
      header: 'OT Hours',
      cell: ({ getValue }) => <strong>{getValue() as number} hrs</strong>,
    },
    {
      accessorKey: 'reason',
      header: 'Reason',
      cell: ({ getValue }) => (
        <span className="text-muted text-sm" style={{ maxWidth: 200, display: 'block' }}>
          {(getValue() as string) ?? '—'}
        </span>
      ),
    },
    {
      accessorKey: 'filedAt',
      header: 'Filed',
      cell: ({ getValue }) => <span className="text-muted text-sm">{fmtDate(getValue() as string)}</span>,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row: { original: r } }) => (
        <div>
          <span className={`badge ${STATUS_COLORS[r.status]}`}>{r.status}</span>
          {r.rejectionNote && (
            <div className="text-sm text-muted" style={{ marginTop: 3 }} title={r.rejectionNote}>⚠️ Note</div>
          )}
        </div>
      ),
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row: { original: r } }) =>
        r.status === 'PENDING' ? (
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
        ) : null,
    },
  ], [approveMutation]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Overtime Requests</h1>
          <p className="page-desc">{pending} pending approval</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          ＋ File OT Request
        </button>
      </div>

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
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : requests.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">⏱️</div>
          <div className="empty-state-title">No overtime requests</div>
          <div>{statusFilter === 'PENDING' ? 'All caught up!' : 'No requests match this filter'}</div>
        </div>
      ) : (
        <div className="card">
          <DataTable
            data={requests}
            columns={columns}
            globalFilterPlaceholder="Search employees…"
            exportFilename="OvertimeRequests"
          />
        </div>
      )}

      {showModal && (
        <OTModal
          employees={employees}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); qc.invalidateQueries({ queryKey: ['overtime'] }); }}
        />
      )}

      {rejModal && (
        <RejectModal
          request={rejModal}
          onClose={() => setRejModal(null)}
          onReject={note => rejectMutation.mutate({ id: rejModal.id, note })}
          loading={rejectMutation.isPending}
        />
      )}
    </div>
  );
}

function OTModal({ employees, onClose, onSaved }: {
  employees: Employee[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({ employeeId: '', date: '', hours: '1', reason: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/overtime', { ...form, hours: Number(form.hours) });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Failed to file overtime request');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2 className="modal-title">File Overtime Request</h2>
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
            <div className="form-grid form-grid-2">
              <div className="form-group">
                <label>Date *</label>
                <input type="date" className="form-control" required value={form.date} onChange={e => set('date', e.target.value)} />
              </div>
              <div className="form-group">
                <label>OT Hours *</label>
                <input type="number" className="form-control" required min="0.5" max="24" step="0.5" value={form.hours} onChange={e => set('hours', e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label>Reason</label>
              <textarea className="form-control" rows={3} placeholder="Optional reason for overtime…" value={form.reason} onChange={e => set('reason', e.target.value)} style={{ resize: 'vertical' }} />
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

function RejectModal({ request: r, onClose, onReject, loading }: {
  request: OvertimeRequest;
  onClose: () => void;
  onReject: (note: string) => void;
  loading: boolean;
}) {
  const [note, setNote] = useState('');
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h2 className="modal-title">Reject OT Request</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 13.5, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
            Rejecting <strong>{r.employee?.firstName} {r.employee?.lastName}</strong>'s {r.hours}hr OT on {fmtDate(r.date)}.
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
