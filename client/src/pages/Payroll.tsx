import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatPHP } from '@/lib/payroll';
import { DataTable } from '@/components/DataTable';
import type { PayrollRun, PayrollRecord, PayrollStatus } from '@/types';

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
  const [downloadingGovReport, setDownloadingGovReport] = useState(false);

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

  const postMutation = useMutation({
    mutationFn: (runId: string) => api.put(`/payroll/${runId}/post`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-history'] });
      qc.invalidateQueries({ queryKey: ['payroll-run', viewRunId] });
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
  const isDraft = currentRun?.status === 'DRAFT';
  const totalGross = records.reduce((s, r) => s + r.grossPay, 0);
  const totalDeductions = records.reduce((s, r) => s + r.totalDeductions, 0);
  const totalOtherDeductions = records.reduce((s, r) => s + (r.otherDeductions ?? 0), 0);
  const totalNet = records.reduce((s, r) => s + r.netPay, 0);
  const totalOT = records.reduce((s, r) => s + r.overtimePay, 0);

  const handleOtherDeductionsBlur = useCallback((recordId: string, value: number) => {
    updateRecordMutation.mutate({ recordId, otherDeductions: value });
  }, [updateRecordMutation]);

  const handleDownloadGovReport = async () => {
    if (!viewRunId || !currentRun) return;
    setDownloadingGovReport(true);
    try {
      const resp = await api.get(`/payroll/${viewRunId}/gov-report`);
      const { month, year, records: govRecs } = resp.data;
      const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const header = ['Emp #','Employee','SSS','WISP','PHIC','HDMF','Withholding Tax'].join(',');
      const rows = govRecs.map((r: any) =>
        [r.employeeNo, `"${r.name}"`, r.sss.toFixed(2), r.wisp.toFixed(2), r.phic.toFixed(2), r.hdmf.toFixed(2), r.tax.toFixed(2)].join(',')
      );
      const csv = [header, ...rows].join('\r\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `GovBenefits_${MONTHS_SHORT[month - 1]}_${year}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { console.error('Failed to generate gov benefits report'); }
    finally { setDownloadingGovReport(false); }
  };

  const columns = useMemo<ColumnDef<PayrollRecord>[]>(() => [
    {
      id: 'empNo',
      accessorFn: row => row.employee.employeeNo,
      header: 'Emp #',
      cell: ({ getValue }) => <span className="text-sm text-muted" style={{ fontFamily: 'monospace' }}>{getValue() as string}</span>,
    },
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
      id: 'client',
      accessorFn: row => row.employee.client?.name ?? '',
      header: 'Client',
      cell: ({ getValue }) => <span className="text-muted text-sm">{(getValue() as string) || '—'}</span>,
    },
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
      id: 'sss',
      accessorKey: 'sssContrib',
      header: 'SSS',
      cell: ({ row: { original: r } }) => {
        const regular = Math.min(r.sssContrib, 900);
        return <span className="td-mono text-muted">{formatPHP(regular)}</span>;
      },
    },
    {
      id: 'wisp',
      accessorKey: 'sssContrib',
      header: 'WISP',
      cell: ({ row: { original: r } }) => {
        const wisp = Math.max(0, r.sssContrib - 900);
        return <span className="td-mono text-muted">{wisp > 0 ? formatPHP(wisp) : '—'}</span>;
      },
    },
    {
      accessorKey: 'philhealthContrib',
      header: 'PHIC',
      cell: ({ getValue }) => <span className="td-mono text-muted">{formatPHP(getValue() as number)}</span>,
    },
    {
      accessorKey: 'pagibigContrib',
      header: 'HDMF',
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
          saving={updateRecordMutation.isPending && updateRecordMutation.variables?.recordId === r.id}
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
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row: { original: r } }) => (
        <button className="btn btn-ghost btn-sm" onClick={() => setShowSlip(r)}>Slip</button>
      ),
    },
  ], [isDraft, handleOtherDeductionsBlur, updateRecordMutation]);

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
          {viewRunId && currentRun && isManager && (
            <>
              <button className="btn btn-secondary btn-sm" disabled={downloadingGovReport} onClick={handleDownloadGovReport}>
                {downloadingGovReport ? 'Generating…' : '🏛 Gov Benefits'}
              </button>
            </>
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
                {currentRun.soaNo && (
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                    SOA # <strong>{currentRun.soaNo}</strong>
                  </div>
                )}
              </div>
              <span className={`badge ${STATUS_COLORS[currentRun.status]}`} style={{ fontSize: 13 }}>
                {currentRun.status}
              </span>
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid-4" style={{ marginBottom: 20 }}>
            {[
              { label: 'Gross Pay', value: formatPHP(totalGross), icon: '💵', color: '#F0FDF4' },
              { label: 'Total Deductions', value: formatPHP(totalDeductions + totalOtherDeductions), icon: '📉', color: '#FEF2F2' },
              { label: 'Net Pay', value: formatPHP(totalNet), icon: '✅', color: '#EFF6FF' },
              { label: 'OT Pay', value: formatPHP(totalOT), icon: '⏱️', color: '#FFFBEB' },
            ].map(s => (
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

          {/* Records table with DataTable */}
          <div className="card">
            <DataTable
              data={records}
              columns={columns}
              globalFilterPlaceholder="Search employees or client…"
              exportFilename={`Payroll_${currentRun.period?.replace(/\s/g, '_')}`}
            />
          </div>
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
                      {(h as any).soaNo && ` · SOA# ${(h as any).soaNo}`}
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

      {showSlip && <PayslipModal record={showSlip} onClose={() => setShowSlip(null)} />}
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
  const [value, setValue] = useState(initialValue);
  return (
    <input
      type="number"
      min={0}
      step={0.01}
      value={value}
      onChange={e => setValue(parseFloat(e.target.value) || 0)}
      onBlur={() => onBlur(recordId, value)}
      disabled={saving}
      style={{
        width: 80, padding: '3px 6px', fontSize: 12,
        border: '1px solid var(--color-border)', borderRadius: 4,
        background: 'var(--color-surface)', color: 'var(--color-text)',
        fontFamily: 'monospace',
      }}
    />
  );
}

// ── Run Payroll Modal ──────────────────────────────────────────────────────────
interface CutOffPeriod {
  id: string;
  name: string;
  cutOffFromDay: number;
  cutOffFromIsPrevMonth: boolean;
  cutOffToDay: number;
  payDay: number;
  payDayIsNextMonth: boolean;
  sortOrder: number;
  isActive: boolean;
}

function RunPayrollModal({ onClose, onSuccess, defaultYear, defaultMonth }: {
  onClose: () => void;
  onSuccess: (runId: string) => void;
  defaultYear: number;
  defaultMonth: number;
}) {
  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);
  // selectedOption: 'co_<cutOffPeriodId>' | '7' | '9'
  const [selectedOption, setSelectedOption] = useState<string>('');
  const [description, setDescription] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [error, setError] = useState('');

  const { data: cutOffPeriods = [] } = useQuery<CutOffPeriod[]>({
    queryKey: ['cutoff-periods'],
    queryFn: () => api.get('/global-setup/cutoff-periods').then(r => r.data),
  });

  // Auto-select first cut-off period (or '7' if none configured)
  useEffect(() => {
    if (selectedOption) return;
    if (cutOffPeriods.length > 0) {
      setSelectedOption(`co_${cutOffPeriods[0].id}`);
    }
  }, [cutOffPeriods, selectedOption]);

  // Derive payPeriodType and cutOffPeriodId from the dropdown selection
  const { payPeriodType, cutOffPeriodId } = useMemo(() => {
    if (selectedOption === '7') return { payPeriodType: 7, cutOffPeriodId: undefined };
    if (selectedOption === '9') return { payPeriodType: 9, cutOffPeriodId: undefined };
    if (selectedOption.startsWith('co_')) {
      const id = selectedOption.slice(3);
      const idx = cutOffPeriods.findIndex(p => p.id === id);
      // Map to Type 1 (1st period) or Type 2 (2nd+) for employee filtering
      return { payPeriodType: idx <= 0 ? 1 : 2, cutOffPeriodId: id };
    }
    return { payPeriodType: 1, cutOffPeriodId: undefined };
  }, [selectedOption, cutOffPeriods]);

  // Compute actual date range from the selected cut-off period + month/year
  const previewDates = useMemo((): { start: Date; end: Date } | null => {
    if (!cutOffPeriodId) return null;
    const period = cutOffPeriods.find(p => p.id === cutOffPeriodId);
    if (!period) return null;
    let fromYear = year;
    let fromMonthIdx = month - 1; // 0-indexed
    if (period.cutOffFromIsPrevMonth) {
      if (month === 1) { fromYear = year - 1; fromMonthIdx = 11; }
      else { fromMonthIdx = month - 2; }
    }
    return {
      start: new Date(fromYear, fromMonthIdx, period.cutOffFromDay),
      end: new Date(year, month - 1, period.cutOffToDay),
    };
  }, [cutOffPeriodId, cutOffPeriods, month, year]);

  const isAdHoc = payPeriodType === 7 || payPeriodType === 9;

  const runMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/payroll/run', body).then(r => r.data),
    onSuccess: (data) => onSuccess(data.id),
    onError: (err: any) => setError(err?.response?.data?.error ?? 'Failed to run payroll'),
  });

  const fmtDate = (d: Date) => d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const body: Record<string, unknown> = { year, month, payPeriodType };
    if (cutOffPeriodId) body.cutOffPeriodId = cutOffPeriodId;
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
              <div className="form-group">
                <label>Month *</label>
                <select className="form-control" value={month} onChange={e => setMonth(Number(e.target.value))}>
                  {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Year *</label>
                <select className="form-control" value={year} onChange={e => setYear(Number(e.target.value))}>
                  {[defaultYear - 1, defaultYear, defaultYear + 1].map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ gridColumn: '1/-1' }}>
                <label>Pay Period *</label>
                <select
                  className="form-control"
                  value={selectedOption}
                  onChange={e => setSelectedOption(e.target.value)}
                >
                  {cutOffPeriods.length > 0 && (
                    <optgroup label="Regular Cut-Off Periods">
                      {cutOffPeriods.map(p => (
                        <option key={p.id} value={`co_${p.id}`}>{p.name}</option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="Special Runs">
                    <option value="7">Special Pay (ad-hoc date)</option>
                    <option value="9">13th Month Pay (full year)</option>
                  </optgroup>
                </select>
              </div>

              {!isAdHoc && previewDates && (
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', background: 'var(--color-surface-2)', borderRadius: 8, padding: '8px 12px' }}>
                    Covers: <strong>{fmtDate(previewDates.start)}</strong> → <strong>{fmtDate(previewDates.end)}</strong>
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
                      placeholder={payPeriodType === 9 ? '13th Month Pay 2026' : 'Christmas Bonus 2026'}
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
            <button
              type="submit"
              className="btn btn-primary"
              disabled={runMutation.isPending || !selectedOption}
            >
              {runMutation.isPending ? 'Processing…' : '▶ Run Payroll'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PayslipModal({ record: r, onClose }: { record: PayrollRecord; onClose: () => void }) {
  const otherDed = r.otherDeductions ?? 0;
  return (
    <div className="modal-overlay" onClick={ev => ev.target === ev.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">Payslip — {r.employee.firstName} {r.employee.lastName}</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {/* Employee info */}
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
            </div>
          </div>

          {/* Earnings */}
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Earnings</div>
          <div className="payslip-row"><span>Basic Salary</span><span>{formatPHP(r.basicSalary)}</span></div>
          <div className="payslip-row"><span>Days Worked ({r.daysWorked} days)</span><span>{formatPHP(r.basicSalary / 22 * r.daysWorked)}</span></div>
          {r.overtimePay > 0 && <div className="payslip-row"><span>Overtime Pay</span><span>{formatPHP(r.overtimePay)}</span></div>}
          {r.allowances > 0 && <div className="payslip-row"><span>Allowances</span><span>{formatPHP(r.allowances)}</span></div>}
          <div className="payslip-row" style={{ fontWeight: 700 }}><span>Gross Pay</span><span>{formatPHP(r.grossPay)}</span></div>

          <div className="divider" />

          {/* Deductions */}
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
        </div>
      </div>
    </div>
  );
}
