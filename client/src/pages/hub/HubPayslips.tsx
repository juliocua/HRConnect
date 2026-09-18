import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatPHP } from '@/lib/payroll';
import type { MyPayrollRecord, PayrollStatus } from '@/types';

const STATUS_COLORS: Record<PayrollStatus, string> = {
  DRAFT: 'badge-yellow', POSTED: 'badge-blue', PAID: 'badge-green',
};

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

interface CutOffPeriod {
  id: string; name: string; sortOrder: number;
}

function getPeriodTypeLabel(type: number, cutOffPeriods: CutOffPeriod[]): string {
  if (type === 1) return cutOffPeriods[0]?.name ?? 'Semi-monthly (1st half)';
  if (type === 2) return cutOffPeriods[1]?.name ?? 'Semi-monthly (2nd half)';
  if (type === 7) return 'Special Pay';
  if (type === 9) return '13th Month Pay';
  return 'Payroll';
}

function fmtAttTime(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true });
}
const ATT_STATUS_BADGE: Record<string, string> = {
  PRESENT: '🟢', LATE: '🟡', ABSENT: '🔴', HALF_DAY: '🟠', ON_LEAVE: '🔵',
};

function PayslipAttendanceSection({ recordId }: { recordId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['payroll-attendance', recordId],
    queryFn: () => api.get(`/payroll/record/${recordId}/attendance`).then(r => r.data),
  });
  const thStyle: React.CSSProperties = { textAlign: 'left', padding: '3px 4px', color: 'var(--color-text-muted)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' };
  const tdStyle: React.CSSProperties = { padding: '3px 4px', fontSize: 11 };
  return (
    <div>
      <div className="divider" />
      <div
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', userSelect: 'none' }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Time Entries
        </span>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ paddingBottom: 8 }}>
          {isLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', color: 'var(--color-text-muted)', fontSize: 12 }}>
              <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Loading…
            </div>
          ) : !data ? null : (
            <>
              {data.attendance.length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6, marginBottom: 4, fontWeight: 600 }}>Daily Attendance</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                          <th style={thStyle}>Date</th>
                          <th style={thStyle}>Status</th>
                          <th style={thStyle}>Time In</th>
                          <th style={thStyle}>Time Out</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>OT hrs</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>Late min</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.attendance.map((a: any) => (
                          <tr key={a.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                            <td style={tdStyle}>{fmtDate(a.date)}</td>
                            <td style={tdStyle}>{ATT_STATUS_BADGE[a.status] ?? ''} {a.status}</td>
                            <td style={tdStyle}>{fmtAttTime(a.timeIn)}</td>
                            <td style={tdStyle}>{fmtAttTime(a.timeOut)}</td>
                            <td style={{ ...tdStyle, textAlign: 'right' }}>{a.overtimeHrs > 0 ? a.overtimeHrs : '—'}</td>
                            <td style={{ ...tdStyle, textAlign: 'right' }}>{a.lateMinutes > 0 ? a.lateMinutes : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {data.overtime.length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8, marginBottom: 4, fontWeight: 600 }}>Approved Overtime</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <th style={thStyle}>Date</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Hours</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.overtime.map((o: any) => (
                        <tr key={o.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                          <td style={tdStyle}>{fmtDate(o.date)}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{o.hours}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              {data.leaves.length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8, marginBottom: 4, fontWeight: 600 }}>Approved Leaves</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <th style={thStyle}>Leave Type</th>
                        <th style={thStyle}>From</th>
                        <th style={thStyle}>To</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.leaves.map((l: any) => (
                        <tr key={l.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                          <td style={tdStyle}>{l.leaveType?.name ?? '—'}</td>
                          <td style={tdStyle}>{fmtDate(l.startDate)}</td>
                          <td style={tdStyle}>{fmtDate(l.endDate)}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{l.totalDays}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              {data.attendance.length === 0 && data.overtime.length === 0 && data.leaves.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '6px 0' }}>No time entries found for this period.</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function fmtDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function HubPayslips() {
  const [showSlip, setShowSlip] = useState<MyPayrollRecord | null>(null);
  const [yearFilter, setYearFilter]   = useState<string>('');
  const [monthFilter, setMonthFilter] = useState<string>('');
  const [typeFilter, setTypeFilter]   = useState<string>('');

  const { data: records = [], isLoading } = useQuery<MyPayrollRecord[]>({
    queryKey: ['hub-payslips'],
    queryFn: () => api.get('/payroll/me').then(r => r.data),
  });

  const { data: cutOffPeriods = [] } = useQuery<CutOffPeriod[]>({
    queryKey: ['cutoff-periods'],
    queryFn: () => api.get('/global-setup/cutoff-periods').then(r => r.data),
  });

  const yearOptions = useMemo(() =>
    [...new Set(records.map(r => r.payrollRun.year))].sort((a, b) => b - a),
  [records]);

  const monthOptions = useMemo(() =>
    [...new Set(records.map(r => r.payrollRun.month))].sort((a, b) => a - b),
  [records]);

  const typeOptions = useMemo(() =>
    [...new Set(records.map(r => r.payrollRun.payPeriodType))].sort((a, b) => a - b),
  [records]);

  const filtered = useMemo(() => records.filter(r => {
    if (yearFilter  && String(r.payrollRun.year)          !== yearFilter)  return false;
    if (monthFilter && String(r.payrollRun.month)         !== monthFilter) return false;
    if (typeFilter  && String(r.payrollRun.payPeriodType) !== typeFilter)  return false;
    return true;
  }), [records, yearFilter, monthFilter, typeFilter]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>My Payslips</h1>
        {records.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {/* Year */}
            <select
              className="form-control"
              style={{ width: 100, fontSize: 13 }}
              value={yearFilter}
              onChange={e => setYearFilter(e.target.value)}
            >
              <option value="">All Years</option>
              {yearOptions.map(y => <option key={y} value={String(y)}>{y}</option>)}
            </select>

            {/* Month */}
            <select
              className="form-control"
              style={{ width: 130, fontSize: 13 }}
              value={monthFilter}
              onChange={e => setMonthFilter(e.target.value)}
            >
              <option value="">All Months</option>
              {monthOptions.map(m => <option key={m} value={String(m)}>{MONTHS[m - 1]}</option>)}
            </select>

            {/* Pay period type */}
            <select
              className="form-control"
              style={{ width: 210, fontSize: 13 }}
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
            >
              <option value="">All Pay Types</option>
              {typeOptions.map(t => (
                <option key={t} value={String(t)}>{getPeriodTypeLabel(t, cutOffPeriods)}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, marginBottom: 24 }}>
        Your payroll history — {filtered.length} payslip{filtered.length !== 1 ? 's' : ''}
      </p>

      {isLoading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">💰</div>
          <div className="empty-state-title">No payslips yet</div>
          <div>Your payslips will appear here once payroll is processed</div>
        </div>
      ) : (
        <>
          {/* Latest payslip summary card */}
          {filtered[0] && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Latest Payslip</div>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>
                    {filtered[0].payrollRun.description || `${MONTHS[(filtered[0].payrollRun.month || 1) - 1]} ${filtered[0].payrollRun.year}`}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                    {getPeriodTypeLabel(filtered[0].payrollRun.payPeriodType, cutOffPeriods)}
                    {filtered[0].payrollRun.periodStart && (
                      <> · {fmtDate(filtered[0].payrollRun.periodStart)} – {fmtDate(filtered[0].payrollRun.periodEnd)}</>
                    )}
                  </div>
                  {(filtered[0] as any).employee?.client && (
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                      Deployed to: <strong>{(filtered[0] as any).employee.client.name}</strong>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                  {[
                    { label: 'Gross Pay', value: formatPHP(filtered[0].grossPay), bold: false },
                    { label: 'Deductions', value: formatPHP(filtered[0].totalDeductions), bold: false },
                    { label: 'Net Pay', value: formatPHP(filtered[0].netPay), bold: true },
                  ].map(s => (
                    <div key={s.label} style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
                      <div style={{ fontWeight: s.bold ? 800 : 600, fontSize: s.bold ? 20 : 14, color: s.bold ? 'var(--color-primary)' : undefined }}>{s.value}</div>
                    </div>
                  ))}
                </div>
                <button className="btn btn-primary" onClick={() => setShowSlip(filtered[0])}>View Payslip</button>
              </div>
            </div>
          )}

          {/* History table */}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Cut-off Dates</th>
                  <th>Days</th>
                  <th>Gross Pay</th>
                  <th>Deductions</th>
                  <th>Net Pay</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>
                        {r.payrollRun.description || `${MONTHS[(r.payrollRun.month || 1) - 1]} ${r.payrollRun.year}`}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                        {getPeriodTypeLabel(r.payrollRun.payPeriodType, cutOffPeriods)}
                      </div>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                      {r.payrollRun.periodStart ? `${fmtDate(r.payrollRun.periodStart)} – ${fmtDate(r.payrollRun.periodEnd)}` : '—'}
                    </td>
                    <td>{r.daysWorked}</td>
                    <td className="td-mono">{formatPHP(r.grossPay)}</td>
                    <td className="td-mono text-muted">{formatPHP(r.totalDeductions)}</td>
                    <td className="td-mono" style={{ fontWeight: 800, color: 'var(--color-primary)' }}>{formatPHP(r.netPay)}</td>
                    <td><span className={`badge ${STATUS_COLORS[r.payrollRun.status]}`}>{r.payrollRun.status}</span></td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => setShowSlip(r)}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showSlip && <PayslipModal record={showSlip} cutOffPeriods={cutOffPeriods} onClose={() => setShowSlip(null)} />}
    </div>
  );
}

function PayslipModal({ record: r, cutOffPeriods, onClose }: { record: MyPayrollRecord; cutOffPeriods: CutOffPeriod[]; onClose: () => void }) {
  const periodLabel = r.payrollRun.description || `${MONTHS[(r.payrollRun.month || 1) - 1]} ${r.payrollRun.year}`;
  const clientName = (r as any).employee?.client?.name;
  const [downloading, setDownloading] = useState(false);

  const otherDed = r.otherDeductions ?? 0;
  const lateDed = r.lateDeduction ?? 0;
  const holidayPay = r.holidayPay ?? 0;
  const nightDiff = r.nightDifferential ?? 0;

  const handleDownloadPdf = async () => {
    setDownloading(true);
    try {
      const resp = await api.get(`/payroll/record/${r.id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Payslip_${periodLabel.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
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
          <h2 className="modal-title">Payslip — {periodLabel}</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={handleDownloadPdf} disabled={downloading}>
              {downloading ? 'Generating…' : '⬇ PDF'}
            </button>
            <button className="icon-btn" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="modal-body">
          {/* Header info */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Pay Period</div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{periodLabel}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                {getPeriodTypeLabel(r.payrollRun.payPeriodType, cutOffPeriods)}
              </div>
            </div>
            <span className={`badge ${STATUS_COLORS[r.payrollRun.status]}`}>{r.payrollRun.status}</span>
          </div>

          {/* Cut-off and client info */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16, padding: '10px 12px', background: 'var(--color-surface-2)', borderRadius: 8 }}>
            {r.payrollRun.periodStart && (
              <>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Cut-off Start</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{fmtDate(r.payrollRun.periodStart)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Cut-off End</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{fmtDate(r.payrollRun.periodEnd)}</div>
                </div>
              </>
            )}
            {r.payrollRun.runAt && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Payroll Date</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{fmtDate(r.payrollRun.runAt)}</div>
              </div>
            )}
            {clientName && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Client Assignment</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{clientName}</div>
              </div>
            )}
          </div>

          {/* Earnings */}
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Earnings</div>
          {(r as any).employee?.useDailyRate && (r as any).employee?.dailyRate ? (
            <>
              <div className="payslip-row"><span>Daily Rate</span><span>{formatPHP((r as any).employee.dailyRate)} / day</span></div>
              <div className="payslip-row"><span>Days Worked ({r.daysWorked} days)</span><span>{formatPHP((r as any).employee.dailyRate * r.daysWorked)}</span></div>
            </>
          ) : (
            <>
              <div className="payslip-row"><span>Basic Salary</span><span>{formatPHP(r.basicSalary)}</span></div>
              <div className="payslip-row"><span>Days Worked ({r.daysWorked} days)</span><span>{formatPHP(r.basicSalary / 22 * r.daysWorked)}</span></div>
            </>
          )}
          {r.overtimePay > 0 && <div className="payslip-row"><span>Overtime Pay</span><span>{formatPHP(r.overtimePay)}</span></div>}
          {holidayPay > 0 && <div className="payslip-row"><span>Holiday Pay</span><span>{formatPHP(holidayPay)}</span></div>}
          {nightDiff > 0 && <div className="payslip-row"><span>Night Differential</span><span>{formatPHP(nightDiff)}</span></div>}
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
          {lateDed > 0 && (
            <div className="payslip-row"><span>Late Deduction</span><span style={{ color: 'var(--color-danger)' }}>({formatPHP(lateDed)})</span></div>
          )}
          {otherDed > 0 && (
            <div className="payslip-row">
              <span>Other Deductions{(r as any).otherDeductionsNote ? ` (${(r as any).otherDeductionsNote})` : ''}</span>
              <span style={{ color: 'var(--color-danger)' }}>({formatPHP(otherDed)})</span>
            </div>
          )}
          <div className="payslip-row" style={{ fontWeight: 700 }}>
            <span>Total Deductions</span>
            <span style={{ color: 'var(--color-danger)' }}>({formatPHP(r.totalDeductions + otherDed + lateDed)})</span>
          </div>

          <div className="divider" />

          <div className="payslip-total">
            <span>NET PAY</span>
            <span>{formatPHP(r.netPay)}</span>
          </div>

          <PayslipAttendanceSection recordId={r.id} />
        </div>
      </div>
    </div>
  );
}
