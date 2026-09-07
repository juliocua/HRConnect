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

export default function Payroll() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [showSlip, setShowSlip] = useState<PayrollRecord | null>(null);

  const isManager = user?.role === 'HR_MANAGER' || user?.role === 'SUPER_ADMIN';

  const { data: currentRun = null, isLoading } = useQuery<PayrollRun | null>({
    queryKey: ['payroll', year, month],
    queryFn: () => api.get(`/payroll?year=${year}&month=${month}`).then(r => r.data ?? null),
  });

  const { data: history = [] } = useQuery<(PayrollRun & { _count: { records: number } })[]>({
    queryKey: ['payroll-history'],
    queryFn: () => api.get('/payroll/history').then(r => r.data),
  });

  const runMutation = useMutation({
    mutationFn: () => api.post('/payroll/run', { year, month }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payroll'] }),
  });

  const postMutation = useMutation({
    mutationFn: (runId: string) => api.put(`/payroll/${runId}/post`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payroll'] }),
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
        {isManager && !currentRun && (
          <button className="btn btn-primary" disabled={runMutation.isPending} onClick={() => runMutation.mutate()}>
            {runMutation.isPending ? 'Processing…' : `▶ Run ${MONTHS[month - 1]} ${year} Payroll`}
          </button>
        )}
        {isManager && currentRun?.status === 'DRAFT' && (
          <button className="btn btn-success" disabled={postMutation.isPending} onClick={() => postMutation.mutate(currentRun.id)}>
            {postMutation.isPending ? 'Posting…' : '✓ Post Payroll'}
          </button>
        )}
      </div>

      {/* Period selector */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="filter-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>Period:</label>
            <select className="form-control" style={{ width: 140 }} value={month} onChange={e => setMonth(Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <select className="form-control" style={{ width: 90 }} value={year} onChange={e => setYear(Number(e.target.value))}>
              {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          {currentRun && (
            <span className={`badge ${STATUS_COLORS[currentRun.status]}`} style={{ fontSize: 13 }}>
              {currentRun.status}
            </span>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : !currentRun ? (
        <div className="empty-state">
          <div className="empty-state-icon">💰</div>
          <div className="empty-state-title">No payroll run for {MONTHS[month - 1]} {year}</div>
          {isManager ? (
            <div>Click "Run Payroll" to process this period</div>
          ) : (
            <div>The payroll for this period hasn't been processed yet</div>
          )}
        </div>
      ) : (
        <>
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

          {/* History */}
          {history.length > 1 && (
            <div className="card" style={{ marginTop: 24 }}>
              <div className="card-header">
                <div className="card-title">Payroll History</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {history.map(h => (
                  <div key={h.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{h.period}</div>
                      <div className="text-muted text-sm">{h._count.records} employees</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span className={`badge ${STATUS_COLORS[h.status]}`}>{h.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {showSlip && <PayslipModal record={showSlip} onClose={() => setShowSlip(null)} />}
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