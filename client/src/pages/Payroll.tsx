import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatPHP } from '@/lib/payroll';
import type { PayrollRun, PayrollRecord, PayrollStatus } from '@/types';

const STATUS_COLORS: Record<PayrollStatus, string> = {
  DRAFT: 'badge-yellow', POSTED: 'badge-blue', PAID: 'badge-green',
};

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const PAY_PERIOD_LABELS: Record<number, string> = {
  1: 'Type 1 — Semi-monthly 1st half (paid 15th)',
  2: 'Type 2 — Semi-monthly 2nd half (paid end of month)',
  7: 'Type 7 — Special pay (ad-hoc)',
  9: 'Type 9 — 13th month pay (ad-hoc)',
};

export default function Payroll() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const now = new Date();
  const [showRunModal, setShowRunModal] = useState(false);
  const [viewRunId, setViewRunId] = useState<string | null>(null);
  const [showSlip, setShowSlip] = useState<PayrollRecord | null>(null);

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

  const records = currentRun?.records ?? [];
  const totalGross = records.reduce((s, r) => s + r.grossPay, 0);
  const totalDeductions = records.reduce((s, r) => s + r.totalDeductions, 0);
  const totalNet = records.reduce((s, r) => s + r.netPay, 0);
  const totalOT = records.reduce((s, r) => s + r.overtimePay, 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Payroll</h1>
          <p className="page-desc">Philippine payroll computation (TRAIN Law)</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {viewRunId && currentRun?.status === 'DRAFT' && isManager && (
            <button className="btn btn-success" disabled={postMutation.isPending} onClick={() => postMutation.mutate(viewRunId)}>
              {postMutation.isPending ? 'Posting…' : '✓ Post Payroll'}
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
              { label: 'Total Deductions', value: formatPHP(totalDeductions), icon: '📉', color: '#FEF2F2' },
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

          {/* Records table */}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Dept</th>
                  <th>Days</th>
                  <th>Basic</th>
                  <th>OT Pay</th>
                  <th>Gross Pay</th>
                  <th>SSS</th>
                  <th>PhilHealth</th>
                  <th>Pag-IBIG</th>
                  <th>Tax</th>
                  <th>Net Pay</th>
                  <th></th>
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
                    <td className="text-muted text-sm">{r.employee.department.name}</td>
                    <td>{r.daysWorked}</td>
                    <td className="td-mono">{formatPHP(r.basicSalary)}</td>
                    <td className="td-mono">{r.overtimePay > 0 ? formatPHP(r.overtimePay) : '—'}</td>
                    <td className="td-mono" style={{ fontWeight: 600 }}>{formatPHP(r.grossPay)}</td>
                    <td className="td-mono text-muted">{formatPHP(r.sssContrib)}</td>
                    <td className="td-mono text-muted">{formatPHP(r.philhealthContrib)}</td>
                    <td className="td-mono text-muted">{formatPHP(r.pagibigContrib)}</td>
                    <td className="td-mono text-muted">{formatPHP(r.withholdingTax)}</td>
                    <td className="td-mono" style={{ fontWeight: 800, color: 'var(--color-primary)' }}>
                      {formatPHP(r.netPay)}
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => setShowSlip(r)}>Slip</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--color-surface-2)', fontWeight: 700 }}>
                  <td colSpan={5} style={{ padding: '13px 16px', fontSize: 13 }}>TOTAL ({records.length} employees)</td>
                  <td className="td-mono" style={{ padding: '13px 16px', fontWeight: 800 }}>{formatPHP(totalGross)}</td>
                  <td colSpan={3} style={{ padding: '13px 16px' }}></td>
                  <td style={{ padding: '13px 16px' }}></td>
                  <td className="td-mono" style={{ padding: '13px 16px', fontWeight: 800, color: 'var(--color-primary)', fontSize: 14 }}>
                    {formatPHP(totalNet)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
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
                <button
                  key={h.id}
                  onClick={() => setViewRunId(h.id)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 4px', borderBottom: '1px solid var(--color-border)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    textAlign: 'left', width: '100%', borderRadius: 6,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{h.period}</div>
                    <div className="text-muted text-sm" style={{ marginTop: 2 }}>
                      {h._count.records} employees
                      {h.periodStart && ` · ${new Date(h.periodStart).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} – ${new Date(h.periodEnd).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className={`badge ${STATUS_COLORS[h.status]}`}>{h.status}</span>
                    <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>›</span>
                  </div>
                </button>
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

  const isAdHoc = payPeriodType === 7 || payPeriodType === 9;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
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
                <label>Pay Period Type *</label>
                <select className="form-control" value={payPeriodType} onChange={e => setPayPeriodType(Number(e.target.value))}>
                  <option value={1}>Type 1 — Semi-monthly 1st half (run on 15th)</option>
                  <option value={2}>Type 2 — Semi-monthly 2nd half (run end of month)</option>
                  <option value={7}>Type 7 — Special pay (ad-hoc date)</option>
                  <option value={9}>Type 9 — 13th month pay (ad-hoc date)</option>
                </select>
              </div>

              {!isAdHoc && (
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
            <button type="submit" className="btn btn-primary" disabled={runMutation.isPending}>
              {runMutation.isPending ? 'Processing…' : '▶ Run Payroll'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PayslipModal({ record: r, onClose }: { record: PayrollRecord; onClose: () => void }) {
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
              <div className="text-muted text-sm">{r.employee.position} · {r.employee.department.name}</div>
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
          <div className="payslip-row" style={{ fontWeight: 700 }}><span>Total Deductions</span><span style={{ color: 'var(--color-danger)' }}>({formatPHP(r.totalDeductions)})</span></div>

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