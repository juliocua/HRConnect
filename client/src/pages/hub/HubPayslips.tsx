import { useState } from 'react';
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

const PAY_PERIOD_LABELS: Record<number, string> = {
  1: 'Semi-monthly (1st half)',
  2: 'Semi-monthly (2nd half)',
  7: 'Special Pay',
  9: '13th Month Pay',
};

function fmtDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function HubPayslips() {
  const [showSlip, setShowSlip] = useState<MyPayrollRecord | null>(null);
  const [yearFilter, setYearFilter] = useState<string>('');

  const { data: records = [], isLoading } = useQuery<MyPayrollRecord[]>({
    queryKey: ['hub-payslips'],
    queryFn: () => api.get('/payroll/me').then(r => r.data),
  });

  const years = [...new Set(records.map(r => r.payrollRun.year))].sort((a, b) => b - a);
  const filtered = yearFilter ? records.filter(r => String(r.payrollRun.year) === yearFilter) : records;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>My Payslips</h1>
        {years.length > 1 && (
          <select
            className="form-control"
            style={{ width: 120, fontSize: 13 }}
            value={yearFilter}
            onChange={e => setYearFilter(e.target.value)}
          >
            <option value="">All Years</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
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
                    {PAY_PERIOD_LABELS[filtered[0].payrollRun.payPeriodType] ?? 'Payroll'}
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
                        {PAY_PERIOD_LABELS[r.payrollRun.payPeriodType] ?? ''}
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

      {showSlip && <PayslipModal record={showSlip} onClose={() => setShowSlip(null)} />}
    </div>
  );
}

function PayslipModal({ record: r, onClose }: { record: MyPayrollRecord; onClose: () => void }) {
  const periodLabel = r.payrollRun.description || `${MONTHS[(r.payrollRun.month || 1) - 1]} ${r.payrollRun.year}`;
  const clientName = (r as any).employee?.client?.name;
  const [downloading, setDownloading] = useState(false);

  const handlePrint = () => window.print();

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
              {downloading ? 'Generating…' : '⬇ Download PDF'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={handlePrint}>🖨️ Print</button>
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
                {PAY_PERIOD_LABELS[r.payrollRun.payPeriodType] ?? 'Payroll'}
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
          {r.otherDeductions > 0 && (
            <div className="payslip-row"><span>Other Deductions</span><span style={{ color: 'var(--color-danger)' }}>({formatPHP(r.otherDeductions)})</span></div>
          )}
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
