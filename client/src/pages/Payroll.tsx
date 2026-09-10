import { useState, useMemo, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatPHP } from '@/lib/payroll';
import { DataTable } from '@/components/DataTable';
import type { PayrollRun, PayrollRecord, PayrollStatus, AuditLog } from '@/types';

const STATUS_COLORS: Record<PayrollStatus, string> = {
  DRAFT: 'badge-yellow', POSTED: 'badge-blue', PAID: 'badge-green',
};

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

export default function Payroll() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const now = new Date();
  const [showRunModal, setShowRunModal] = useState(false);
  const [viewRunId, setViewRunId] = useState<string | null>(null);
  const [showSlip, setShowSlip] = useState<PayrollRecord | null>(null);
  const [downloadingDisb, setDownloadingDisb] = useState(false);

  const isManager = user?.role === 'HR_MANAGER' || user?.role === 'SUPER_ADMIN';

  const { data: history = [], isLoading } = useQuery<(PayrollRun & { _count: { records: number } })[]>({
    queryKey: ['payroll-history'],
    queryFn: () => api.get('/payroll/history').then(r => r.data),
  });

  const { data: currentRun } = useQuery<PayrollRun | null>({
    queryKey: ['payroll-run', viewRunId],
    queryFn: () => viewRunId ? api.get(`/payroll/${viewRunId}`).then(r => r.data) : null,
    enabled: !!viewRunId,
  });

  const { data: auditLogs = [] } = useQuery<AuditLog[]>({
    queryKey: ['payroll-audit', viewRunId],
    queryFn: () => api.get(`/payroll/audit?entityId=${viewRunId}`).then(r => r.data),
    enabled: !!viewRunId && isManager,
  });

  const postMutation = useMutation({
    mutationFn: (runId: string) => api.put(`/payroll/${runId}/post`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-history'] });
      qc.invalidateQueries({ queryKey: ['payroll-run', viewRunId] });
      qc.invalidateQueries({ queryKey: ['payroll-audit', viewRunId] });
    },
  });

  const paidMutation = useMutation({
    mutationFn: (runId: string) => api.put(`/payroll/${runId}/paid`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-history'] });
      qc.invalidateQueries({ queryKey: ['payroll-run', viewRunId] });
      qc.invalidateQueries({ queryKey: ['payroll-audit', viewRunId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (runId: string) => api.delete(`/payroll/run/${runId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-history'] });
      setViewRunId(null);
    },
  });

  const updateRecordMutation = useMutation({
    mutationFn: ({ recordId, otherDeductions }: { recordId: string; otherDeductions: number }) =>
      api.put(`/payroll/${viewRunId}/record/${recordId}`, { otherDeductions }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payroll-run', viewRunId] }),
  });

  const records = currentRun?.records ?? [];
  const is13th = currentRun?.payPeriodType === 9;
  const isDraft = currentRun?.status === 'DRAFT';

  const totalGross = records.reduce((s, r) => s + r.grossPay, 0);
  const totalNet = records.reduce((s, r) => s + r.netPay, 0);
  const totalTax = records.reduce((s, r) => s + r.withholdingTax, 0);
  const totalDeductions = records.reduce((s, r) => s + r.totalDeductions, 0);
  const totalOtherDeductions = records.reduce((s, r) => s + (r.otherDeductions ?? 0), 0);
  const totalOT = records.reduce((s, r) => s + r.overtimePay, 0);

  // Stable ref so columns useMemo never recomputes when mutation state changes.
  // Without this, isPending toggling re-creates column defs → TanStack tears down
  // OtherDeductionsCell → useState reinitialises to initialValue (server 0).
  const updateRecordMutationRef = useRef(updateRecordMutation);
  updateRecordMutationRef.current = updateRecordMutation;

  const handleOtherDeductionsBlur = useCallback((recordId: string, value: number) => {
    updateRecordMutationRef.current.mutate({ recordId, otherDeductions: value });
  }, []); // intentionally empty — reads through ref

  // ── Table columns — different layout for 13th month vs regular ───────────────
  const columns = useMemo<ColumnDef<PayrollRecord>[]>(() => {
    const employeeCol: ColumnDef<PayrollRecord> = {
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
    };
    const clientCol: ColumnDef<PayrollRecord> = {
      id: 'client',
      accessorFn: row => row.employee.client?.name ?? '',
      header: 'Client',
      cell: ({ getValue }) => <span className="text-muted text-sm">{(getValue() as string) || '—'}</span>,
    };
    const slipCol: ColumnDef<PayrollRecord> = {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row: { original: r } }) => (
        <button className="btn btn-ghost btn-sm" onClick={() => setShowSlip(r)}>Slip</button>
      ),
    };

    if (is13th) {
      return [
        employeeCol,
        clientCol,
        {
          accessorKey: 'daysWorked',
          header: 'Paid Days',
          cell: ({ getValue }) => {
            const v = getValue() as number;
            return <span>{Number.isInteger(v) ? v : v.toFixed(2)}</span>;
          },
        },
        {
          accessorKey: 'grossPay',
          header: 'Gross Pay',
          cell: ({ getValue }) => <span className="td-mono" style={{ fontWeight: 600 }}>{formatPHP(getValue() as number)}</span>,
        },
        {
          accessorKey: 'withholdingTax',
          header: 'Tax',
          cell: ({ getValue }) => {
            const v = getValue() as number;
            return <span className="td-mono text-muted">{v > 0 ? formatPHP(v) : '—'}</span>;
          },
        },
        {
          accessorKey: 'netPay',
          header: 'Net Pay',
          cell: ({ getValue }) => (
            <span className="td-mono" style={{ fontWeight: 800, color: 'var(--color-primary)' }}>
              {formatPHP(getValue() as number)}
            </span>
          ),
        },
        slipCol,
      ];
    }

    // Regular payroll columns
    return [
      employeeCol,
      clientCol,
      {
        accessorKey: 'daysWorked',
        header: 'Days',
        cell: ({ getValue }) => <span>{getValue() as number}</span>,
      },
      {
        accessorKey: 'basicSalary',
        header: 'Basic',
        cell: ({ getValue }) => <span className="td-mono">{formatPHP(getValue() as number)}</span>,
      },
      {
        accessorKey: 'overtimePay',
        header: 'OT Pay',
        cell: ({ getValue }) => {
          const v = getValue() as number;
          return <span className="td-mono">{v > 0 ? formatPHP(v) : '—'}</span>;
        },
      },
      {
        accessorKey: 'grossPay',
        header: 'Gross Pay',
        cell: ({ getValue }) => <span className="td-mono" style={{ fontWeight: 600 }}>{formatPHP(getValue() as number)}</span>,
      },
      {
        accessorKey: 'sssContrib',
        header: 'SSS',
        cell: ({ getValue }) => <span className="td-mono text-muted">{formatPHP(getValue() as number)}</span>,
      },
      {
        accessorKey: 'philhealthContrib',
        header: 'PhilHealth',
        cell: ({ getValue }) => <span className="td-mono text-muted">{formatPHP(getValue() as number)}</span>,
      },
      {
        accessorKey: 'pagibigContrib',
        header: 'Pag-IBIG',
        cell: ({ getValue }) => <span className="td-mono text-muted">{formatPHP(getValue() as number)}</span>,
      },
      {
        accessorKey: 'withholdingTax',
        header: 'Tax',
        cell: ({ getValue }) => <span className="td-mono text-muted">{formatPHP(getValue() as number)}</span>,
      },
      {
        id: 'otherDeductions',
        accessorKey: 'otherDeductions',
        header: 'Other Ded.',
        cell: ({ row: { original: r } }) => isDraft ? (
          <OtherDeductionsCell
            recordId={r.id}
            initialValue={r.otherDeductions ?? 0}
            onBlur={handleOtherDeductionsBlur}
          />
        ) : (
          <span className="td-mono text-muted">{(r.otherDeductions ?? 0) > 0 ? formatPHP(r.otherDeductions ?? 0) : '—'}</span>
        ),
      },
      {
        accessorKey: 'netPay',
        header: 'Net Pay',
        cell: ({ getValue }) => (
          <span className="td-mono" style={{ fontWeight: 800, color: 'var(--color-primary)' }}>
            {formatPHP(getValue() as number)}
          </span>
        ),
      },
      slipCol,
    ];
  }, [is13th, isDraft, handleOtherDeductionsBlur]);

  const handleDownloadDisbursement = async () => {
    if (!viewRunId || !currentRun) return;
    setDownloadingDisb(true);
    try {
      const resp = await api.get(`/payroll/${viewRunId}/disbursement`, { responseType: 'blob' });
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement('a');
      a.href = url;
      const safePeriod = (currentRun.period ?? viewRunId).replace(/[^a-zA-Z0-9_\-]/g, '_');
      a.download = `Disbursement_${safePeriod}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Failed to generate disbursement file.');
    } finally {
      setDownloadingDisb(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Payroll</h1>
          <p className="page-desc">Philippine payroll computation (TRAIN Law)</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {viewRunId && currentRun?.status === 'DRAFT' && isManager && (
            <>
              <button
                className="btn btn-ghost"
                style={{ color: 'var(--color-danger)' }}
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (confirm('Delete this draft payroll run? This cannot be undone.')) {
                    deleteMutation.mutate(viewRunId);
                  }
                }}
              >
                {deleteMutation.isPending ? 'Deleting…' : '🗑 Delete Draft'}
              </button>
              <button className="btn btn-success" disabled={postMutation.isPending} onClick={() => postMutation.mutate(viewRunId)}>
                {postMutation.isPending ? 'Posting…' : '✓ Post Payroll'}
              </button>
            </>
          )}
          {viewRunId && currentRun?.status === 'POSTED' && isManager && (
            <button
              className="btn btn-primary"
              disabled={paidMutation.isPending}
              onClick={() => {
                if (confirm('Mark this payroll run as PAID? This action cannot be reversed.')) {
                  paidMutation.mutate(viewRunId);
                }
              }}
            >
              {paidMutation.isPending ? 'Marking…' : '💳 Mark as Paid'}
            </button>
          )}
          {viewRunId && currentRun?.status === 'POSTED' && isManager && (
            <button className="btn btn-secondary btn-sm" disabled={downloadingDisb} onClick={handleDownloadDisbursement}>
              {downloadingDisb ? 'Generating…' : '⬇ Disbursement File'}
            </button>
          )}
          {viewRunId && (
            <button className="btn btn-ghost" onClick={() => setViewRunId(null)}>← Back to History</button>
          )}
          {isManager && !viewRunId && (
            <button className="btn btn-primary" onClick={() => setShowRunModal(true)}>▶ Run Payroll</button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : viewRunId && currentRun ? (
        <>
          {/* Run header */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{currentRun.period}</div>
                <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  {new Date(currentRun.periodStart).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                  {' → '}
                  {new Date(currentRun.periodEnd).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
                {currentRun.description && (
                  <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>{currentRun.description}</div>
                )}
              </div>
              <span className={`badge ${STATUS_COLORS[currentRun.status]}`} style={{ fontSize: 13 }}>
                {currentRun.status}
              </span>
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid-4" style={{ marginBottom: 20 }}>
            {(is13th ? [
              { label: 'Gross Pay', value: formatPHP(totalGross), icon: '💵', color: '#F0FDF4' },
              { label: 'Withholding Tax', value: formatPHP(totalTax), icon: '📉', color: '#FEF2F2' },
              { label: 'Net Pay', value: formatPHP(totalNet), icon: '✅', color: '#EFF6FF' },
              { label: 'Employees', value: records.length.toString(), icon: '👥', color: '#FFFBEB' },
            ] : [
              { label: 'Gross Pay', value: formatPHP(totalGross), icon: '💵', color: '#F0FDF4' },
              { label: 'Total Deductions', value: formatPHP(totalDeductions + totalOtherDeductions), icon: '📉', color: '#FEF2F2' },
              { label: 'Net Pay', value: formatPHP(totalNet), icon: '✅', color: '#EFF6FF' },
              { label: 'OT Pay', value: formatPHP(totalOT), icon: '⏱️', color: '#FFFBEB' },
            ]).map(s => (
              <div key={s.label} className="stat-card">
                <div className="stat-icon" style={{ background: s.color, fontSize: 20 }}>{s.icon}</div>
                <div>
                  <div className="stat-label">{s.label}</div>
                  <div className="stat-value" style={{ fontSize: 16 }}>{s.value}</div>
                  <div className="stat-delta">{records.length} employees</div>
                </div>
              </div>
            ))}
          </div>

          {/* Records table */}
          <div className="card" style={{ marginBottom: 20 }}>
            <DataTable
              data={records}
              columns={columns}
              globalFilterPlaceholder="Search employees or client…"
              exportFilename={`Payroll_${currentRun.period?.replace(/\s/g, '_')}`}
            />
          </div>

          {/* Audit log — managers only */}
          {isManager && (
            <div className="card">
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>
                Audit Trail
              </div>
              {auditLogs.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '8px 0' }}>No audit entries yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {auditLogs.map(log => (
                    <div key={log.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
                      <span className={`badge ${log.action === 'PAID' ? 'badge-green' : 'badge-blue'}`} style={{ minWidth: 60, textAlign: 'center' }}>
                        {log.action === 'POST' ? 'POSTED' : log.action}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                        {new Date(log.performedAt).toLocaleDateString('en-PH', {
                          year: 'numeric', month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>by {log.performedById}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        /* History list */
        history.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">💰</div>
            <div className="empty-state-title">No payroll runs yet</div>
            {isManager && <div>Click "Run Payroll" to process your first payroll period</div>}
          </div>
        ) : (
          <div className="card">
            <div className="card-header">
              <div className="card-title">Payroll History</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {history.map(h => (
                <div
                  key={h.id}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 4px', borderBottom: '1px solid var(--color-border)',
                  }}
                >
                  <button
                    onClick={() => setViewRunId(h.id)}
                    style={{
                      flex: 1, background: 'none', border: 'none', cursor: 'pointer',
                      textAlign: 'left', padding: 0,
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{h.period}</div>
                    <div className="text-muted text-sm" style={{ marginTop: 2 }}>
                      {h._count.records} employees
                      {h.periodStart && ` · ${new Date(h.periodStart).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} – ${new Date(h.periodEnd).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                    </div>
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className={`badge ${STATUS_COLORS[h.status]}`}>{h.status}</span>
                    {h.status === 'DRAFT' && isManager && (
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--color-danger)' }}
                        disabled={deleteMutation.isPending}
                        onClick={() => {
                          if (confirm('Delete this draft payroll run?')) deleteMutation.mutate(h.id);
                        }}
                      >
                        Delete
                      </button>
                    )}
                    <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>›</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      )}

      {showRunModal && (
        <RunPayrollModal
          onClose={() => setShowRunModal(false)}
          onSuccess={(runId) => {
            setShowRunModal(false);
            qc.invalidateQueries({ queryKey: ['payroll-history'] });
            setViewRunId(runId);
          }}
          defaultYear={now.getFullYear()}
          defaultMonth={now.getMonth() + 1}
        />
      )}

      {showSlip && currentRun && (
        <PayslipModal
          record={showSlip}
          payPeriodType={currentRun.payPeriodType}
          runPeriod={currentRun.period}
          onClose={() => setShowSlip(null)}
        />
      )}
    </div>
  );
}

// ── Inline editable other deductions cell ─────────────────────────────────────
function OtherDeductionsCell({ recordId, initialValue, onBlur, saving }: {
  recordId: string;
  initialValue: number;
  onBlur: (recordId: string, value: number) => void;
  saving: boolean;
}) {
  const [raw, setRaw] = useState(initialValue > 0 ? initialValue.toFixed(2) : '');
  return (
    <input
      type="text"
      inputMode="decimal"
      placeholder="0.00"
      value={raw}
      onChange={e => setRaw(e.target.value)}
      onBlur={() => {
        const parsed = parseFloat(raw.replace(/,/g, '')) || 0;
        setRaw(parsed > 0 ? parsed.toFixed(2) : '');
        onBlur(recordId, parsed);
      }}
      disabled={saving}
      style={{
        width: 80, padding: '3px 6px', fontSize: 12,
        border: '1px solid var(--color-border)', borderRadius: 4,
        background: 'var(--color-surface)', color: 'var(--color-text)',
        fontFamily: 'monospace', textAlign: 'right',
      }}
    />
  );
}

// ── Run Payroll Modal ──────────────────────────────────────────────────────────
function RunPayrollModal({ onClose, onSuccess, defaultYear, defaultMonth }: {
  onClose: () => void;
  onSuccess: (runId: string) => void;
  defaultYear: number;
  defaultMonth: number;
}) {
  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);
  const [payPeriodType, setPayPeriodType] = useState<number>(1);
  const [description, setDescription] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [error, setError] = useState('');

  const runMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/payroll/run', body).then(r => r.data),
    onSuccess: (data) => onSuccess(data.id),
    onError: (err: any) => setError(err?.response?.data?.error ?? 'Failed to run payroll'),
  });

  const is13th = payPeriodType === 9;
  const isSpecial = payPeriodType === 7;
  const isAdHoc = isSpecial;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (is13th) {
      runMutation.mutate({ year, payPeriodType });
      return;
    }
    const body: Record<string, unknown> = { year, month, payPeriodType };
    if (description) body.description = description;
    if (isAdHoc) {
      if (!periodStart || !periodEnd) { setError('Period start and end dates are required for this type'); return; }
      body.periodStart = periodStart;
      body.periodEnd = periodEnd;
    }
    runMutation.mutate(body);
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2 className="modal-title">Run Payroll</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}

            <div className="form-grid form-grid-2" style={{ gap: 12 }}>
              {!is13th && (
                <div className="form-group">
                  <label>Month *</label>
                  <select className="form-control" value={month} onChange={e => setMonth(Number(e.target.value))}>
                    {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                  </select>
                </div>
              )}

              <div className="form-group" style={is13th ? { gridColumn: '1/-1' } : {}}>
                <label>Year *</label>
                <select className="form-control" value={year} onChange={e => setYear(Number(e.target.value))}>
                  {[defaultYear - 1, defaultYear, defaultYear + 1].map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ gridColumn: '1/-1' }}>
                <label>Pay Period Type *</label>
                <select
                  className="form-control"
                  value={payPeriodType}
                  onChange={e => { setPayPeriodType(Number(e.target.value)); setDescription(''); setPeriodStart(''); setPeriodEnd(''); }}
                >
                  <option value={1}>Type 1 — Semi-monthly 1st half (run on 15th)</option>
                  <option value={2}>Type 2 — Semi-monthly 2nd half (run end of month)</option>
                  <option value={7}>Type 7 — Special pay (ad-hoc date)</option>
                  <option value={9}>Type 9 — 13th month pay</option>
                </select>
              </div>

              {is13th && (
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', background: 'var(--color-surface-2)', borderRadius: 8, padding: '8px 12px' }}>
                    Covers Jan 1 – Dec 31, {year}. Description and dates are auto-filled.<br />
                    All active employees are included.
                  </div>
                </div>
              )}

              {!is13th && !isAdHoc && (
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', background: 'var(--color-surface-2)', borderRadius: 8, padding: '8px 12px' }}>
                    {payPeriodType === 1
                      ? `Covers: ${MONTHS[month === 1 ? 11 : month - 2]} 26 → ${MONTHS[month - 1]} 10, ${year}`
                      : `Covers: ${MONTHS[month - 1]} 11 → ${MONTHS[month - 1]} 25, ${year}`
                    }
                    <br />
                    Only employees assigned to clients with matching pay period type will be included.
                  </div>
                </div>
              )}

              {isAdHoc && (
                <>
                  <div className="form-group" style={{ gridColumn: '1/-1' }}>
                    <label>Description * <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(e.g. "Christmas Bonus 2026")</span></label>
                    <input
                      className="form-control"
                      required
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      placeholder="Christmas Bonus 2026"
                    />
                  </div>
                  <div className="form-group">
                    <label>Period Start *</label>
                    <input type="date" className="form-control" required value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Period End *</label>
                    <input type="date" className="form-control" required value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
                  </div>
                  <div className="form-group" style={{ gridColumn: '1/-1' }}>
                    <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', background: 'var(--color-surface-2)', borderRadius: 8, padding: '8px 12px' }}>
                      All active employees will be included in this special run.
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={runMutation.isPending}>
              {runMutation.isPending ? 'Processing…' : '▶ Run Payroll'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Payslip Modal ─────────────────────────────────────────────────────────────
function PayslipModal({ record: r, payPeriodType, runPeriod, onClose }: {
  record: PayrollRecord;
  payPeriodType: number;
  runPeriod: string;
  onClose: () => void;
}) {
  const otherDed = r.otherDeductions ?? 0;
  const is13th = payPeriodType === 9;
  const [downloading, setDownloading] = useState(false);

  const handleDownloadPdf = async () => {
    setDownloading(true);
    try {
      const resp = await api.get(`/payroll/record/${r.id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Payslip_${r.employee.lastName}_${runPeriod.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={ev => ev.target === ev.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">Payslip — {r.employee.firstName} {r.employee.lastName}</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-ghost btn-sm" onClick={handleDownloadPdf} disabled={downloading}>
              {downloading ? 'Generating…' : '⬇ PDF'}
            </button>
            <button className="icon-btn" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div className="emp-avatar" style={{ width: 48, height: 48, fontSize: 16, background: r.employee.avatarColor }}>
              {r.employee.firstName[0]}{r.employee.lastName[0]}
            </div>
            <div>
              <div style={{ fontWeight: 700 }}>{r.employee.firstName} {r.employee.lastName}</div>
              <div className="text-muted text-sm">
                {r.employee.position} · {r.employee.department.name}
                {r.employee.client?.name && ` · ${r.employee.client.name}`}
              </div>
              <div className="text-muted text-sm">{runPeriod}</div>
            </div>
          </div>

          {is13th ? (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                13th Month Pay Computation
              </div>
              <div className="payslip-row">
                <span>Basic Salary (Monthly)</span>
                <span>{formatPHP(r.basicSalary)}</span>
              </div>
              <div className="payslip-row">
                <span>Daily Rate (÷ 22 days)</span>
                <span>{formatPHP(r.basicSalary / 22)}</span>
              </div>
              <div className="payslip-row">
                <span>
                  Paid Days
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 6 }}>
                    (present + approved leaves)
                  </span>
                </span>
                <span>
                  {Number.isInteger(r.daysWorked) ? r.daysWorked : (r.daysWorked as number).toFixed(2)} days
                </span>
              </div>
              <div className="payslip-row" style={{ fontWeight: 700 }}>
                <span>Gross Pay (Daily Rate × Paid Days ÷ 12)</span>
                <span>{formatPHP(r.grossPay)}</span>
              </div>

              <div className="divider" />

              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                Tax
              </div>
              <div className="payslip-row">
                <span>Tax-Exempt (first ₱90,000)</span>
                <span style={{ color: 'var(--color-success)' }}>{formatPHP(Math.min(r.grossPay, 90000))}</span>
              </div>
              {r.taxableIncome > 0 && (
                <>
                  <div className="payslip-row">
                    <span>Taxable Excess (above ₱90,000)</span>
                    <span>{formatPHP(r.taxableIncome)}</span>
                  </div>
                  <div className="payslip-row">
                    <span>Withholding Tax (TRAIN Law — annual rate)</span>
                    <span style={{ color: 'var(--color-danger)' }}>({formatPHP(r.withholdingTax)})</span>
                  </div>
                </>
              )}
              {r.taxableIncome === 0 && (
                <div className="payslip-row">
                  <span>Withholding Tax</span>
                  <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                </div>
              )}

              <div className="divider" />

              <div className="payslip-total">
                <span>NET PAY</span>
                <span>{formatPHP(r.netPay)}</span>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Earnings</div>
              <div className="payslip-row"><span>Basic Salary</span><span>{formatPHP(r.basicSalary)}</span></div>
              <div className="payslip-row"><span>Days Worked ({r.daysWorked} days)</span><span>{formatPHP(r.basicSalary / 22 * r.daysWorked)}</span></div>
              {r.overtimePay > 0 && <div className="payslip-row"><span>Overtime Pay</span><span>{formatPHP(r.overtimePay)}</span></div>}
              {r.allowances > 0 && <div className="payslip-row"><span>Allowances</span><span>{formatPHP(r.allowances)}</span></div>}
              <div className="payslip-row" style={{ fontWeight: 700 }}><span>Gross Pay</span><span>{formatPHP(r.grossPay)}</span></div>

              <div className="divider" />

              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Deductions</div>
              <div className="payslip-row"><span>SSS Contribution</span><span style={{ color: 'var(--color-danger)' }}>({formatPHP(r.sssContrib)})</span></div>
              <div className="payslip-row"><span>PhilHealth Contribution</span><span style={{ color: 'var(--color-danger)' }}>({formatPHP(r.philhealthContrib)})</span></div>
              <div className="payslip-row"><span>Pag-IBIG Contribution</span><span style={{ color: 'var(--color-danger)' }}>({formatPHP(r.pagibigContrib)})</span></div>
              <div className="payslip-row"><span>Taxable Income</span><span>{formatPHP(r.taxableIncome)}</span></div>
              <div className="payslip-row"><span>Withholding Tax (TRAIN Law)</span><span style={{ color: 'var(--color-danger)' }}>({formatPHP(r.withholdingTax)})</span></div>
              {otherDed > 0 && (
                <div className="payslip-row"><span>Other Deductions</span><span style={{ color: 'var(--color-danger)' }}>({formatPHP(otherDed)})</span></div>
              )}
              <div className="payslip-row" style={{ fontWeight: 700 }}>
                <span>Total Deductions</span>
                <span style={{ color: 'var(--color-danger)' }}>({formatPHP(r.totalDeductions + otherDed)})</span>
              </div>

              <div className="divider" />

              <div className="payslip-total">
                <span>NET PAY</span>
                <span>{formatPHP(r.netPay)}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
